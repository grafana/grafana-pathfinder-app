import { renderHook, act } from '@testing-library/react';
import { useRecordingState } from './useRecordingState';

describe('useRecordingState', () => {
  it('starts with no active recording', () => {
    const { result } = renderHook(() => useRecordingState());

    expect(result.current.isRecording).toBe(false);
    expect(result.current.recordingIntoSection).toBeNull();
    expect(result.current.recordingIntoConditionalBranch).toBeNull();
    expect(result.current.recordingStartUrl).toBeNull();
  });

  describe('section recording state', () => {
    it('tracks section recording state', () => {
      const { result } = renderHook(() => useRecordingState());

      act(() => {
        result.current.setRecordingIntoSection('section-1');
        result.current.setRecordingStartUrl('http://localhost:3000');
      });

      expect(result.current.isRecording).toBe(true);
      expect(result.current.recordingIntoSection).toBe('section-1');
      expect(result.current.recordingStartUrl).toBe('http://localhost:3000');
    });

    it('clears section recording state', () => {
      const { result } = renderHook(() => useRecordingState());

      act(() => {
        result.current.setRecordingIntoSection('section-1');
        result.current.setRecordingStartUrl('http://localhost:3000');
      });
      expect(result.current.isRecording).toBe(true);

      act(() => {
        result.current.setRecordingIntoSection(null);
        result.current.setRecordingStartUrl(null);
      });

      expect(result.current.isRecording).toBe(false);
      expect(result.current.recordingIntoSection).toBeNull();
    });
  });

  describe('conditional recording state', () => {
    it('tracks conditional recording state', () => {
      const { result } = renderHook(() => useRecordingState());

      act(() => {
        result.current.setRecordingIntoConditionalBranch({
          conditionalId: 'cond-1',
          branch: 'whenTrue',
        });
      });

      expect(result.current.isRecording).toBe(true);
      expect(result.current.recordingIntoConditionalBranch).toEqual({
        conditionalId: 'cond-1',
        branch: 'whenTrue',
      });
    });

    it('tracks whenFalse branch recording', () => {
      const { result } = renderHook(() => useRecordingState());

      act(() => {
        result.current.setRecordingIntoConditionalBranch({
          conditionalId: 'cond-2',
          branch: 'whenFalse',
        });
      });

      expect(result.current.recordingIntoConditionalBranch?.branch).toBe('whenFalse');
    });
  });

  describe('reset', () => {
    it('resets all state', () => {
      const { result } = renderHook(() => useRecordingState());

      act(() => {
        result.current.setRecordingIntoSection('section-1');
        result.current.setRecordingStartUrl('http://localhost:3000');
      });
      expect(result.current.isRecording).toBe(true);

      act(() => {
        result.current.reset();
      });

      expect(result.current.isRecording).toBe(false);
      expect(result.current.recordingIntoSection).toBeNull();
      expect(result.current.recordingIntoConditionalBranch).toBeNull();
      expect(result.current.recordingStartUrl).toBeNull();
    });

    it('resets conditional recording state', () => {
      const { result } = renderHook(() => useRecordingState());

      act(() => {
        result.current.setRecordingIntoConditionalBranch({
          conditionalId: 'cond-1',
          branch: 'whenTrue',
        });
        result.current.setRecordingStartUrl('http://localhost:3000/page');
      });

      act(() => {
        result.current.reset();
      });

      expect(result.current.recordingIntoConditionalBranch).toBeNull();
    });
  });

  describe('restore', () => {
    it('restores section recording from snapshot', () => {
      const { result } = renderHook(() => useRecordingState());

      act(() => {
        result.current.restore({
          recordingIntoSection: 'section-2',
          recordingIntoConditionalBranch: null,
          recordingStartUrl: 'http://localhost:3000/page',
        });
      });

      expect(result.current.recordingIntoSection).toBe('section-2');
      expect(result.current.recordingStartUrl).toBe('http://localhost:3000/page');
      expect(result.current.isRecording).toBe(true);
    });

    it('restores conditional recording from snapshot', () => {
      const { result } = renderHook(() => useRecordingState());

      act(() => {
        result.current.restore({
          recordingIntoSection: null,
          recordingIntoConditionalBranch: {
            conditionalId: 'cond-3',
            branch: 'whenFalse',
          },
          recordingStartUrl: 'http://localhost:3000/conditional',
        });
      });

      expect(result.current.recordingIntoConditionalBranch).toEqual({
        conditionalId: 'cond-3',
        branch: 'whenFalse',
      });
      expect(result.current.isRecording).toBe(true);
    });

    it('restores to no recording', () => {
      const { result } = renderHook(() => useRecordingState());

      // First set some recording state
      act(() => {
        result.current.setRecordingIntoSection('section-1');
      });

      // Then restore to empty
      act(() => {
        result.current.restore({
          recordingIntoSection: null,
          recordingIntoConditionalBranch: null,
          recordingStartUrl: null,
        });
      });

      expect(result.current.isRecording).toBe(false);
    });
  });

  describe('isRecording computed value', () => {
    it('is true when recording into section', () => {
      const { result } = renderHook(() => useRecordingState());

      act(() => {
        result.current.setRecordingIntoSection('section-1');
      });

      expect(result.current.isRecording).toBe(true);
    });

    it('is true when recording into conditional', () => {
      const { result } = renderHook(() => useRecordingState());

      act(() => {
        result.current.setRecordingIntoConditionalBranch({
          conditionalId: 'cond-1',
          branch: 'whenTrue',
        });
      });

      expect(result.current.isRecording).toBe(true);
    });

    it('is false when neither is set', () => {
      const { result } = renderHook(() => useRecordingState());

      expect(result.current.isRecording).toBe(false);
    });
  });
});
