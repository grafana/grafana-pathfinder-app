import { renderHook, act } from '@testing-library/react';
import { useGuideProgressState } from './useGuideProgressState';

const mockHasProgress = jest.fn();
const mockGetMark = jest.fn();
jest.mock('../lib/user-storage', () => ({
  interactiveStepStorage: {
    hasProgress: (key: string) => mockHasProgress(key),
  },
  guideCompletionMarkStorage: {
    get: (key: string) => mockGetMark(key),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockHasProgress.mockResolvedValue(false);
  mockGetMark.mockResolvedValue(null);
});

describe('useGuideProgressState', () => {
  it('starts with hasInteractiveProgress false', () => {
    const { result } = renderHook(() => useGuideProgressState({ currentUrl: 'guide-a' }));
    expect(result.current.hasInteractiveProgress).toBe(false);
  });

  it('queries interactiveStepStorage.hasProgress with the active tab key', async () => {
    mockHasProgress.mockResolvedValue(true);
    const { result } = renderHook(() => useGuideProgressState({ currentUrl: 'guide-a' }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockHasProgress).toHaveBeenCalledWith('guide-a');
    expect(result.current.hasInteractiveProgress).toBe(true);
  });

  // A prose-only guide carries no step progress, so the mark is the only thing
  // that can make the per-guide reset affordance reachable after a reload.
  it('reports progress for a guide whose only progress is the completion mark', async () => {
    mockHasProgress.mockResolvedValue(false);
    mockGetMark.mockResolvedValue(true);
    const { result } = renderHook(() => useGuideProgressState({ currentUrl: 'guide-a' }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockGetMark).toHaveBeenCalledWith('guide-a');
    expect(result.current.hasInteractiveProgress).toBe(true);
  });

  it('reports no progress for a guide with neither steps nor a mark', async () => {
    const { result } = renderHook(() => useGuideProgressState({ currentUrl: 'guide-a' }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.hasInteractiveProgress).toBe(false);
  });

  it('falls back to baseUrl when currentUrl is missing', async () => {
    renderHook(() => useGuideProgressState({ baseUrl: 'guide-base' }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockHasProgress).toHaveBeenCalledWith('guide-base');
  });

  it('does not call hasProgress when no key is available', async () => {
    renderHook(() => useGuideProgressState(undefined));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockHasProgress).not.toHaveBeenCalled();
    expect(mockGetMark).not.toHaveBeenCalled();
  });

  it('resets hasInteractiveProgress when the progress key clears', async () => {
    mockHasProgress.mockResolvedValue(true);
    const { result, rerender } = renderHook(
      ({ tab }: { tab: { currentUrl?: string } | undefined }) => useGuideProgressState(tab),
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

  it('flips hasInteractiveProgress true on a matching pathfinder:progress (kind: guide) event', async () => {
    const { result } = renderHook(() => useGuideProgressState({ currentUrl: 'guide-a' }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.hasInteractiveProgress).toBe(false);

    act(() => {
      window.dispatchEvent(
        new CustomEvent('pathfinder:progress', {
          detail: { kind: 'guide', contentKey: 'guide-a', hasProgress: true, percentage: 25 },
        })
      );
    });

    expect(result.current.hasInteractiveProgress).toBe(true);
  });

  it('flips hasInteractiveProgress false on a matching interactive-progress-cleared event', async () => {
    mockHasProgress.mockResolvedValue(true);
    const { result } = renderHook(() => useGuideProgressState({ currentUrl: 'guide-a' }));

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
    const { result } = renderHook(() => useGuideProgressState({ currentUrl: 'guide-a' }));

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

  it('ignores pathfinder:progress (kind: guide) events for a different content key', async () => {
    const { result } = renderHook(() => useGuideProgressState({ currentUrl: 'guide-a' }));

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      window.dispatchEvent(
        new CustomEvent('pathfinder:progress', {
          detail: { kind: 'guide', contentKey: 'guide-b', hasProgress: true, percentage: 25 },
        })
      );
    });

    expect(result.current.hasInteractiveProgress).toBe(false);
  });
});
