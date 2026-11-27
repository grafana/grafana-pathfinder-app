import { of, throwError } from 'rxjs';
import { fetchPrivateCDNCatalogue, fetchPrivateCDNContent, PRIVATE_CDN_GUIDE } from './private-cdn-client';

const backendFetch = jest.fn();
const fetchAsset = jest.fn();
const originalFetch = global.fetch;
jest.mock('@grafana/runtime', () => ({
  config: { namespace: 'stacks-13' },
  getBackendSrv: () => ({ fetch: backendFetch }),
}));

const signedUrl = `https://interactive-learning-private.grafana-dev.net/internal/packages/${PRIVATE_CDN_GUIDE}/content.json?e=9999999999&k=key1&s=${'a'.repeat(64)}`;

beforeEach(() => {
  backendFetch.mockReset();
  fetchAsset.mockReset();
  global.fetch = fetchAsset as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

it('only lists granted guides in the catalogue response', async () => {
  backendFetch.mockReturnValue(
    of({
      data: {
        entries: [
          { id: PRIVATE_CDN_GUIDE, title: 'Private', source: 'private-cdn' },
          { id: '../other', title: 'Other', source: 'private-cdn' },
          { id: PRIVATE_CDN_GUIDE, title: 'Other', source: 'grafana' },
        ],
      },
    })
  );
  expect(await fetchPrivateCDNCatalogue()).toEqual([
    { id: PRIVATE_CDN_GUIDE, title: 'Private', source: 'private-cdn' },
  ]);
  expect(backendFetch).toHaveBeenCalledWith(
    expect.objectContaining({ url: expect.stringContaining('/namespaces/stacks-13/backend/private-cdn/catalogue') })
  );
});

it('fails closed when the catalogue cannot be read', async () => {
  backendFetch.mockReturnValue(throwError(() => new Error('unavailable')));
  expect(await fetchPrivateCDNCatalogue()).toEqual([]);
});

it('signs only the fixed guide and fetches without credentials, caching, redirects, or referrer', async () => {
  backendFetch.mockReturnValue(of({ data: { url: signedUrl, expiresAt: 9999999999, source: 'private-cdn' } }));
  fetchAsset.mockResolvedValue({ ok: true, text: async () => '{"id":"guide"}' });
  expect(await fetchPrivateCDNContent()).toBe('{"id":"guide"}');
  expect(backendFetch).toHaveBeenCalledWith(
    expect.objectContaining({
      url: expect.stringContaining('/backend/private-cdn/sign'),
      method: 'POST',
      data: { guide: PRIVATE_CDN_GUIDE, asset: 'content.json' },
    })
  );
  expect(fetchAsset).toHaveBeenCalledWith(signedUrl, {
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
  });
});

it('requests a fresh signed URL for each load', async () => {
  backendFetch.mockReturnValue(of({ data: { url: signedUrl, expiresAt: 9999999999, source: 'private-cdn' } }));
  fetchAsset.mockResolvedValue({ ok: true, text: async () => '{"id":"guide"}' });
  await fetchPrivateCDNContent();
  await fetchPrivateCDNContent();
  expect(backendFetch).toHaveBeenCalledTimes(2);
  expect(fetchAsset).toHaveBeenCalledTimes(2);
});

it.each([
  signedUrl.replace('interactive-learning-private.grafana-dev.net', 'other.example'),
  signedUrl.replace('content.json', 'manifest.json'),
  signedUrl.replace('s=', 'extra=1&s='),
  signedUrl.replace('https:', 'http:'),
])('rejects a signed URL outside the fixed asset boundary', async (url) => {
  backendFetch.mockReturnValue(of({ data: { url, expiresAt: 9999999999, source: 'private-cdn' } }));
  await expect(fetchPrivateCDNContent()).rejects.toThrow('Private guide is unavailable');
  expect(fetchAsset).not.toHaveBeenCalled();
});

it('rejects an expired signed URL before the asset request', async () => {
  backendFetch.mockReturnValue(of({ data: { url: signedUrl, expiresAt: 1, source: 'private-cdn' } }));
  await expect(fetchPrivateCDNContent()).rejects.toThrow('Private guide is unavailable');
  expect(fetchAsset).not.toHaveBeenCalled();
});
