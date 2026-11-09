import { fetchEligibleCatalog, resetEligibleCatalogCacheForTests } from './eligible-catalog-client';
import { getRecommenderStackContext } from './recommender-context';

jest.mock('./recommender-context', () => ({
  getRecommenderStackContext: jest.fn(),
}));
jest.mock('../utils/dev-mode', () => ({ isDevModeEnabledGlobal: () => false }));

const serviceUrl = 'https://recommender.grafana.com';
const payload = {
  packages: [
    {
      id: 'healthy-guide',
      title: 'Healthy guide',
      repository: 'interactive-tutorials',
      contentUrl: 'https://interactive-learning.grafana.net/packages/healthy-guide/content.json',
      manifestUrl: 'https://interactive-learning.grafana.net/packages/healthy-guide/manifest.json',
      manifest: { id: 'healthy-guide', type: 'guide', category: 'dashboards', estimatedMinutes: 5 },
    },
  ],
};
const fetchMock = jest.fn();
const originalFetch = global.fetch;

beforeEach(() => {
  resetEligibleCatalogCacheForTests();
  jest.resetAllMocks();
  global.fetch = fetchMock;
  jest.mocked(getRecommenderStackContext).mockReturnValue({ source: 'private.grafana.net', platform: 'cloud' });
  fetchMock.mockResolvedValue({ ok: true, json: async () => payload });
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});
afterAll(() => {
  global.fetch = originalFetch;
});

it('posts only stack context to the separate catalog endpoint and maps metadata', async () => {
  const result = await fetchEligibleCatalog(serviceUrl, 'org-a:user-a');
  expect(fetchMock).toHaveBeenCalledWith(
    `${serviceUrl}/api/v1/catalog`,
    expect.objectContaining({
      method: 'POST',
      credentials: 'omit',
      body: JSON.stringify({ source: 'private.grafana.net', platform: 'cloud' }),
    })
  );
  expect(result).toMatchObject({
    available: true,
    items: [{ id: 'healthy-guide', estimatedMinutes: 5, category: 'dashboards' }],
  });
});

it('deduplicates concurrent requests and reuses a fresh result', async () => {
  await Promise.all([fetchEligibleCatalog(serviceUrl, 'a'), fetchEligibleCatalog(serviceUrl, 'a')]);
  await fetchEligibleCatalog(serviceUrl, 'a');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('silently retains the last valid result after expired refreshes fail', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
  const first = await fetchEligibleCatalog(serviceUrl, 'a');
  now.mockReturnValue(301_000);
  fetchMock.mockRejectedValueOnce(new Error('offline'));
  expect(await fetchEligibleCatalog(serviceUrl, 'a')).toEqual(first);
  expect(await fetchEligibleCatalog(serviceUrl, 'a')).toEqual(first);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('does not reuse another scope’s results and permits explicit retry after a cold failure', async () => {
  await fetchEligibleCatalog(serviceUrl, 'a');
  fetchMock.mockRejectedValueOnce(new Error('offline'));
  expect(await fetchEligibleCatalog(serviceUrl, 'b')).toEqual({ items: [], available: false });
  expect((await fetchEligibleCatalog(serviceUrl, 'b', { refresh: true })).available).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it.each([
  { packages: null },
  { packages: [{ ...payload.packages[0], contentUrl: 'https://evil.example/content.json' }] },
  { packages: [{ ...payload.packages[0], manifest: { id: 'healthy-guide', type: 'unsupported' } }] },
])('rejects a malformed catalog without replacing a valid snapshot', async (invalid) => {
  const first = await fetchEligibleCatalog(serviceUrl, 'a');
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => invalid });
  expect(await fetchEligibleCatalog(serviceUrl, 'a', { refresh: true })).toEqual(first);
});

it.each([
  'https://evil.example',
  'http://recommender.grafana.com',
  'javascript:alert(1)',
  'https://user:secret@recommender.grafana.com',
])('rejects unsafe service URL %s', async (url) => {
  expect(await fetchEligibleCatalog(url, 'a')).toEqual({ items: [], available: false });
  expect(fetchMock).not.toHaveBeenCalled();
});

it('partitions cached catalogs by source, platform, and configured service', async () => {
  await fetchEligibleCatalog(serviceUrl, 'a');
  jest.mocked(getRecommenderStackContext).mockReturnValue({ source: 'oss-source', platform: 'oss' });
  await fetchEligibleCatalog(serviceUrl, 'a');
  await fetchEligibleCatalog('https://recommender.grafana-dev.com', 'a');
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it('cannot change the destination origin through the configured URL path', async () => {
  await fetchEligibleCatalog(`${serviceUrl}//evil.example`, 'a');
  expect(fetchMock).toHaveBeenCalledWith(`${serviceUrl}//evil.example/api/v1/catalog`, expect.any(Object));
});

it('treats a valid empty catalog as available', async () => {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ packages: [] }) });
  expect(await fetchEligibleCatalog(serviceUrl, 'a')).toEqual({ items: [], available: true });
});

it('times out slow requests', async () => {
  jest.useFakeTimers();
  fetchMock.mockImplementation(
    (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      })
  );
  const result = fetchEligibleCatalog(serviceUrl, 'a');
  await jest.advanceTimersByTimeAsync(5000);
  expect(await result).toEqual({ items: [], available: false });
});

it('returns unavailable for a cold server failure', async () => {
  fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
  expect(await fetchEligibleCatalog(serviceUrl, 'a')).toEqual({ items: [], available: false });
});
