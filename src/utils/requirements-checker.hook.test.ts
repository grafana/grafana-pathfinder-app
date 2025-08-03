import { renderHook, act } from '@testing-library/react';
import { useRequirementsChecker, useSequentialRequirements, SequentialRequirementsManager } from './requirements-checker.hook';

// Mock the interactive hook
const mockCheckRequirements = jest.fn().mockResolvedValue({
  pass: true,
  requirements: 'exists-reftarget',
  error: []
});

jest.mock('./interactive.hook', () => ({
  useInteractiveElements: jest.fn().mockImplementation(() => ({
    checkRequirementsFromData: mockCheckRequirements
  }))
}));

// Mock requirement explanations
jest.mock('./requirement-explanations', () => ({
  getRequirementExplanation: jest.fn().mockReturnValue('Mock explanation')
}));

describe('useRequirementsChecker', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // Reset all mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useRequirementsChecker({
      requirements: 'exists-reftarget',
      hints: 'Click the button',
      stepId: '1.1'
    }));

    expect(result.current).toEqual(expect.objectContaining({
      isEnabled: false,
      isCompleted: false,
      isChecking: false,
      hint: 'Click the button',
      explanation: 'Mock explanation'
    }));
  });

  it('should enable step when no requirements are specified', async () => {
    const { result } = renderHook(() => useRequirementsChecker({
      stepId: '1.1'
    }));

    await act(async () => {
      await result.current.checkRequirements();
    });

    expect(result.current.isEnabled).toBe(true);
    expect(result.current.isCompleted).toBe(false);
  });

  it('should preserve completion state on re-check', async () => {
    const { result } = renderHook(() => useRequirementsChecker({
      requirements: 'exists-reftarget',
      stepId: '1.1'
    }));

    // Mark as completed
    await act(async () => {
      result.current.markCompleted();
    });

    // Try to re-check requirements
    await act(async () => {
      await result.current.checkRequirements();
    });

    expect(result.current.isCompleted).toBe(true);
    expect(result.current.isEnabled).toBe(false);
  });

  it('should handle requirements check timeout', async () => {
    // Mock the interactive hook to simulate timeout
    mockCheckRequirements.mockImplementationOnce(() => new Promise(resolve => {
      setTimeout(resolve, 6000); // Will trigger timeout
    }));
    
    const { result } = renderHook(() => useRequirementsChecker({
      requirements: 'exists-reftarget',
      stepId: '1.1'
    }));

    await act(async () => {
      const checkPromise = result.current.checkRequirements();
      jest.advanceTimersByTime(6000); // Beyond 5s timeout
      await checkPromise;
    });

    expect(result.current.isEnabled).toBe(false);
    expect(result.current.error).toContain('Requirements check timed out');
  });

  it('should auto-retry failed requirements', async () => {
    // Mock the interactive hook to fail requirements
    mockCheckRequirements.mockImplementationOnce(() => Promise.resolve({
      pass: false,
      requirements: 'exists-reftarget',
      error: [{ requirement: 'exists-reftarget', pass: false, error: 'Not found' }]
    }));

    const { result } = renderHook(() => useRequirementsChecker({
      requirements: 'exists-reftarget',
      stepId: '1.1'
    }));

    // Initial check
    await act(async () => {
      await result.current.checkRequirements();
    });

    // Verify initial state
    expect(result.current.isEnabled).toBe(false);
    expect(result.current.error).toContain('Not found');

    // Mock success for retry
    mockCheckRequirements.mockImplementationOnce(() => Promise.resolve({
      pass: true,
      requirements: 'exists-reftarget',
      error: []
    }));

    // Advance past retry interval
    await act(async () => {
      jest.advanceTimersByTime(10000);
    });

    // Verify requirements were rechecked and passed
    expect(result.current.isEnabled).toBe(true);
    expect(result.current.error).toBeUndefined();
  });
});

describe('useSequentialRequirements', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // Reset singleton instance between tests
    // @ts-ignore - accessing private static for testing
    SequentialRequirementsManager.instance = undefined;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should enforce sequential step order', async () => {
    // Render two sequential steps
    const { result: step1 } = renderHook(() => useSequentialRequirements({
      requirements: 'exists-reftarget',
      stepId: '1'
    }));

    const { result: step2 } = renderHook(() => useSequentialRequirements({
      requirements: 'exists-reftarget',
      stepId: '2'
    }));

    // First step should be enabled after checking
    await act(async () => {
      await step1.current.checkRequirements();
    });
    expect(step1.current.isEnabled).toBe(true);

    // Second step should be disabled until first is completed
    await act(async () => {
      await step2.current.checkRequirements();
    });
    expect(step2.current.isEnabled).toBe(false);
    expect(step2.current.explanation).toBe('Mock explanation');

    // Complete first step
    await act(async () => {
      step1.current.markCompleted();
    });

    // Now second step should be enabled
    await act(async () => {
      await step2.current.checkRequirements();
    });
    expect(step2.current.isEnabled).toBe(true);
  });

  it('should handle section steps independently', async () => {
    // Render a section step alongside regular steps
    const { result: regularStep } = renderHook(() => useSequentialRequirements({
      requirements: 'exists-reftarget',
      stepId: '1'
    }));

    const { result: sectionStep } = renderHook(() => useSequentialRequirements({
      requirements: 'exists-reftarget',
      sectionId: '1',
      isSequence: true
    }));

    // Section step should be enabled regardless of regular step state
    await act(async () => {
      await sectionStep.current.checkRequirements();
    });
    expect(sectionStep.current.isEnabled).toBe(true);

    // Regular step should still follow sequential rules
    await act(async () => {
      await regularStep.current.checkRequirements();
    });
    expect(regularStep.current.isEnabled).toBe(true);
  });

  it('should register step checker for reactive checking', () => {
    const manager = SequentialRequirementsManager.getInstance();
    const stepId = 'test-step-1';

    // Spy on registerStepCheckerByID
    const registerSpy = jest.spyOn(manager, 'registerStepCheckerByID');

    // Render hook
    renderHook(() => useSequentialRequirements({
      requirements: 'exists-reftarget',
      stepId
    }));

    // Should have registered a step checker
    expect(registerSpy).toHaveBeenCalledWith(
      `step-${stepId}`,
      expect.any(Function)
    );
  });

  it('should clean up subscriptions on unmount', () => {
    const { unmount } = renderHook(() => useSequentialRequirements({
      requirements: 'exists-reftarget',
      stepId: '1'
    }));

    const manager = SequentialRequirementsManager.getInstance();
    const initialSize = manager['listeners'].size;

    unmount();

    expect(manager['listeners'].size).toBe(initialSize - 1);
  });
});

describe('SequentialRequirementsManager', () => {
  beforeEach(() => {
    // Reset singleton instance between tests
    // @ts-ignore - accessing private static for testing
    SequentialRequirementsManager.instance = undefined;
  });

  it('should maintain singleton instance', () => {
    const instance1 = SequentialRequirementsManager.getInstance();
    const instance2 = SequentialRequirementsManager.getInstance();
    expect(instance1).toBe(instance2);
  });

  it('should manage step registration and updates', () => {
    const manager = SequentialRequirementsManager.getInstance();
    
    manager.registerStep('step-1', false);
    expect(manager.getStepState('step-1')).toEqual({
      isEnabled: false,
      isCompleted: false,
      isChecking: false
    });

    manager.updateStep('step-1', { isEnabled: true });
    expect(manager.getStepState('step-1')?.isEnabled).toBe(true);
  });

  it('should handle DOM monitoring', () => {
    const manager = SequentialRequirementsManager.getInstance();
    
    // Start monitoring
    manager.startDOMMonitoring();
    expect(manager['domObserver']).toBeDefined();
    expect(manager['navigationUnlisten']).toBeDefined();

    // Stop monitoring
    manager.stopDOMMonitoring();
    expect(manager['domObserver']).toBeUndefined();
    expect(manager['navigationUnlisten']).toBeUndefined();
  });
});