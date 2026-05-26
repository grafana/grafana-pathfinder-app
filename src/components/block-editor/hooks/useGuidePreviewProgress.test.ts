/**
 * PERMANENT — seam tripwire for the BlockPreview ↔ InteractiveSection
 * event contract. `useGuidePreviewProgress` listens to
 * `pathfinder:progress` for `kind:'guide'` (acquire / clear, including
 * wildcard) plus the MF-3 step/section preview fallback. Losing the
 * clear path silently breaks BlockPreview's `resetKey` remount — the
 * most expensive regression here.
 */

import { act, renderHook } from '@testing-library/react';

import { useGuidePreviewProgress } from './useGuidePreviewProgress';
import { resetContentKeyForTests, setActiveTabUrl } from '../../../global-state/content-key';

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
  resetContentKeyForTests();
  setActiveTabUrl(PROGRESS_KEY);
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

  it('flips hasProgress to true on a matching pathfinder:progress (kind: guide) event', async () => {
    const { result } = renderHook(() => useGuidePreviewProgress(PROGRESS_KEY));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      window.dispatchEvent(
        new CustomEvent('pathfinder:progress', {
          detail: { kind: 'guide', contentKey: PROGRESS_KEY, hasProgress: true, percentage: 25 },
        })
      );
    });

    expect(result.current.hasProgress).toBe(true);
  });

  it('ignores a pathfinder:progress (kind: guide) event for a different contentKey', async () => {
    const { result } = renderHook(() => useGuidePreviewProgress(PROGRESS_KEY));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      window.dispatchEvent(
        new CustomEvent('pathfinder:progress', {
          detail: { kind: 'guide', contentKey: OTHER_KEY, hasProgress: true, percentage: 25 },
        })
      );
    });

    expect(result.current.hasProgress).toBe(false);
  });

  // MF-3 — preview mode suppresses kind:'guide' (no document total),
  // so the preview "Reset guide" button was structurally unreachable
  // from a cold session. The hook must also react to step / section
  // events when the active content key matches the progress key.
  it('flips hasProgress to true on a matching pathfinder:progress (kind: step) event', async () => {
    setActiveTabUrl(PROGRESS_KEY);
    const { result } = renderHook(() => useGuidePreviewProgress(PROGRESS_KEY));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      window.dispatchEvent(
        new CustomEvent('pathfinder:progress', {
          detail: { kind: 'step', stepId: 'step-1', sectionId: 'section-a', completed: true, reason: 'manual' },
        })
      );
    });

    expect(result.current.hasProgress).toBe(true);
  });

  it('flips hasProgress to true on a matching pathfinder:progress (kind: section) event', async () => {
    setActiveTabUrl(PROGRESS_KEY);
    const { result } = renderHook(() => useGuidePreviewProgress(PROGRESS_KEY));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      window.dispatchEvent(
        new CustomEvent('pathfinder:progress', {
          detail: { kind: 'section', sectionId: 'section-a', completed: true },
        })
      );
    });

    expect(result.current.hasProgress).toBe(true);
  });

  it('ignores step / section events when the active content key does not match', async () => {
    setActiveTabUrl(OTHER_KEY);
    const { result } = renderHook(() => useGuidePreviewProgress(PROGRESS_KEY));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      window.dispatchEvent(
        new CustomEvent('pathfinder:progress', {
          detail: { kind: 'step', stepId: 'step-1', sectionId: 'section-a', completed: true, reason: 'manual' },
        })
      );
    });

    expect(result.current.hasProgress).toBe(false);
  });

  it('flips hasProgress to false on a matching kind:guide clear (hasProgress: false)', async () => {
    (interactiveStepStorage.hasProgress as jest.Mock).mockResolvedValue(true);
    const { result } = renderHook(() => useGuidePreviewProgress(PROGRESS_KEY));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.hasProgress).toBe(true);

    act(() => {
      window.dispatchEvent(
        new CustomEvent('pathfinder:progress', {
          detail: { kind: 'guide', contentKey: PROGRESS_KEY, percentage: 0, hasProgress: false },
        })
      );
    });

    expect(result.current.hasProgress).toBe(false);
  });

  it('flips hasProgress to false on a wildcard clear (contentKey: "*")', async () => {
    (interactiveStepStorage.hasProgress as jest.Mock).mockResolvedValue(true);
    const { result } = renderHook(() => useGuidePreviewProgress(PROGRESS_KEY));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.hasProgress).toBe(true);

    act(() => {
      window.dispatchEvent(
        new CustomEvent('pathfinder:progress', {
          detail: { kind: 'guide', contentKey: '*', percentage: 0, hasProgress: false },
        })
      );
    });

    expect(result.current.hasProgress).toBe(false);
  });

  it('ignores a kind:guide clear event for a different contentKey', async () => {
    (interactiveStepStorage.hasProgress as jest.Mock).mockResolvedValue(true);
    const { result } = renderHook(() => useGuidePreviewProgress(PROGRESS_KEY));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      window.dispatchEvent(
        new CustomEvent('pathfinder:progress', {
          detail: { kind: 'guide', contentKey: OTHER_KEY, percentage: 0, hasProgress: false },
        })
      );
    });

    expect(result.current.hasProgress).toBe(true);
  });

  it('reset() clears storage, sets hasProgress=false, and dispatches kind:guide with hasProgress=false', async () => {
    (interactiveStepStorage.hasProgress as jest.Mock).mockResolvedValue(true);
    const { result } = renderHook(() => useGuidePreviewProgress(PROGRESS_KEY));
    await act(async () => {
      await Promise.resolve();
    });

    const events: CustomEvent[] = [];
    const handler = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('pathfinder:progress', handler);

    try {
      await act(async () => {
        await result.current.reset();
      });

      expect(interactiveStepStorage.clearAllForContent).toHaveBeenCalledWith(PROGRESS_KEY);
      expect(result.current.hasProgress).toBe(false);
      const clearEvent = events.find((e) => e.detail?.kind === 'guide' && e.detail?.hasProgress === false);
      expect(clearEvent).toBeDefined();
      expect(clearEvent!.detail).toEqual({
        kind: 'guide',
        contentKey: PROGRESS_KEY,
        percentage: 0,
        hasProgress: false,
      });
    } finally {
      window.removeEventListener('pathfinder:progress', handler);
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
        new CustomEvent('pathfinder:progress', {
          detail: { kind: 'guide', contentKey: PROGRESS_KEY, hasProgress: true, percentage: 25 },
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
