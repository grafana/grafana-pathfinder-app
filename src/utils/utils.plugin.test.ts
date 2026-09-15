/**
 * `POST /api/plugins/:id/settings` is a whole-object write: a body without
 * `pinned` unpins the plugin, and one without `enabled` disables it. Every
 * caller therefore has to read the current values back before writing, which is
 * what `fetchPluginSettings` exists for — `plugin.meta` is a snapshot from mount
 * and goes stale as soon as another tab saves.
 */

import { fetchPluginJsonData, fetchPluginSettings } from './utils.plugin';

const mockFetch = jest.fn();
jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({ fetch: mockFetch }),
}));

function respondsWith(data: unknown) {
  mockFetch.mockReturnValue({ subscribe: (observer: any) => observer.next({ data }) ?? observer.complete?.() });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('fetchPluginSettings', () => {
  it('reads back enabled and pinned alongside jsonData', async () => {
    respondsWith({ enabled: true, pinned: true, jsonData: { devMode: true } });

    await expect(fetchPluginSettings('grafana-pathfinder-app')).resolves.toEqual({
      enabled: true,
      pinned: true,
      jsonData: { devMode: true },
    });
  });

  it('treats a pinned plugin as pinned only when the API says so', async () => {
    respondsWith({ enabled: true, jsonData: {} });
    await expect(fetchPluginSettings('p')).resolves.toMatchObject({ pinned: false });
  });

  it('assumes enabled when the field is absent, since a disabled plugin is not rendering this', async () => {
    respondsWith({ jsonData: {} });
    await expect(fetchPluginSettings('p')).resolves.toMatchObject({ enabled: true });
  });

  it('reports a disabled plugin as disabled rather than defaulting it on', async () => {
    respondsWith({ enabled: false, jsonData: {} });
    await expect(fetchPluginSettings('p')).resolves.toMatchObject({ enabled: false });
  });

  it('yields an empty jsonData rather than undefined for a plugin never configured', async () => {
    respondsWith({ enabled: true, pinned: false });
    await expect(fetchPluginSettings('p')).resolves.toEqual({ enabled: true, pinned: false, jsonData: {} });
  });

  it('encodes the plugin id into the path', async () => {
    respondsWith({ jsonData: {} });
    await fetchPluginSettings('a/b');
    expect(mockFetch).toHaveBeenCalledWith(expect.objectContaining({ url: '/api/plugins/a%2Fb/settings' }));
  });
});

describe('fetchPluginJsonData', () => {
  it('still returns just the jsonData, for callers that only configure', async () => {
    respondsWith({ enabled: true, pinned: true, jsonData: { devMode: false } });
    await expect(fetchPluginJsonData('p')).resolves.toEqual({ devMode: false });
  });
});
