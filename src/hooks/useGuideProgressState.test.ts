import { renderHook, act } from '@testing-library/react';
import { useGuideProgressState } from './useGuideProgressState';

const mockHasProgress = jest.fn();
jest.mock('../lib/user-storage', () => ({
  interactiveStepStorage: {
    hasProgress: (key: string) => mockHasProgress(key),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockHasProgress.mockResolvedValue(false);
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

  it('flips hasInteractiveProgress false on a matching content reset', async () => {
    mockHasProgress.mockResolvedValue(true);
    const { result } = renderHook(() => useGuideProgressState({ currentUrl: 'guide-a' }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.hasInteractiveProgress).toBe(true);

    act(() => {
      window.dispatchEvent(
        new CustomEvent('interactive-progress-cleared', {
          detail: { scope: 'content', contentKey: 'guide-a' },
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
          detail: { scope: 'content', contentKey: 'guide-b' },
        })
      );
    });

    expect(result.current.hasInteractiveProgress).toBe(true);
  });

  it('ignores section resets and handles path and global resets explicitly', async () => {
    mockHasProgress.mockResolvedValue(true);
    const { result } = renderHook(() => useGuideProgressState({ currentUrl: 'guide-a' }));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      window.dispatchEvent(
        new CustomEvent('interactive-progress-cleared', {
          detail: { scope: 'section', contentKey: 'guide-a', sectionId: 'section-a' },
        })
      );
    });
    expect(result.current.hasInteractiveProgress).toBe(true);

    act(() => {
      window.dispatchEvent(
        new CustomEvent('interactive-progress-cleared', {
          detail: { scope: 'path', pathId: 'path-a', contentKeys: ['guide-a'] },
        })
      );
    });
    expect(result.current.hasInteractiveProgress).toBe(false);

    act(() => {
      window.dispatchEvent(
        new CustomEvent('pathfinder:progress', {
          detail: { kind: 'guide', contentKey: 'guide-a', hasProgress: true, percentage: 25 },
        })
      );
      window.dispatchEvent(new CustomEvent('interactive-progress-cleared', { detail: { scope: 'global' } }));
    });
    expect(result.current.hasInteractiveProgress).toBe(false);
  });

  it('uses matching guide progress events for both true and false state', async () => {
    const { result } = renderHook(() => useGuideProgressState({ currentUrl: 'guide-a' }));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      window.dispatchEvent(
        new CustomEvent('pathfinder:progress', {
          detail: { kind: 'guide', contentKey: 'guide-a', hasProgress: true, percentage: 25 },
        })
      );
      window.dispatchEvent(
        new CustomEvent('pathfinder:progress', {
          detail: { kind: 'guide', contentKey: 'guide-a', hasProgress: false, percentage: 0 },
        })
      );
    });

    expect(result.current.hasInteractiveProgress).toBe(false);
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
