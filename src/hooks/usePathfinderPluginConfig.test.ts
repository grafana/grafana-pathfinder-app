import { act, renderHook, waitFor } from '@testing-library/react';
import { usePluginContext } from '@grafana/data';
import { getConfigWithDefaults } from '../constants';
import { PATHFINDER_CONFIG_UPDATED_EVENT } from '../lib/event-names';
import { fetchPluginJsonData } from '../utils/utils.plugin';
import {
  __resetPathfinderPluginConfigForTests,
  publishPathfinderPluginConfig,
  refreshPathfinderPluginConfig,
  usePathfinderPluginConfig,
} from './usePathfinderPluginConfig';

jest.mock('../utils/utils.plugin', () => ({
  fetchPluginJsonData: jest.fn(),
}));

jest.mock('@grafana/data', () => ({
  ...jest.requireActual('@grafana/data'),
  usePluginContext: jest.fn(),
}));

const mockFetch = fetchPluginJsonData as jest.MockedFunction<typeof fetchPluginJsonData>;
const mockPluginContext = usePluginContext as unknown as jest.Mock;

function readGlobal() {
  return (window as Window & { __pathfinderPluginConfig?: ReturnType<typeof getConfigWithDefaults> })
    .__pathfinderPluginConfig;
}

/** Flush the mount-time refresh so later publishes are not clobbered by it. */
async function settleRefresh() {
  await act(async () => {
    await refreshPathfinderPluginConfig();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetPathfinderPluginConfigForTests();
  mockFetch.mockResolvedValue({});
  mockPluginContext.mockReturnValue(null);
});

describe('publishPathfinderPluginConfig', () => {
  it('writes the defaulted config to the readiness global', () => {
    const published = publishPathfinderPluginConfig({ devMode: true, devModeUserIds: [7] });

    expect(readGlobal()).toBe(published);
    expect(published.devMode).toBe(true);
    expect(published.devModeUserIds).toEqual([7]);
    // Defaults are applied, not just the supplied fields.
    expect(published.tutorialUrl).toBe(getConfigWithDefaults({}).tutorialUrl);
  });

  it('dispatches a payload-free event so subscribers cannot be fed a forged config', () => {
    const listener = jest.fn();
    document.addEventListener(PATHFINDER_CONFIG_UPDATED_EVENT, listener);

    publishPathfinderPluginConfig({ devMode: true, devModeUserIds: [7] });

    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toBeNull();

    document.removeEventListener(PATHFINDER_CONFIG_UPDATED_EVENT, listener);
  });

  it('keeps the existing identity and skips the event when nothing changed', () => {
    const first = publishPathfinderPluginConfig({ devMode: true, devModeUserIds: [7] });

    const listener = jest.fn();
    document.addEventListener(PATHFINDER_CONFIG_UPDATED_EVENT, listener);
    const second = publishPathfinderPluginConfig({ devMode: true, devModeUserIds: [7] });

    expect(second).toBe(first);
    expect(listener).not.toHaveBeenCalled();

    document.removeEventListener(PATHFINDER_CONFIG_UPDATED_EVENT, listener);
  });

  it('republishes when a value actually changes', () => {
    const first = publishPathfinderPluginConfig({ devModeUserIds: [7] });
    const second = publishPathfinderPluginConfig({ devModeUserIds: [7, 8] });

    expect(second).not.toBe(first);
    expect(second.devModeUserIds).toEqual([7, 8]);
  });
});

describe('refreshPathfinderPluginConfig', () => {
  it('coalesces concurrent callers into a single request', async () => {
    await Promise.all([
      refreshPathfinderPluginConfig(),
      refreshPathfinderPluginConfig(),
      refreshPathfinderPluginConfig(),
    ]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('publishes the fetched settings', async () => {
    mockFetch.mockResolvedValue({ enableLiveSessions: true });

    const refreshed = await refreshPathfinderPluginConfig();

    expect(refreshed?.enableLiveSessions).toBe(true);
    expect(readGlobal()?.enableLiveSessions).toBe(true);
  });

  it('resolves undefined and leaves the published config alone on failure', async () => {
    publishPathfinderPluginConfig({ enableLiveSessions: true });
    mockFetch.mockRejectedValue(new Error('403'));

    await expect(refreshPathfinderPluginConfig()).resolves.toBeUndefined();
    expect(readGlobal()?.enableLiveSessions).toBe(true);
  });
});

describe('usePathfinderPluginConfig', () => {
  it('reports isResolved false with no published config and no plugin context', () => {
    const { result } = renderHook(() => usePathfinderPluginConfig());

    expect(result.current.isResolved).toBe(false);
    expect(result.current.config.devMode).toBe(false);
  });

  it('prefers the published global over the plugin context snapshot', () => {
    publishPathfinderPluginConfig({ devMode: true, devModeUserIds: [7] });
    mockPluginContext.mockReturnValue({ meta: { jsonData: { devMode: false } } });

    const { result } = renderHook(() => usePathfinderPluginConfig());

    expect(result.current.isResolved).toBe(true);
    expect(result.current.config.devMode).toBe(true);
  });

  it('falls back to the plugin context when nothing is published yet', () => {
    mockPluginContext.mockReturnValue({ meta: { jsonData: { enableLiveSessions: true } } });

    const { result } = renderHook(() => usePathfinderPluginConfig());

    expect(result.current.isResolved).toBe(true);
    expect(result.current.config.enableLiveSessions).toBe(true);
  });

  it('treats an empty jsonData on a present meta as resolved', () => {
    mockPluginContext.mockReturnValue({ meta: {} });

    const { result } = renderHook(() => usePathfinderPluginConfig());

    expect(result.current.isResolved).toBe(true);
  });

  it('adopts a later publish via the config-updated event', async () => {
    mockFetch.mockRejectedValue(new Error('403'));
    const { result } = renderHook(() => usePathfinderPluginConfig());
    await settleRefresh();
    expect(result.current.isResolved).toBe(false);

    act(() => {
      publishPathfinderPluginConfig({ devMode: true, devModeUserIds: [7] });
    });

    expect(result.current.isResolved).toBe(true);
    expect(result.current.config.devMode).toBe(true);
  });

  it('ignores a forged config carried as event detail', async () => {
    publishPathfinderPluginConfig({ devMode: false });
    const { result } = renderHook(() => usePathfinderPluginConfig());
    await waitFor(() => expect(result.current.isResolved).toBe(true));

    act(() => {
      document.dispatchEvent(
        new CustomEvent(PATHFINDER_CONFIG_UPDATED_EVENT, { detail: { devMode: true, devModeUserIds: [7] } })
      );
    });

    expect(result.current.config.devMode).toBe(false);
  });

  it('keeps a stable state identity when a publish changes nothing', async () => {
    mockFetch.mockResolvedValue({ enableLiveSessions: true });
    const { result } = renderHook(() => usePathfinderPluginConfig());
    await settleRefresh();
    const first = result.current;
    expect(first.config.enableLiveSessions).toBe(true);

    act(() => {
      publishPathfinderPluginConfig({ enableLiveSessions: true });
    });

    expect(result.current).toBe(first);
  });

  it('stops responding to publishes after unmount', async () => {
    mockFetch.mockRejectedValue(new Error('403'));
    const { result, unmount } = renderHook(() => usePathfinderPluginConfig());
    await settleRefresh();
    const last = result.current;
    unmount();

    expect(() => publishPathfinderPluginConfig({ devMode: true, devModeUserIds: [7] })).not.toThrow();
    expect(result.current).toBe(last);
  });

  it('shares one request across concurrent mounts', async () => {
    renderHook(() => usePathfinderPluginConfig());
    renderHook(() => usePathfinderPluginConfig());
    renderHook(() => usePathfinderPluginConfig());

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  });

  it('publishes the fetched config for non-React readers of the global', async () => {
    mockFetch.mockResolvedValue({ enableLiveSessions: true });

    const { result } = renderHook(() => usePathfinderPluginConfig());

    await waitFor(() => expect(result.current.config.enableLiveSessions).toBe(true));
    expect(readGlobal()?.enableLiveSessions).toBe(true);
  });
});

describe('getConfigWithDefaults idempotence', () => {
  // The hook feeds an already-defaulted config back through the defaulter, so a
  // second pass must be a no-op — including the isKnownRecommenderUrl branch.
  it.each([
    ['empty', {}],
    ['custom recommender', { recommenderServiceUrl: 'https://recommender.example.com' }],
    ['known recommender', { recommenderServiceUrl: getConfigWithDefaults({}).recommenderServiceUrl }],
  ])('is idempotent for %s', (_label, input) => {
    const once = getConfigWithDefaults(input);
    expect(getConfigWithDefaults(once)).toEqual(once);
  });
});
