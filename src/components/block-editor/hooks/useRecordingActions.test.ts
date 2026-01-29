import { renderHook, act } from '@testing-library/react';
import { useRecordingState } from './useRecordingState';
import { useRecordingActions, type RecordingActionsDependencies } from './useRecordingActions';

// Create mock dependencies
const createMockDeps = (
  stateOverride?: Partial<ReturnType<typeof useRecordingState>>
): RecordingActionsDependencies => {
  // Create a real recording state and let it be overridden
  const baseState = {
    recordingIntoSection: null as string | null,
    recordingIntoConditionalBranch: null as { conditionalId: string; branch: 'whenTrue' | 'whenFalse' } | null,
    recordingStartUrl: null as string | null,
    isRecording: false,
    setRecordingIntoSection: jest.fn(),
    setRecordingIntoConditionalBranch: jest.fn(),
    setRecordingStartUrl: jest.fn(),
    reset: jest.fn(),
    restore: jest.fn(),
    ...stateOverride,
  };

  return {
    state: baseState,
    actionRecorder: {
      recordedSteps: [],
      startRecording: jest.fn(),
      stopRecording: jest.fn(),
      clearRecording: jest.fn(),
      setRecordedSteps: jest.fn(),
    },
    editor: {
      addBlock: jest.fn().mockReturnValue('new-block-id'),
      addBlockToSection: jest.fn(),
      addBlockToConditionalBranch: jest.fn(),
    },
    onClear: jest.fn(),
  };
};

describe('useRecordingActions', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('toggleSectionRecording', () => {
    it('starts section recording when not already recording', () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useRecordingActions(deps));

      act(() => {
        result.current.toggleSectionRecording('section-1');
      });

      expect(deps.actionRecorder.clearRecording).toHaveBeenCalled();
      expect(deps.actionRecorder.startRecording).toHaveBeenCalled();
      expect(deps.state.setRecordingIntoSection).toHaveBeenCalledWith('section-1');
      expect(deps.state.setRecordingIntoConditionalBranch).toHaveBeenCalledWith(null);
    });

    it('stops section recording when already recording same section', () => {
      const deps = createMockDeps({ recordingIntoSection: 'section-1' });
      const { result } = renderHook(() => useRecordingActions(deps));

      act(() => {
        result.current.toggleSectionRecording('section-1');
      });

      expect(deps.actionRecorder.stopRecording).toHaveBeenCalled();
      expect(deps.state.setRecordingIntoSection).toHaveBeenCalledWith(null);
      expect(deps.onClear).toHaveBeenCalled();
    });

    it('switches to different section when recording another section', () => {
      const deps = createMockDeps({ recordingIntoSection: 'section-1' });
      const { result } = renderHook(() => useRecordingActions(deps));

      act(() => {
        result.current.toggleSectionRecording('section-2');
      });

      // Should start recording into new section (not stop old one via toggle)
      expect(deps.actionRecorder.startRecording).toHaveBeenCalled();
      expect(deps.state.setRecordingIntoSection).toHaveBeenCalledWith('section-2');
    });
  });

  describe('toggleConditionalRecording', () => {
    it('starts conditional recording when not already recording', () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useRecordingActions(deps));

      act(() => {
        result.current.toggleConditionalRecording('cond-1', 'whenTrue');
      });

      expect(deps.actionRecorder.clearRecording).toHaveBeenCalled();
      expect(deps.actionRecorder.startRecording).toHaveBeenCalled();
      expect(deps.state.setRecordingIntoConditionalBranch).toHaveBeenCalledWith({
        conditionalId: 'cond-1',
        branch: 'whenTrue',
      });
      expect(deps.state.setRecordingIntoSection).toHaveBeenCalledWith(null);
    });

    it('stops conditional recording when already recording same branch', () => {
      const deps = createMockDeps({
        recordingIntoConditionalBranch: { conditionalId: 'cond-1', branch: 'whenTrue' },
      });
      const { result } = renderHook(() => useRecordingActions(deps));

      act(() => {
        result.current.toggleConditionalRecording('cond-1', 'whenTrue');
      });

      expect(deps.actionRecorder.stopRecording).toHaveBeenCalled();
      expect(deps.state.setRecordingIntoConditionalBranch).toHaveBeenCalledWith(null);
      expect(deps.onClear).toHaveBeenCalled();
    });

    it('switches branches when recording different branch of same conditional', () => {
      const deps = createMockDeps({
        recordingIntoConditionalBranch: { conditionalId: 'cond-1', branch: 'whenTrue' },
      });
      const { result } = renderHook(() => useRecordingActions(deps));

      act(() => {
        result.current.toggleConditionalRecording('cond-1', 'whenFalse');
      });

      // Should start recording into new branch
      expect(deps.actionRecorder.startRecording).toHaveBeenCalled();
      expect(deps.state.setRecordingIntoConditionalBranch).toHaveBeenCalledWith({
        conditionalId: 'cond-1',
        branch: 'whenFalse',
      });
    });
  });

  describe('stopRecording', () => {
    it('stops section recording when recording into section', () => {
      const deps = createMockDeps({ recordingIntoSection: 'section-1' });
      const { result } = renderHook(() => useRecordingActions(deps));

      act(() => {
        result.current.stopRecording();
      });

      expect(deps.actionRecorder.stopRecording).toHaveBeenCalled();
      expect(deps.state.setRecordingIntoSection).toHaveBeenCalledWith(null);
      expect(deps.onClear).toHaveBeenCalled();
    });

    it('stops conditional recording when recording into conditional', () => {
      const deps = createMockDeps({
        recordingIntoConditionalBranch: { conditionalId: 'cond-1', branch: 'whenFalse' },
      });
      const { result } = renderHook(() => useRecordingActions(deps));

      act(() => {
        result.current.stopRecording();
      });

      expect(deps.actionRecorder.stopRecording).toHaveBeenCalled();
      expect(deps.state.setRecordingIntoConditionalBranch).toHaveBeenCalledWith(null);
      expect(deps.onClear).toHaveBeenCalled();
    });

    it('does nothing when not recording', () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useRecordingActions(deps));

      act(() => {
        result.current.stopRecording();
      });

      expect(deps.actionRecorder.stopRecording).not.toHaveBeenCalled();
      expect(deps.onClear).not.toHaveBeenCalled();
    });
  });

  describe('submitAndStartRecording', () => {
    it('adds block and starts recording after timeout', () => {
      const deps = createMockDeps();
      const block = { type: 'section' as const, title: 'Test Section', blocks: [] };
      const { result } = renderHook(() => useRecordingActions(deps));

      act(() => {
        result.current.submitAndStartRecording(block, 5);
      });

      // Block should be added immediately
      expect(deps.editor.addBlock).toHaveBeenCalledWith(block, 5);

      // Recording should not have started yet
      expect(deps.actionRecorder.startRecording).not.toHaveBeenCalled();

      // Advance timers
      act(() => {
        jest.advanceTimersByTime(100);
      });

      // Now recording should have started
      expect(deps.actionRecorder.clearRecording).toHaveBeenCalled();
      expect(deps.actionRecorder.startRecording).toHaveBeenCalled();
      expect(deps.state.setRecordingIntoSection).toHaveBeenCalledWith('new-block-id');
    });

    it('uses the returned block ID for recording target', () => {
      const deps = createMockDeps();
      (deps.editor.addBlock as jest.Mock).mockReturnValue('custom-block-id');
      const block = { type: 'section' as const, title: 'Test', blocks: [] };
      const { result } = renderHook(() => useRecordingActions(deps));

      act(() => {
        result.current.submitAndStartRecording(block);
      });

      act(() => {
        jest.advanceTimersByTime(100);
      });

      expect(deps.state.setRecordingIntoSection).toHaveBeenCalledWith('custom-block-id');
    });

    it('clears conditional recording before starting section recording', () => {
      const deps = createMockDeps();
      const block = { type: 'section' as const, title: 'Test', blocks: [] };
      const { result } = renderHook(() => useRecordingActions(deps));

      act(() => {
        result.current.submitAndStartRecording(block);
      });

      act(() => {
        jest.advanceTimersByTime(100);
      });

      expect(deps.state.setRecordingIntoConditionalBranch).toHaveBeenCalledWith(null);
    });
  });

  describe('pendingSectionIdRef', () => {
    it('exposes the pending section ID ref', () => {
      const deps = createMockDeps();
      const { result } = renderHook(() => useRecordingActions(deps));

      expect(result.current.pendingSectionIdRef).toBeDefined();
      expect(result.current.pendingSectionIdRef.current).toBeNull();
    });
  });

  describe('recorded steps processing', () => {
    it('processes steps and adds blocks to section when stopping', () => {
      const deps = createMockDeps({ recordingIntoSection: 'section-1' });
      deps.actionRecorder.recordedSteps = [
        {
          action: 'button',
          selector: '[data-testid="btn"]',
          description: 'Click button',
        },
      ];

      const { result } = renderHook(() => useRecordingActions(deps));

      act(() => {
        result.current.toggleSectionRecording('section-1');
      });

      expect(deps.editor.addBlockToSection).toHaveBeenCalled();
    });

    it('processes steps and adds blocks to conditional when stopping', () => {
      const deps = createMockDeps({
        recordingIntoConditionalBranch: { conditionalId: 'cond-1', branch: 'whenTrue' },
      });
      deps.actionRecorder.recordedSteps = [
        {
          action: 'button',
          selector: '[data-testid="submit"]',
          description: 'Submit form',
        },
      ];

      const { result } = renderHook(() => useRecordingActions(deps));

      act(() => {
        result.current.toggleConditionalRecording('cond-1', 'whenTrue');
      });

      expect(deps.editor.addBlockToConditionalBranch).toHaveBeenCalledWith('cond-1', 'whenTrue', expect.any(Object));
    });
  });
});
