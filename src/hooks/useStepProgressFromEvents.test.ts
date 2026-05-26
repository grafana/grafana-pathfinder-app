/**
 * Tests for the shared `pathfinder:progress` (variant `kind: 'document'`)
 * listener used by the floating and fullscreen panels for the header
 * progress chip.
 */

import { act, renderHook } from '@testing-library/react';
import { useStepProgressFromEvents } from './useStepProgressFromEvents';

function dispatchDocumentProgress(detail: {
  totalSteps?: number;
  completedCount?: number;
  contentKey?: string;
  sectionId?: string;
  documentStepIndex?: number;
}) {
  window.dispatchEvent(
    new CustomEvent('pathfinder:progress', {
      detail: {
        kind: 'document',
        contentKey: detail.contentKey ?? 'test-guide',
        sectionId: detail.sectionId ?? 'section-1',
        totalSteps: detail.totalSteps ?? 0,
        completedCount: detail.completedCount ?? 0,
        documentStepIndex: detail.documentStepIndex,
      },
    })
  );
}

describe('useStepProgressFromEvents', () => {
  it('returns undefined initially when no event has fired', () => {
    const { result } = renderHook(() => useStepProgressFromEvents(true));
    expect(result.current).toBeUndefined();
  });

  it('formats `done/total` when a progress event arrives with totalSteps > 0', () => {
    const { result } = renderHook(() => useStepProgressFromEvents(true));

    act(() => {
      dispatchDocumentProgress({ totalSteps: 7, completedCount: 3 });
    });

    expect(result.current).toBe('3/7');
  });

  it('updates on each subsequent event', () => {
    const { result } = renderHook(() => useStepProgressFromEvents(true));

    act(() => {
      dispatchDocumentProgress({ totalSteps: 7, completedCount: 0 });
    });
    expect(result.current).toBe('0/7');

    act(() => {
      dispatchDocumentProgress({ totalSteps: 7, completedCount: 7 });
    });
    expect(result.current).toBe('7/7');
  });

  it('clears progress when an event arrives with totalSteps = 0 (e.g. recommendations tab)', () => {
    const { result } = renderHook(() => useStepProgressFromEvents(true));

    act(() => {
      dispatchDocumentProgress({ totalSteps: 5, completedCount: 2 });
    });
    expect(result.current).toBe('2/5');

    act(() => {
      dispatchDocumentProgress({ totalSteps: 0, completedCount: 0 });
    });
    expect(result.current).toBeUndefined();
  });

  it('returns undefined and skips subscribing when hasActiveGuide is false', () => {
    const { result } = renderHook(() => useStepProgressFromEvents(false));

    act(() => {
      dispatchDocumentProgress({ totalSteps: 7, completedCount: 3 });
    });

    expect(result.current).toBeUndefined();
  });

  it('clears the chip when the active guide flips to false (no stale value lingering)', () => {
    const { rerender, result } = renderHook(({ active }: { active: boolean }) => useStepProgressFromEvents(active), {
      initialProps: { active: true },
    });

    act(() => {
      dispatchDocumentProgress({ totalSteps: 7, completedCount: 3 });
    });
    expect(result.current).toBe('3/7');

    rerender({ active: false });
    expect(result.current).toBeUndefined();
  });

  it('ignores non-document variants of the unified progress event', () => {
    const { result } = renderHook(() => useStepProgressFromEvents(true));

    act(() => {
      window.dispatchEvent(
        new CustomEvent('pathfinder:progress', {
          detail: { kind: 'guide', contentKey: 'test-guide', percentage: 50, hasProgress: true },
        })
      );
      window.dispatchEvent(
        new CustomEvent('pathfinder:progress', {
          detail: { kind: 'step', stepId: 's1', completed: true, reason: 'manual' },
        })
      );
      window.dispatchEvent(
        new CustomEvent('pathfinder:progress', {
          detail: { kind: 'section', sectionId: 'section-1', completed: true },
        })
      );
    });

    expect(result.current).toBeUndefined();
  });

  it('unsubscribes on unmount (no leak)', () => {
    const removeSpy = jest.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => useStepProgressFromEvents(true));
    unmount();

    expect(removeSpy).toHaveBeenCalledWith('pathfinder:progress', expect.any(Function));
    removeSpy.mockRestore();
  });
});
