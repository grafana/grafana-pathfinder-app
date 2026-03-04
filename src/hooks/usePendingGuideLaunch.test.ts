import { renderHook, act } from '@testing-library/react';
import { usePendingGuideLaunch } from './usePendingGuideLaunch';
import { sidebarState } from '../global-state/sidebar';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(),
}));

jest.mock('../global-state/sidebar', () => ({
  sidebarState: {
    openWithGuide: jest.fn(),
    getIsSidebarMounted: jest.fn().mockReturnValue(false),
  },
}));

import { getBackendSrv } from '@grafana/runtime';

const mockGet = jest.fn();
const mockPost = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();

  (getBackendSrv as jest.Mock).mockReturnValue({
    get: mockGet,
    post: mockPost,
  });
  mockGet.mockResolvedValue({});
  mockPost.mockResolvedValue({});
});

afterEach(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePendingGuideLaunch', () => {
  it('polls the pending-launch endpoint on mount', async () => {
    renderHook(() => usePendingGuideLaunch());

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockGet).toHaveBeenCalledWith('/api/plugins/grafana-pathfinder-app/resources/mcp/pending-launch');
  });

  it('does nothing when response has no guideId', async () => {
    mockGet.mockResolvedValue({});

    renderHook(() => usePendingGuideLaunch());

    await act(async () => {
      await Promise.resolve();
    });

    expect(sidebarState.openWithGuide).not.toHaveBeenCalled();
  });

  it('calls openWithGuide and clears when guideId is present', async () => {
    mockGet.mockResolvedValue({ guideId: 'prometheus-grafana-101' });

    renderHook(() => usePendingGuideLaunch());

    await act(async () => {
      await Promise.resolve();
    });

    expect(sidebarState.openWithGuide).toHaveBeenCalledWith('prometheus-grafana-101');
    expect(mockPost).toHaveBeenCalledWith('/api/plugins/grafana-pathfinder-app/resources/mcp/pending-launch/clear', {});
  });

  it('clears before opening the guide', async () => {
    const callOrder: string[] = [];
    mockGet.mockResolvedValue({ guideId: 'first-dashboard' });
    mockPost.mockImplementation(() => {
      callOrder.push('clear');
      return Promise.resolve({});
    });
    (sidebarState.openWithGuide as jest.Mock).mockImplementation(() => {
      callOrder.push('open');
    });

    renderHook(() => usePendingGuideLaunch());

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve(); // allow clear to settle
    });

    expect(callOrder[0]).toBe('clear');
    expect(callOrder[1]).toBe('open');
  });

  it('polls again after the interval', async () => {
    renderHook(() => usePendingGuideLaunch());

    await act(async () => {
      await Promise.resolve();
    });
    expect(mockGet).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('clears the interval on unmount', async () => {
    const { unmount } = renderHook(() => usePendingGuideLaunch());

    await act(async () => {
      await Promise.resolve();
    });
    const callCountAfterMount = mockGet.mock.calls.length;

    unmount();

    await act(async () => {
      jest.advanceTimersByTime(10000);
      await Promise.resolve();
    });

    // No new calls after unmount
    expect(mockGet).toHaveBeenCalledTimes(callCountAfterMount);
  });

  it('does not call openWithGuide a second time while a launch is in flight', async () => {
    // Both polls return a pending guide
    mockGet.mockResolvedValue({ guideId: 'welcome-to-grafana' });

    // Hold the clear POST open so the second poll fires while first is still running
    let resolveClear!: () => void;
    mockPost.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveClear = resolve;
      })
    );

    renderHook(() => usePendingGuideLaunch());

    // First poll: get() resolves → isLaunching = true → awaiting post
    await act(async () => {
      await Promise.resolve();
    });

    // Second poll fires while first is still awaiting the clear post
    await act(async () => {
      jest.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    // openWithGuide not yet called (blocked on pending post)
    expect(sidebarState.openWithGuide).toHaveBeenCalledTimes(0);

    // Resolve the clear — first poll completes and calls openWithGuide
    await act(async () => {
      resolveClear();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Only one launch despite two polls seeing the same pending guide
    expect(sidebarState.openWithGuide).toHaveBeenCalledTimes(1);
  });

  it('continues polling after a network error', async () => {
    mockGet.mockRejectedValueOnce(new Error('network error'));
    mockGet.mockResolvedValue({});

    renderHook(() => usePendingGuideLaunch());

    await act(async () => {
      await Promise.resolve();
    });

    // Advance to next poll — should not throw
    await act(async () => {
      jest.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(sidebarState.openWithGuide).not.toHaveBeenCalled();
  });

  it('proceeds with launch even if clear fails', async () => {
    mockGet.mockResolvedValue({ guideId: 'loki-grafana-101' });
    mockPost.mockRejectedValue(new Error('clear failed'));

    renderHook(() => usePendingGuideLaunch());

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sidebarState.openWithGuide).toHaveBeenCalledWith('loki-grafana-101');
  });
});
