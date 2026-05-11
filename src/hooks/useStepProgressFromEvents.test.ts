/**
 * Tests for the shared `pathfinder-step-progress` listener used by the
 * floating and fullscreen panels for the header progress chip.
 */

import { act, renderHook } from '@testing-library/react';
import { useStepProgressFromEvents } from './useStepProgressFromEvents';

function dispatchProgress(detail: { totalSteps?: number; completedCount?: number }) {
  window.dispatchEvent(new CustomEvent('pathfinder-step-progress', { detail }));
}

describe('useStepProgressFromEvents', () => {
  it('returns undefined initially when no event has fired', () => {
    const { result } = renderHook(() => useStepProgressFromEvents(true));
    expect(result.current).toBeUndefined();
  });

  it('formats `done/total` when a progress event arrives with totalSteps > 0', () => {
    const { result } = renderHook(() => useStepProgressFromEvents(true));

    act(() => {
      dispatchProgress({ totalSteps: 7, completedCount: 3 });
    });

    expect(result.current).toBe('3/7');
  });

  it('updates on each subsequent event', () => {
    const { result } = renderHook(() => useStepProgressFromEvents(true));

    act(() => {
      dispatchProgress({ totalSteps: 7, completedCount: 0 });
    });
    expect(result.current).toBe('0/7');

    act(() => {
      dispatchProgress({ totalSteps: 7, completedCount: 7 });
    });
    expect(result.current).toBe('7/7');
  });

  it('clears progress when an event arrives with totalSteps = 0 (e.g. recommendations tab)', () => {
    const { result } = renderHook(() => useStepProgressFromEvents(true));

    act(() => {
      dispatchProgress({ totalSteps: 5, completedCount: 2 });
    });
    expect(result.current).toBe('2/5');

    act(() => {
      dispatchProgress({ totalSteps: 0, completedCount: 0 });
    });
    expect(result.current).toBeUndefined();
  });

  it('returns undefined and skips subscribing when hasActiveGuide is false', () => {
    const { result } = renderHook(() => useStepProgressFromEvents(false));

    act(() => {
      dispatchProgress({ totalSteps: 7, completedCount: 3 });
    });

    expect(result.current).toBeUndefined();
  });

  it('clears the chip when the active guide flips to false (no stale value lingering)', () => {
    const { rerender, result } = renderHook(({ active }: { active: boolean }) => useStepProgressFromEvents(active), {
      initialProps: { active: true },
    });

    act(() => {
      dispatchProgress({ totalSteps: 7, completedCount: 3 });
    });
    expect(result.current).toBe('3/7');

    rerender({ active: false });
    expect(result.current).toBeUndefined();
  });

  it('unsubscribes on unmount (no leak)', () => {
    const removeSpy = jest.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => useStepProgressFromEvents(true));
    unmount();

    expect(removeSpy).toHaveBeenCalledWith('pathfinder-step-progress', expect.any(Function));
    removeSpy.mockRestore();
  });
});
