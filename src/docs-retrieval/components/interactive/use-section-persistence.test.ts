import { renderHook, act, waitFor } from '@testing-library/react';
import { useSectionPersistence } from './use-section-persistence';
import {
  interactiveStepStorage,
  sectionCollapseStorage,
  interactiveCompletionStorage,
} from '../../../lib/user-storage';
import { getTotalDocumentSteps } from './step-registry';
import type { StepInfo } from '../../../types/component-props.types';

// Mock dependencies
jest.mock('../../../lib/user-storage', () => ({
  interactiveStepStorage: {
    getCompleted: jest.fn(),
    setCompleted: jest.fn(),
    countAllCompleted: jest.fn(),
  },
  sectionCollapseStorage: {
    get: jest.fn(),
    set: jest.fn(),
  },
  interactiveCompletionStorage: {
    set: jest.fn(),
  },
}));

jest.mock('./get-content-key', () => ({
  getContentKey: jest.fn(() => 'test-content-key'),
}));

jest.mock('./step-registry', () => ({
  getTotalDocumentSteps: jest.fn(() => 10),
}));

describe('useSectionPersistence', () => {
  const mockStepComponents: StepInfo[] = [
    {
      stepId: 'section-1-step-0',
      index: 0,
      targetAction: 'click',
      element: {} as any,
      postVerify: undefined,
      skippable: false,
      showMe: undefined,
      targetComment: undefined,
      isMultiStep: false,
      isGuided: false,
    },
    {
      stepId: 'section-1-step-1',
      index: 1,
      targetAction: 'click',
      element: {} as any,
      postVerify: undefined,
      skippable: false,
      showMe: undefined,
      targetComment: undefined,
      isMultiStep: false,
      isGuided: false,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (interactiveStepStorage.getCompleted as jest.Mock).mockResolvedValue(new Set());
    (sectionCollapseStorage.get as jest.Mock).mockResolvedValue(false);
    (interactiveStepStorage.countAllCompleted as jest.Mock).mockReturnValue(0);
  });

  it('should initialize with empty state', () => {
    const { result } = renderHook(() =>
      useSectionPersistence({ sectionId: 'section-1', stepComponents: mockStepComponents })
    );

    expect(result.current.completedSteps.size).toBe(0);
    expect(result.current.currentStepIndex).toBe(0);
    expect(result.current.isCollapsed).toBe(false);
    expect(result.current.isPreviewMode).toBe(false);
  });

  it('should restore completed steps from storage', async () => {
    const restoredSteps = new Set(['section-1-step-0']);
    (interactiveStepStorage.getCompleted as jest.Mock).mockResolvedValue(restoredSteps);

    const { result } = renderHook(() =>
      useSectionPersistence({ sectionId: 'section-1', stepComponents: mockStepComponents })
    );

    await waitFor(() => {
      expect(result.current.completedSteps.size).toBe(1);
    });

    expect(result.current.completedSteps.has('section-1-step-0')).toBe(true);
    expect(result.current.currentStepIndex).toBe(1); // Next uncompleted
  });

  it('should filter out stale step IDs when restoring', async () => {
    const restoredSteps = new Set(['section-1-step-0', 'section-1-step-999']); // 999 doesn't exist
    (interactiveStepStorage.getCompleted as jest.Mock).mockResolvedValue(restoredSteps);

    const { result } = renderHook(() =>
      useSectionPersistence({ sectionId: 'section-1', stepComponents: mockStepComponents })
    );

    await waitFor(() => {
      expect(result.current.completedSteps.size).toBe(1);
    });

    expect(result.current.completedSteps.has('section-1-step-0')).toBe(true);
    expect(result.current.completedSteps.has('section-1-step-999')).toBe(false);
  });

  it('should persist completed steps to storage', () => {
    const { result } = renderHook(() =>
      useSectionPersistence({ sectionId: 'section-1', stepComponents: mockStepComponents })
    );

    const newCompletedSteps = new Set(['section-1-step-0']);
    act(() => {
      result.current.persistCompletedSteps(newCompletedSteps);
    });

    expect(interactiveStepStorage.setCompleted).toHaveBeenCalledWith(
      'test-content-key',
      'section-1',
      newCompletedSteps
    );
  });

  it('should compute and persist document completion percentage', () => {
    (getTotalDocumentSteps as jest.Mock).mockReturnValue(10);
    (interactiveStepStorage.countAllCompleted as jest.Mock).mockReturnValue(5);

    const { result } = renderHook(() =>
      useSectionPersistence({ sectionId: 'section-1', stepComponents: mockStepComponents })
    );

    const newCompletedSteps = new Set(['section-1-step-0']);
    act(() => {
      result.current.persistCompletedSteps(newCompletedSteps);
    });

    expect(interactiveCompletionStorage.set).toHaveBeenCalledWith('test-content-key', 50);
  });

  it('should dispatch interactive-progress-saved event', () => {
    const dispatchEventSpy = jest.spyOn(window, 'dispatchEvent');

    const { result } = renderHook(() =>
      useSectionPersistence({ sectionId: 'section-1', stepComponents: mockStepComponents })
    );

    const newCompletedSteps = new Set(['section-1-step-0']);
    act(() => {
      result.current.persistCompletedSteps(newCompletedSteps);
    });

    expect(dispatchEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'interactive-progress-saved',
        detail: expect.objectContaining({
          contentKey: 'test-content-key',
          hasProgress: true,
        }),
      })
    );

    dispatchEventSpy.mockRestore();
  });

  it('should restore collapse state from storage', async () => {
    (sectionCollapseStorage.get as jest.Mock).mockResolvedValue(true);

    const { result } = renderHook(() =>
      useSectionPersistence({ sectionId: 'section-1', stepComponents: mockStepComponents })
    );

    await waitFor(() => {
      expect(result.current.isCollapsed).toBe(true);
    });
  });

  it('should toggle collapse and persist', () => {
    const { result } = renderHook(() =>
      useSectionPersistence({ sectionId: 'section-1', stepComponents: mockStepComponents })
    );

    act(() => {
      result.current.toggleCollapse();
    });

    expect(result.current.isCollapsed).toBe(true);
    expect(sectionCollapseStorage.set).toHaveBeenCalledWith('test-content-key', 'section-1', true);
  });

  it('should skip collapse persistence in preview mode', () => {
    const mockGetContentKey = require('./get-content-key').getContentKey as jest.Mock;
    mockGetContentKey.mockReturnValue('block-editor://preview/test-guide');

    const { result } = renderHook(() =>
      useSectionPersistence({ sectionId: 'section-1', stepComponents: mockStepComponents })
    );

    expect(result.current.isPreviewMode).toBe(true);

    act(() => {
      result.current.toggleCollapse();
    });

    expect(result.current.isCollapsed).toBe(true);
    expect(sectionCollapseStorage.set).not.toHaveBeenCalled();
  });

  it('should not restore collapse state in preview mode', async () => {
    const mockGetContentKey = require('./get-content-key').getContentKey as jest.Mock;
    mockGetContentKey.mockReturnValue('block-editor://preview/test-guide');
    (sectionCollapseStorage.get as jest.Mock).mockResolvedValue(true);

    const { result } = renderHook(() =>
      useSectionPersistence({ sectionId: 'section-1', stepComponents: mockStepComponents })
    );

    // Wait to ensure the effect doesn't run
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(result.current.isCollapsed).toBe(false);
    expect(sectionCollapseStorage.get).not.toHaveBeenCalled();
  });

  it('should set currentStepIndex to length when all steps completed', async () => {
    const restoredSteps = new Set(['section-1-step-0', 'section-1-step-1']);
    (interactiveStepStorage.getCompleted as jest.Mock).mockResolvedValue(restoredSteps);

    const { result } = renderHook(() =>
      useSectionPersistence({ sectionId: 'section-1', stepComponents: mockStepComponents })
    );

    await waitFor(() => {
      expect(result.current.currentStepIndex).toBe(2); // Length of array
    });
  });
});
