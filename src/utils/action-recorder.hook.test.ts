import { renderHook, act, cleanup } from '@testing-library/react';
import { useActionRecorder } from './action-recorder.hook';
import { generateSelectorFromEvent } from './selector-generator.util';
import { shouldCaptureElement } from '../interactive-engine/auto-completion/action-detector';

// Mock dependencies
jest.mock('./selector-generator.util', () => ({
  generateSelectorFromEvent: jest.fn(),
}));

jest.mock('../interactive-engine/auto-completion/action-detector', () => ({
  shouldCaptureElement: jest.fn((el) => true),
  getActionDescription: jest.fn((action, el) => `Action: ${action}`),
  detectActionType: jest.fn(),
}));

describe('useActionRecorder', () => {
  let mockButton: HTMLButtonElement;
  let mockInput: HTMLInputElement;

  beforeEach(() => {
    mockButton = document.createElement('button');
    mockButton.setAttribute('data-testid', 'test-button');
    mockButton.textContent = 'Test Button';
    document.body.appendChild(mockButton);

    mockInput = document.createElement('input');
    mockInput.type = 'text';
    mockInput.name = 'test-input';
    document.body.appendChild(mockInput);

    jest.clearAllMocks();
    (shouldCaptureElement as jest.Mock).mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('should initialize with empty recorded steps', () => {
    const { result } = renderHook(() => useActionRecorder());

    expect(result.current.isRecording).toBe(false);
    expect(result.current.recordedSteps).toEqual([]);
  });

  it('should start recording', () => {
    const { result } = renderHook(() => useActionRecorder());

    act(() => {
      result.current.startRecording();
    });

    expect(result.current.isRecording).toBe(true);
  });

  it('should stop recording and keep steps', () => {
    const { result } = renderHook(() => useActionRecorder());

    act(() => {
      result.current.startRecording();
    });

    (generateSelectorFromEvent as jest.Mock).mockReturnValue({
      selector: 'button[data-testid="test-button"]',
      action: 'highlight',
      selectorInfo: {
        method: 'data-testid',
        isUnique: true,
        matchCount: 1,
      },
      warnings: [],
    });

    act(() => {
      mockButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    act(() => {
      result.current.stopRecording();
    });

    expect(result.current.isRecording).toBe(false);
    expect(result.current.recordedSteps.length).toBeGreaterThan(0);
  });

  it('should record click actions', () => {
    (generateSelectorFromEvent as jest.Mock).mockReturnValue({
      selector: 'button[data-testid="test-button"]',
      action: 'highlight',
      selectorInfo: {
        method: 'data-testid',
        isUnique: true,
        matchCount: 1,
      },
      warnings: [],
    });

    const { result } = renderHook(() => useActionRecorder());

    act(() => {
      result.current.startRecording();
    });

    act(() => {
      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 100, clientY: 200 });
      mockButton.dispatchEvent(clickEvent);
    });

    expect(result.current.recordedSteps.length).toBe(1);
    expect(result.current.recordedSteps[0].selector).toBe('button[data-testid="test-button"]');
    expect(result.current.recordedSteps[0].action).toBe('highlight');
  });

  it('should track formfill inputs and record on change', () => {
    (generateSelectorFromEvent as jest.Mock).mockReturnValue({
      selector: 'input[name="test-input"]',
      action: 'formfill',
      selectorInfo: {
        method: 'name',
        isUnique: true,
        matchCount: 1,
      },
      warnings: [],
    });

    const { result } = renderHook(() => useActionRecorder());

    act(() => {
      result.current.startRecording();
    });

    // Simulate input value change
    act(() => {
      mockInput.value = 'test-value';
      mockInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Simulate change event
    act(() => {
      mockInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(result.current.recordedSteps.length).toBe(1);
    expect(result.current.recordedSteps[0].action).toBe('formfill');
    expect(result.current.recordedSteps[0].value).toBe('test-value');
  });

  it('should call onStepRecorded callback when step is recorded', () => {
    const onStepRecorded = jest.fn();
    (generateSelectorFromEvent as jest.Mock).mockReturnValue({
      selector: 'button[data-testid="test-button"]',
      action: 'highlight',
      selectorInfo: {
        method: 'data-testid',
        isUnique: true,
        matchCount: 1,
      },
      warnings: [],
    });

    const { result } = renderHook(() =>
      useActionRecorder({
        onStepRecorded,
      })
    );

    act(() => {
      result.current.startRecording();
    });

    act(() => {
      mockButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(onStepRecorded).toHaveBeenCalled();
    expect(onStepRecorded.mock.calls[0][0].selector).toBe('button[data-testid="test-button"]');
  });

  it('should clear recorded steps', () => {
    (generateSelectorFromEvent as jest.Mock).mockReturnValue({
      selector: 'button[data-testid="test-button"]',
      action: 'highlight',
      selectorInfo: {
        method: 'data-testid',
        isUnique: true,
        matchCount: 1,
      },
      warnings: [],
    });

    const { result } = renderHook(() => useActionRecorder());

    act(() => {
      result.current.startRecording();
      mockButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      result.current.clearRecording();
    });

    expect(result.current.recordedSteps).toEqual([]);
  });

  it('should delete specific step', () => {
    const mockButton2 = document.createElement('button');
    mockButton2.setAttribute('data-testid', 'test-button-2');
    document.body.appendChild(mockButton2);

    (generateSelectorFromEvent as jest.Mock)
      .mockReturnValueOnce({
        selector: 'button[data-testid="test-button"]',
        action: 'highlight',
        selectorInfo: {
          method: 'data-testid',
          isUnique: true,
          matchCount: 1,
        },
        warnings: [],
      })
      .mockReturnValueOnce({
        selector: 'button[data-testid="test-button-2"]',
        action: 'highlight',
        selectorInfo: {
          method: 'data-testid',
          isUnique: true,
          matchCount: 1,
        },
        warnings: [],
      });

    const { result } = renderHook(() => useActionRecorder());

    act(() => {
      result.current.startRecording();
    });

    // Dispatch first click on first button
    act(() => {
      const clickEvent1 = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 100, clientY: 200 });
      mockButton.dispatchEvent(clickEvent1);
    });

    // Dispatch second click on second button (different selector, so not duplicate)
    act(() => {
      const clickEvent2 = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 200, clientY: 300 });
      mockButton2.dispatchEvent(clickEvent2);
    });

    // Should have 2 steps now
    expect(result.current.recordedSteps.length).toBe(2);

    // Delete first step
    act(() => {
      result.current.deleteStep(0);
    });

    expect(result.current.recordedSteps.length).toBe(1);
    expect(result.current.recordedSteps[0].selector).toBe('button[data-testid="test-button-2"]');
  });

  it('should exclude clicks within excluded selectors', () => {
    const excludedElement = document.createElement('div');
    excludedElement.className = 'excluded-container';
    excludedElement.appendChild(mockButton);
    document.body.appendChild(excludedElement);

    const { result } = renderHook(() =>
      useActionRecorder({
        excludeSelectors: ['.excluded-container'],
      })
    );

    act(() => {
      result.current.startRecording();
      mockButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(result.current.recordedSteps.length).toBe(0);
  });

  it('should skip duplicate steps', () => {
    (generateSelectorFromEvent as jest.Mock).mockReturnValue({
      selector: 'button[data-testid="test-button"]',
      action: 'highlight',
      selectorInfo: {
        method: 'data-testid',
        isUnique: true,
        matchCount: 1,
      },
      warnings: [],
    });

    const { result } = renderHook(() => useActionRecorder());

    act(() => {
      result.current.startRecording();
    });

    // Dispatch first click
    act(() => {
      const clickEvent1 = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 100, clientY: 200 });
      mockButton.dispatchEvent(clickEvent1);
    });

    // Dispatch second click with same selector (should be skipped as duplicate)
    act(() => {
      const clickEvent2 = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 100, clientY: 200 });
      mockButton.dispatchEvent(clickEvent2);
    });

    // Should only record once (duplicate is skipped)
    expect(result.current.recordedSteps.length).toBe(1);
  });

  it('should export steps as string format', () => {
    (generateSelectorFromEvent as jest.Mock).mockReturnValue({
      selector: 'button[data-testid="test-button"]',
      action: 'highlight',
      selectorInfo: {
        method: 'data-testid',
        isUnique: true,
        matchCount: 1,
      },
      warnings: [],
    });

    const { result } = renderHook(() => useActionRecorder());

    act(() => {
      result.current.startRecording();
    });

    act(() => {
      mockButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    act(() => {
      result.current.stopRecording();
    });

    const exported = result.current.exportSteps('string');
    expect(exported).toContain('highlight');
    expect(exported).toContain('button[data-testid="test-button"]');
  });

  it('should export steps as HTML format', () => {
    (generateSelectorFromEvent as jest.Mock).mockReturnValue({
      selector: 'button[data-testid="test-button"]',
      action: 'highlight',
      selectorInfo: {
        method: 'data-testid',
        isUnique: true,
        matchCount: 1,
      },
      warnings: [],
    });

    const { result } = renderHook(() => useActionRecorder());

    act(() => {
      result.current.startRecording();
    });

    act(() => {
      mockButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    act(() => {
      result.current.stopRecording();
    });

    const exported = result.current.exportSteps('html', {
      sectionTitle: 'Test Section',
      sectionId: 'test-section',
    });

    expect(exported).toContain('Test Section');
    expect(exported).toContain('test-section');
    expect(exported).toContain('data-targetaction');
    expect(exported).toContain('data-reftarget');
  });

  it('should skip duplicate formfill with same selector, action, and value', () => {
    (generateSelectorFromEvent as jest.Mock).mockReturnValue({
      selector: 'input[name="test-input"]',
      action: 'formfill',
      selectorInfo: {
        method: 'name',
        isUnique: true,
        matchCount: 1,
      },
      warnings: [],
    });

    const { result } = renderHook(() => useActionRecorder());

    act(() => {
      result.current.startRecording();
    });

    // First formfill with value "test-value"
    act(() => {
      mockInput.value = 'test-value';
      mockInput.dispatchEvent(new Event('input', { bubbles: true }));
      mockInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(result.current.recordedSteps.length).toBe(1);
    expect(result.current.recordedSteps[0].value).toBe('test-value');

    // Second formfill with same value (should be skipped)
    act(() => {
      mockInput.value = 'test-value';
      mockInput.dispatchEvent(new Event('input', { bubbles: true }));
      mockInput.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Should still only have one step (duplicate skipped)
    expect(result.current.recordedSteps.length).toBe(1);
  });

  it('should not track radio/checkbox inputs for formfill', () => {
    const radioInput = document.createElement('input');
    radioInput.type = 'radio';
    radioInput.name = 'test-radio';
    document.body.appendChild(radioInput);

    const checkboxInput = document.createElement('input');
    checkboxInput.type = 'checkbox';
    checkboxInput.name = 'test-checkbox';
    document.body.appendChild(checkboxInput);

    (generateSelectorFromEvent as jest.Mock).mockReturnValue({
      selector: 'input[name="test-radio"]',
      action: 'highlight',
      selectorInfo: {
        method: 'name',
        isUnique: true,
        matchCount: 1,
      },
      warnings: [],
    });

    const { result } = renderHook(() => useActionRecorder());

    act(() => {
      result.current.startRecording();
    });

    // Dispatch input event on radio (should not track for formfill)
    act(() => {
      radioInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Dispatch input event on checkbox (should not track for formfill)
    act(() => {
      checkboxInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Radio/checkbox inputs should not be tracked for formfill
    // They should only be recorded on click, not on input events
    expect(result.current.recordedSteps.length).toBe(0);
  });

  it('should log warnings when selector validation produces warnings', () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    (generateSelectorFromEvent as jest.Mock).mockReturnValue({
      selector: 'button[data-testid="test-button"]',
      action: 'highlight',
      selectorInfo: {
        method: 'data-testid',
        isUnique: true,
        matchCount: 1,
      },
      warnings: ['Removed auto-generated class'],
    });

    const { result } = renderHook(() => useActionRecorder());

    act(() => {
      result.current.startRecording();
    });

    act(() => {
      mockButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(consoleWarnSpy).toHaveBeenCalledWith('Selector validation warnings:', ['Removed auto-generated class']);
    expect(result.current.recordedSteps.length).toBe(1);

    consoleWarnSpy.mockRestore();
  });
});
