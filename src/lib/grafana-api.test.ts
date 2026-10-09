import {
  DATA_SOURCES_FRESH_MS,
  fetchDataSources,
  fetchPlugins,
  fetchDashboardsByName,
  resetDataSourcesCacheForTests,
} from './grafana-api';

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
  beforeEach(() => {
    mockGet.mockReset();
    resetDataSourcesCacheForTests();
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

describe('data source reads shared across callers', () => {
  beforeEach(() => {
    mockGet.mockReset();
    resetDataSourcesCacheForTests();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('shares one request between concurrent callers', async () => {
    let resolve!: (value: unknown) => void;
    mockGet.mockReturnValue(new Promise((r) => (resolve = r)));
    const reads = Promise.all([fetchDataSources(), fetchDataSources({ throwOnError: true }), fetchDataSources()]);
    resolve([{ name: 'A' }]);
    await expect(reads).resolves.toEqual([[{ name: 'A' }], [{ name: 'A' }], [{ name: 'A' }]]);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('reuses a settled read for the freshness window, then fetches again', async () => {
    jest.useFakeTimers();
    mockGet.mockResolvedValueOnce([{ name: 'A' }]).mockResolvedValueOnce([{ name: 'A' }, { name: 'B' }]);
    await fetchDataSources();
    jest.advanceTimersByTime(DATA_SOURCES_FRESH_MS - 1);
    await expect(fetchDataSources()).resolves.toEqual([{ name: 'A' }]);
    jest.advanceTimersByTime(2);
    await expect(fetchDataSources()).resolves.toEqual([{ name: 'A' }, { name: 'B' }]);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('holds a failed read for the same window so repeated checks do not hammer the API', async () => {
    jest.useFakeTimers();
    mockGet.mockRejectedValue(new Error('down'));
    await expect(fetchDataSources({ throwOnError: true })).rejects.toThrow('down');
    await expect(fetchDataSources({ throwOnError: true })).rejects.toThrow('down');
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});
