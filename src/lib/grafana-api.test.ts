import { fetchDataSources, fetchPlugins, fetchDashboardsByName } from './grafana-api';

const mockGet = jest.fn();
jest.mock('@grafana/runtime', () => ({ getBackendSrv: () => ({ get: mockGet }) }));
jest.mock('./logging', () => ({ logger: { warn: jest.fn() } }));

describe.each([
  { name: 'data sources', fetch: fetchDataSources, url: '/api/datasources', args: [] },
  { name: 'plugins', fetch: fetchPlugins, url: '/api/plugins', args: [] },
  {
    name: 'dashboards',
    fetch: (options: { throwOnError?: boolean } = {}) => fetchDashboardsByName('CPU usage', options),
    url: '/api/search',
    args: [{ type: 'dash-db', limit: 100, deleted: false, query: 'CPU usage' }],
  },
])('$name shared API', ({ fetch, url, args }) => {
  beforeEach(() => mockGet.mockReset());

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
