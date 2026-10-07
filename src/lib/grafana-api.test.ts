import { fetchDashboardSummary, fetchDataSources, fetchPluginPresence, fetchDashboardsByName } from './grafana-api';

const mockGet = jest.fn();
const mockSearchCoreDashboards = jest.fn();
const mockFetchCoreDashboard = jest.fn();
const mockUnstable: { getPluginSettings?: jest.Mock } = {};
jest.mock('@grafana/runtime', () => ({ getBackendSrv: () => ({ get: mockGet }) }));
jest.mock('@grafana/runtime/unstable', () => ({
  get getPluginSettings() {
    return mockUnstable.getPluginSettings;
  },
}));
jest.mock('./grafana-core-client', () => ({
  searchCoreDashboards: (query: string) => mockSearchCoreDashboards(query),
  fetchCoreDashboard: (uid: string) => mockFetchCoreDashboard(uid),
}));
jest.mock('./logging', () => ({ logger: { warn: jest.fn() } }));
let mockPlatform = 'oss';
jest.mock('./platform', () => ({ currentPlatform: () => mockPlatform }));
const mockListDataSources = jest.fn();
const mockGetDataSourceSettings = jest.fn();
jest.mock('./datasource/datasource-registry', () => ({
  listDataSources: (...args: unknown[]) => mockListDataSources(...args),
  getDataSourceSettings: (uid: string) => mockGetDataSourceSettings(uid),
}));

describe('fetchDataSources', () => {
  const settings = (uid: string, overrides: Record<string, unknown> = {}) => ({
    id: 4,
    uid,
    name: `DS ${uid}`,
    type: 'prometheus',
    url: '/api/datasources/proxy/4',
    isDefault: false,
    access: 'proxy',
    jsonData: { notExposed: true },
    ...overrides,
  });

  beforeEach(() => {
    mockListDataSources.mockReset();
    mockGetDataSourceSettings.mockReset();
  });

  it('resolves every listed data source to the context shape without a legacy list call', async () => {
    mockListDataSources.mockResolvedValue([{ uid: 'a' }, { uid: 'b' }]);
    mockGetDataSourceSettings.mockImplementation(async (uid: string) => settings(uid, { isDefault: uid === 'a' }));

    await expect(fetchDataSources()).resolves.toEqual([
      {
        id: 4,
        uid: 'a',
        name: 'DS a',
        type: 'prometheus',
        url: '/api/datasources/proxy/4',
        isDefault: true,
        access: 'proxy',
      },
      expect.objectContaining({ uid: 'b', isDefault: false }),
    ]);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('lists every plugin type but leaves out built-in pseudo data sources', async () => {
    mockListDataSources.mockResolvedValue([]);
    await fetchDataSources();

    const [filters] = mockListDataSources.mock.calls[0];
    expect(filters.all).toBe(true);
    expect(filters.filter({ meta: { builtIn: true } })).toBe(false);
    expect(filters.filter({ meta: {} })).toBe(true);
  });

  it('drops a listed data source whose settings are gone', async () => {
    mockListDataSources.mockResolvedValue([{ uid: 'a' }, { uid: 'gone' }]);
    mockGetDataSourceSettings.mockImplementation(async (uid: string) => (uid === 'gone' ? undefined : settings(uid)));
    await expect(fetchDataSources()).resolves.toEqual([expect.objectContaining({ uid: 'a' })]);
  });

  it('keeps the forgiving context path but propagates requirement failures', async () => {
    const failure = new Error('srv not ready');
    mockListDataSources.mockRejectedValue(failure);
    await expect(fetchDataSources()).resolves.toEqual([]);
    await expect(fetchDataSources({ throwOnError: true })).rejects.toBe(failure);
  });
});

describe.each([
  {
    name: 'dashboards',
    fetch: (options: { throwOnError?: boolean } = {}) => fetchDashboardsByName('CPU usage', options),
    url: '/api/search',
    args: [{ type: 'dash-db', limit: 100, deleted: false, query: 'CPU usage' }],
  },
])('$name shared API', ({ fetch, url, args }) => {
  beforeEach(() => {
    mockGet.mockReset();
    mockSearchCoreDashboards.mockResolvedValue(undefined);
  });

  it('returns the backend result without changing query semantics', async () => {
    const result = [{ id: 1 }];
    mockGet.mockResolvedValue(result);
    await expect(fetch()).resolves.toBe(result);
    expect(mockGet).toHaveBeenCalledWith(url, ...args);
  });

  it('keeps absent results empty', async () => {
    mockGet.mockResolvedValue(null);
    await expect(fetch()).resolves.toEqual([]);
  });

  it('keeps the forgiving context path but propagates requirement failures', async () => {
    const failure = new Error('backend unavailable');
    mockGet.mockRejectedValue(failure);
    await expect(fetch()).resolves.toEqual([]);
    await expect(fetch({ throwOnError: true })).rejects.toBe(failure);
  });
});

describe('fetchDashboardsByName through the core proxy', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockSearchCoreDashboards.mockReset();
  });

  it('serves proxied hits without touching the legacy search endpoint', async () => {
    const hits = [{ uid: 'abc', title: 'CPU usage', tags: [] }];
    mockSearchCoreDashboards.mockResolvedValue(hits);
    await expect(fetchDashboardsByName('CPU usage')).resolves.toBe(hits);
    expect(mockSearchCoreDashboards).toHaveBeenCalledWith('CPU usage');
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('falls back to the legacy search endpoint when the proxy cannot answer', async () => {
    mockSearchCoreDashboards.mockResolvedValue(undefined);
    mockGet.mockResolvedValue([{ uid: 'abc', title: 'CPU usage' }]);
    await expect(fetchDashboardsByName('CPU usage')).resolves.toEqual([{ uid: 'abc', title: 'CPU usage' }]);
    expect(mockGet).toHaveBeenCalledWith('/api/search', expect.objectContaining({ query: 'CPU usage' }));
  });
});

describe('fetchPluginPresence', () => {
  beforeEach(() => {
    mockGet.mockReset();
    delete mockUnstable.getPluginSettings;
  });

  it('prefers the runtime plugin-settings API when the host provides it', async () => {
    mockUnstable.getPluginSettings = jest.fn().mockResolvedValue({ enabled: false });
    await expect(fetchPluginPresence('grafana-clock-panel')).resolves.toEqual({ installed: true, enabled: false });
    expect(mockUnstable.getPluginSettings).toHaveBeenCalledWith('grafana-clock-panel', false);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('falls back to the per-plugin settings endpoint on older hosts', async () => {
    mockGet.mockResolvedValue({ enabled: true });
    await expect(fetchPluginPresence('grafana clock')).resolves.toEqual({ installed: true, enabled: true });
    expect(mockGet).toHaveBeenCalledWith('/api/plugins/grafana%20clock/settings', undefined, undefined, {
      showErrorAlert: false,
    });
  });

  it.each([
    ['a direct 404', { status: 404 }],
    ['a wrapped 404', new Error('Unknown Plugin', { cause: { status: 404 } })],
  ])('reports %s as not installed', async (_label, failure) => {
    mockGet.mockRejectedValue(failure);
    await expect(fetchPluginPresence('missing')).resolves.toEqual({ installed: false, enabled: false });
  });

  it('propagates failures that do not prove absence', async () => {
    const failure = { status: 500 };
    mockGet.mockRejectedValue(failure);
    await expect(fetchPluginPresence('grafana-clock-panel')).rejects.toBe(failure);
  });
});

describe('fetchDashboardSummary', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockFetchCoreDashboard.mockReset();
  });

  it('serves the proxied summary when the proxy answers', async () => {
    const summary = { uid: 'd1', title: 'CPU', tags: ['k8s'], folderUid: 'f1', folderTitle: 'Infra' };
    mockFetchCoreDashboard.mockResolvedValue(summary);
    await expect(fetchDashboardSummary('d1')).resolves.toBe(summary);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('falls back to the legacy dashboard endpoint', async () => {
    mockFetchCoreDashboard.mockResolvedValue(undefined);
    mockGet.mockResolvedValue({
      dashboard: { uid: 'd 1', title: 'CPU', tags: ['k8s'] },
      meta: { folderUid: 'f1', folderTitle: 'Infra' },
    });
    await expect(fetchDashboardSummary('d 1')).resolves.toEqual({
      uid: 'd 1',
      title: 'CPU',
      tags: ['k8s'],
      folderUid: 'f1',
      folderTitle: 'Infra',
    });
    expect(mockGet).toHaveBeenCalledWith('/api/dashboards/uid/d%201');
  });

  it('resolves null when neither path can answer', async () => {
    mockFetchCoreDashboard.mockResolvedValue(undefined);
    mockGet.mockRejectedValue(new Error('offline'));
    await expect(fetchDashboardSummary('d1')).resolves.toBeNull();
  });
});

describe('legacy fallbacks on Grafana Cloud', () => {
  beforeEach(() => {
    mockPlatform = 'cloud';
    mockGet.mockReset();
    mockSearchCoreDashboards.mockResolvedValue(undefined);
    mockFetchCoreDashboard.mockResolvedValue(undefined);
  });

  afterEach(() => {
    mockPlatform = 'oss';
  });

  it('reports dashboard search unavailable instead of calling the legacy endpoint', async () => {
    await expect(fetchDashboardsByName('CPU', { throwOnError: true })).rejects.toThrow('unavailable');
    await expect(fetchDashboardsByName('CPU')).resolves.toEqual([]);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('reports plugin presence unavailable when the host lacks the runtime plugin-settings API', async () => {
    delete mockUnstable.getPluginSettings;
    await expect(fetchPluginPresence('grafana-clock-panel')).rejects.toThrow('unavailable');
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('resolves no dashboard summary instead of calling the legacy endpoint', async () => {
    await expect(fetchDashboardSummary('d1')).resolves.toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });
});
