/**
 * Tests for useBadgeCelebrationQueue hook.
 * Uses renderHook and dispatches learning-progress-updated to drive queue.
 */

import { renderHook, act } from '@testing-library/react';
import { useBadgeCelebrationQueue } from './useBadgeCelebrationQueue';

jest.mock('../../../lib/user-storage', () => ({
  learningProgressStorage: {
    dismissCelebration: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('useBadgeCelebrationQueue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts with no current badge and zero queue count', () => {
    const { result } = renderHook(() => useBadgeCelebrationQueue());

    expect(result.current.currentCelebrationBadge).toBeNull();
    expect(result.current.queueCount).toBe(0);
    expect(typeof result.current.onDismiss).toBe('function');
  });

  it('adds badges to queue when learning-progress-updated fires with guide-completed', () => {
    const { result } = renderHook(() => useBadgeCelebrationQueue());

    act(() => {
      window.dispatchEvent(
        new CustomEvent('learning-progress-updated', {
          detail: { type: 'guide-completed', newBadges: ['badge-a', 'badge-b'] },
        })
      );
    });

    expect(result.current.queueCount).toBe(2);
  });

  it('caps new badges at 3', () => {
    const { result } = renderHook(() => useBadgeCelebrationQueue());

    act(() => {
      window.dispatchEvent(
        new CustomEvent('learning-progress-updated', {
          detail: { type: 'guide-completed', newBadges: ['a', 'b', 'c', 'd', 'e'] },
        })
      );
    });

    expect(result.current.queueCount).toBe(3);
  });

  it('ignores events without guide-completed type', () => {
    const { result } = renderHook(() => useBadgeCelebrationQueue());

    act(() => {
      window.dispatchEvent(
        new CustomEvent('learning-progress-updated', {
          detail: { type: 'other', newBadges: ['x'] },
        })
      );
    });

    expect(result.current.queueCount).toBe(0);
  });

  it('shows first badge as current after queue is processed', async () => {
    jest.useFakeTimers();
    const { result } = renderHook(() => useBadgeCelebrationQueue());

    act(() => {
      window.dispatchEvent(
        new CustomEvent('learning-progress-updated', {
          detail: { type: 'guide-completed', newBadges: ['first-badge'] },
        })
      );
    });

    await act(async () => {
      jest.runAllTimers();
    });

    expect(result.current.currentCelebrationBadge).toBe('first-badge');
    expect(result.current.queueCount).toBe(0);

    jest.useRealTimers();
  });

  it('onDismiss clears current badge and calls storage', async () => {
    const { learningProgressStorage } = require('../../../lib/user-storage');
    jest.useFakeTimers();
    const { result } = renderHook(() => useBadgeCelebrationQueue());

    act(() => {
      window.dispatchEvent(
        new CustomEvent('learning-progress-updated', {
          detail: { type: 'guide-completed', newBadges: ['to-dismiss'] },
        })
      );
    });

    await act(async () => {
      jest.runAllTimers();
    });

    expect(result.current.currentCelebrationBadge).toBe('to-dismiss');

    await act(async () => {
      await result.current.onDismiss();
    });

    expect(result.current.currentCelebrationBadge).toBeNull();
    expect(learningProgressStorage.dismissCelebration).toHaveBeenCalledWith('to-dismiss');

    jest.useRealTimers();
  });
});
