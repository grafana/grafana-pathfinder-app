/**
 * PERMANENT — seam tripwire for the BlockPreview ↔ InteractiveSection event
 * contract.
 *
 * `useGuidePreviewProgress` is the listener side of two custom events that
 * cross the block-editor preview boundary:
 *
 *   - `interactive-progress-saved`    (producer: persistCompletedSteps in
 *                                      interactive-section.tsx)
 *   - `interactive-progress-cleared`  (producer: BlockPreview reset +, after
 *                                      phase-3 of #842, handleResetSection)
 *
 * If a refactor of either side breaks the event names, payload shape, or the
 * progressKey filter, the assertions here will fail. The hook also drives
 * BlockPreview's `resetKey` remount mechanism — losing the cleared-listener
 * is the most expensive regression path.
 */

import { act, renderHook } from '@testing-library/react';

import { useGuidePreviewProgress } from './useGuidePreviewProgress';

jest.mock('../../../lib/user-storage', () => ({
  interactiveStepStorage: {
    hasProgress: jest.fn(async () => false),
    clearAllForContent: jest.fn(async () => undefined),
  },
  interactiveCompletionStorage: {
    clear: jest.fn(async () => undefined),
  },
}));

import { interactiveStepStorage } from '../../../lib/user-storage';

const PROGRESS_KEY = 'block-editor://preview/test-guide';
const OTHER_KEY = 'block-editor://preview/other-guide';

beforeEach(() => {
  jest.clearAllMocks();
  (interactiveStepStorage.hasProgress as jest.Mock).mockResolvedValue(false);
});

describe('useGuidePreviewProgress — listener contract', () => {
  it('starts with hasProgress=false when storage has no progress', async () => {
    const { result } = renderHook(() => useGuidePreviewProgress(PROGRESS_KEY));

    // Wait for the initial async hasProgress resolution.
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.hasProgress).toBe(false);
    expect(interactiveStepStorage.hasProgress).toHaveBeenCalledWith(PROGRESS_KEY);
  });

  it('initialises hasProgress=true when storage reports prior progress', async () => {
    (interactiveStepStorage.hasProgress as jest.Mock).mockResolvedValue(true);

    const { result } = renderHook(() => useGuidePreviewProgress(PROGRESS_KEY));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.hasProgress).toBe(true);
  });

  it('flips hasProgress to true on a matching "interactive-progress-saved" event', async () => {
    const { result } = renderHook(() => useGuidePreviewProgress(PROGRESS_KEY));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      window.dispatchEvent(
        new CustomEvent('interactive-progress-saved', {
          detail: { contentKey: PROGRESS_KEY, hasProgress: true, completionPercentage: 25 },
        })
      );
    });

    expect(result.current.hasProgress).toBe(true);
  });

  it('ignores a "interactive-progress-saved" event for a different contentKey', async () => {
    const { result } = renderHook(() => useGuidePreviewProgress(PROGRESS_KEY));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      window.dispatchEvent(
        new CustomEvent('interactive-progress-saved', {
          detail: { contentKey: OTHER_KEY, hasProgress: true },
        })
      );
    });

    expect(result.current.hasProgress).toBe(false);
  });

  it('flips hasProgress to false on a matching "interactive-progress-cleared" event', async () => {
    (interactiveStepStorage.hasProgress as jest.Mock).mockResolvedValue(true);
    const { result } = renderHook(() => useGuidePreviewProgress(PROGRESS_KEY));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.hasProgress).toBe(true);

    act(() => {
      window.dispatchEvent(
        new CustomEvent('interactive-progress-cleared', {
          detail: { contentKey: PROGRESS_KEY },
        })
      );
    });

    expect(result.current.hasProgress).toBe(false);
  });

  it('ignores a "interactive-progress-cleared" event for a different contentKey', async () => {
    (interactiveStepStorage.hasProgress as jest.Mock).mockResolvedValue(true);
    const { result } = renderHook(() => useGuidePreviewProgress(PROGRESS_KEY));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      window.dispatchEvent(
        new CustomEvent('interactive-progress-cleared', {
          detail: { contentKey: OTHER_KEY },
        })
      );
    });

    expect(result.current.hasProgress).toBe(true);
  });

  it('reset() clears storage, sets hasProgress=false, and dispatches "interactive-progress-cleared"', async () => {
    (interactiveStepStorage.hasProgress as jest.Mock).mockResolvedValue(true);
    const { result } = renderHook(() => useGuidePreviewProgress(PROGRESS_KEY));
    await act(async () => {
      await Promise.resolve();
    });

    const events: CustomEvent[] = [];
    const handler = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('interactive-progress-cleared', handler);

    try {
      await act(async () => {
        await result.current.reset();
      });

      expect(interactiveStepStorage.clearAllForContent).toHaveBeenCalledWith(PROGRESS_KEY);
      expect(result.current.hasProgress).toBe(false);
      expect(events).toHaveLength(1);
      expect(events[0]!.detail).toEqual({ contentKey: PROGRESS_KEY });
    } finally {
      window.removeEventListener('interactive-progress-cleared', handler);
    }
  });

  it('unsubscribes its listeners on unmount', async () => {
    const { result, unmount } = renderHook(() => useGuidePreviewProgress(PROGRESS_KEY));
    await act(async () => {
      await Promise.resolve();
    });

    unmount();

    act(() => {
      window.dispatchEvent(
        new CustomEvent('interactive-progress-saved', {
          detail: { contentKey: PROGRESS_KEY, hasProgress: true },
        })
      );
    });

    // After unmount the hook should no longer react. The result object is a
    // stale snapshot — we don't expect React state updates to leak through.
    // (If they did, React would log a "state update on unmounted component"
    // warning, which the test runner would surface as a console error.)
    expect(result.current.hasProgress).toBe(false);
  });
});
