import { renderHook, act } from '@testing-library/react';
import { useAlignmentReevaluation } from './useAlignmentReevaluation';
import {
  beginInteractiveNavigation,
  endInteractiveNavigation,
  __resetInteractiveNavigationForTesting,
} from '../global-state/interactive-navigation';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let listenCallback: ((location: { pathname: string }) => void) | null = null;
const mockUnlisten = jest.fn();
const mockListen = jest.fn((cb: (location: { pathname: string }) => void) => {
  listenCallback = cb;
  return mockUnlisten;
});

jest.mock('@grafana/runtime', () => ({
  locationService: {
    getHistory: () => ({ listen: mockListen }),
  },
}));

const mockHasProgress = jest.fn();
jest.mock('../lib/user-storage', () => ({
  interactiveStepStorage: {
    hasProgress: (key: string) => mockHasProgress(key),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePanel() {
  return { reevaluateAlignment: jest.fn() };
}

beforeEach(() => {
  jest.clearAllMocks();
  listenCallback = null;
  mockHasProgress.mockResolvedValue(false);
  __resetInteractiveNavigationForTesting();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAlignmentReevaluation', () => {
  describe('progress state', () => {
    it('starts with hasInteractiveProgress false', () => {
      const panel = makePanel();
      const { result } = renderHook(() => useAlignmentReevaluation(panel, 'tab-1', { currentUrl: 'guide-a' }));
      expect(result.current.hasInteractiveProgress).toBe(false);
    });

    it('queries interactiveStepStorage.hasProgress with the active tab key', async () => {
      mockHasProgress.mockResolvedValue(true);
      const panel = makePanel();
      const { result } = renderHook(() => useAlignmentReevaluation(panel, 'tab-1', { currentUrl: 'guide-a' }));

      await act(async () => {
        await Promise.resolve();
      });

      expect(mockHasProgress).toHaveBeenCalledWith('guide-a');
      expect(result.current.hasInteractiveProgress).toBe(true);
    });

    it('falls back to baseUrl when currentUrl is missing', async () => {
      const panel = makePanel();
      renderHook(() => useAlignmentReevaluation(panel, 'tab-1', { baseUrl: 'guide-base' }));

      await act(async () => {
        await Promise.resolve();
      });

      expect(mockHasProgress).toHaveBeenCalledWith('guide-base');
    });

    it('does not call hasProgress when no key is available', async () => {
      const panel = makePanel();
      renderHook(() => useAlignmentReevaluation(panel, 'tab-1', undefined));

      await act(async () => {
        await Promise.resolve();
      });

      expect(mockHasProgress).not.toHaveBeenCalled();
    });

    it('resets hasInteractiveProgress when the progress key clears', async () => {
      mockHasProgress.mockResolvedValue(true);
      const panel = makePanel();
      const { result, rerender } = renderHook(
        ({ tab }: { tab: { currentUrl?: string } | undefined }) => useAlignmentReevaluation(panel, 'tab-1', tab),
        { initialProps: { tab: { currentUrl: 'guide-a' } } as { tab: { currentUrl?: string } | undefined } }
      );

      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.hasInteractiveProgress).toBe(true);

      mockHasProgress.mockResolvedValue(false);
      rerender({ tab: undefined });
      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.hasInteractiveProgress).toBe(false);
    });

    it('flips hasInteractiveProgress true on a matching interactive-progress-saved event', async () => {
      const panel = makePanel();
      const { result } = renderHook(() => useAlignmentReevaluation(panel, 'tab-1', { currentUrl: 'guide-a' }));

      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.hasInteractiveProgress).toBe(false);

      act(() => {
        window.dispatchEvent(
          new CustomEvent('interactive-progress-saved', {
            detail: { contentKey: 'guide-a', hasProgress: true },
          })
        );
      });

      expect(result.current.hasInteractiveProgress).toBe(true);
    });

    it('flips hasInteractiveProgress false on a matching interactive-progress-cleared event', async () => {
      mockHasProgress.mockResolvedValue(true);
      const panel = makePanel();
      const { result } = renderHook(() => useAlignmentReevaluation(panel, 'tab-1', { currentUrl: 'guide-a' }));

      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.hasInteractiveProgress).toBe(true);

      act(() => {
        window.dispatchEvent(
          new CustomEvent('interactive-progress-cleared', {
            detail: { contentKey: 'guide-a' },
          })
        );
      });

      expect(result.current.hasInteractiveProgress).toBe(false);
    });

    it('ignores interactive-progress-cleared events for a different content key', async () => {
      mockHasProgress.mockResolvedValue(true);
      const panel = makePanel();
      const { result } = renderHook(() => useAlignmentReevaluation(panel, 'tab-1', { currentUrl: 'guide-a' }));

      await act(async () => {
        await Promise.resolve();
      });

      act(() => {
        window.dispatchEvent(
          new CustomEvent('interactive-progress-cleared', {
            detail: { contentKey: 'guide-b' },
          })
        );
      });

      expect(result.current.hasInteractiveProgress).toBe(true);
    });

    it('ignores interactive-progress-saved events for a different content key', async () => {
      const panel = makePanel();
      const { result } = renderHook(() => useAlignmentReevaluation(panel, 'tab-1', { currentUrl: 'guide-a' }));

      await act(async () => {
        await Promise.resolve();
      });

      act(() => {
        window.dispatchEvent(
          new CustomEvent('interactive-progress-saved', {
            detail: { contentKey: 'guide-b', hasProgress: true },
          })
        );
      });

      expect(result.current.hasInteractiveProgress).toBe(false);
    });
  });

  describe('location listener', () => {
    it('subscribes on mount and unsubscribes on unmount', () => {
      const panel = makePanel();
      const { unmount } = renderHook(() => useAlignmentReevaluation(panel, 'tab-1', { currentUrl: 'guide-a' }));

      expect(mockListen).toHaveBeenCalledTimes(1);

      unmount();
      expect(mockUnlisten).toHaveBeenCalledTimes(1);
    });

    it('calls panel.reevaluateAlignment on location changes while no progress', async () => {
      const panel = makePanel();
      renderHook(() => useAlignmentReevaluation(panel, 'tab-1', { currentUrl: 'guide-a' }));

      await act(async () => {
        await Promise.resolve();
      });

      act(() => {
        listenCallback?.({ pathname: '/explore/metrics' });
      });

      expect(panel.reevaluateAlignment).toHaveBeenCalledWith('tab-1', '/explore/metrics');
    });

    it('does not call reevaluateAlignment once hasInteractiveProgress is true', async () => {
      mockHasProgress.mockResolvedValue(true);
      const panel = makePanel();
      renderHook(() => useAlignmentReevaluation(panel, 'tab-1', { currentUrl: 'guide-a' }));

      await act(async () => {
        await Promise.resolve();
      });

      act(() => {
        listenCallback?.({ pathname: '/explore/metrics' });
      });

      expect(panel.reevaluateAlignment).not.toHaveBeenCalled();
    });

    it('skips reevaluation while an interactive navigation is in progress', async () => {
      const panel = makePanel();
      renderHook(() => useAlignmentReevaluation(panel, 'tab-1', { currentUrl: 'guide-a' }));

      await act(async () => {
        await Promise.resolve();
      });

      // Simulate the navigate-handler tagging a guide-driven push.
      beginInteractiveNavigation();
      try {
        act(() => {
          listenCallback?.({ pathname: '/explore/metrics' });
        });
      } finally {
        endInteractiveNavigation();
      }

      expect(panel.reevaluateAlignment).not.toHaveBeenCalled();
    });

    it('skips reevaluation when activeTabId is undefined', async () => {
      const panel = makePanel();
      renderHook(() => useAlignmentReevaluation(panel, undefined, { currentUrl: 'guide-a' }));

      await act(async () => {
        await Promise.resolve();
      });

      act(() => {
        listenCallback?.({ pathname: '/explore/metrics' });
      });

      expect(panel.reevaluateAlignment).not.toHaveBeenCalled();
    });

    it.each(['recommendations', 'editor', 'devtools'])(
      'skips reevaluation when activeTabId is %s',
      async (excludedId) => {
        const panel = makePanel();
        renderHook(() => useAlignmentReevaluation(panel, excludedId, { currentUrl: 'guide-a' }));

        await act(async () => {
          await Promise.resolve();
        });

        act(() => {
          listenCallback?.({ pathname: '/explore/metrics' });
        });

        expect(panel.reevaluateAlignment).not.toHaveBeenCalled();
      }
    );

    it('uses the latest activeTabId when navigation fires after a tab switch', async () => {
      const panel = makePanel();
      const { rerender } = renderHook(
        ({ tabId }: { tabId: string }) => useAlignmentReevaluation(panel, tabId, { currentUrl: 'guide-a' }),
        { initialProps: { tabId: 'tab-1' } }
      );

      await act(async () => {
        await Promise.resolve();
      });

      rerender({ tabId: 'tab-2' });

      act(() => {
        listenCallback?.({ pathname: '/explore/metrics' });
      });

      expect(panel.reevaluateAlignment).toHaveBeenCalledWith('tab-2', '/explore/metrics');
    });
  });
});
