/**
 * Phase 4 pre-extraction characterization tests for raw-fetch state machine.
 *
 * SCOPE: Pin the async state machine behavior of `fetchRawHtml` and helpers
 * BEFORE extraction to a new module. These tests focus on:
 *
 * 1. Drain behavior — exact `global.fetch` call counts and URL ordering
 *    (the variation queue, the json/html fallback chain, redirect handling)
 * 2. Trust/HTTPS asymmetry between the variation path and the direct path
 * 3. Cross-origin redirect blocking semantics
 * 4. Error classification matrix (`errorType` for not-found / server-error /
 *    timeout / network / other)
 * 5. JSON content-detection on `finalUrl` vs `urlVariation`
 *
 * These tests drive `fetchRawHtml` directly via temporary export (DR-07)
 * to isolate state-machine call counts from secondary fetches that
 * `fetchContent` makes via `extractMetadata` / index.json.
 *
 * STATUS: Disposable. After Phase 4 extraction, this file is renamed
 * `raw-fetch.test.ts` (imports updated to `./raw-fetch`) and serves as
 * the permanent unit test for the new module. Some tests here verify
 * pre-existing behavior that may look quirky — that is intentional;
 * we are pinning current semantics, not fixing them.
 */

import {
  fetchRawHtml,
  getContentUrls,
  isJsonContentUrl,
  generateInteractiveLearningVariations,
  enforceHttps,
} from './content-fetcher';

const FETCHED_HTML = '<html><body>OK</body></html>';

/**
 * jsdom's Response sets `url` to '' by default and it's not writable through
 * the constructor. Use this helper to fabricate a Response-like object whose
 * shape matches what `fetchRawHtml` reads (status, headers.get, ok, text(), url).
 */
function fakeResponse(opts: {
  status?: number;
  url?: string;
  body?: string | null;
  headers?: Record<string, string>;
  throwOnText?: Error;
}): Response {
  const status = opts.status ?? 200;
  const headersMap = new Map(Object.entries(opts.headers ?? {}));
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : status === 404 ? 'Not Found' : status === 500 ? 'Server Error' : '',
    url: opts.url ?? '',
    headers: {
      get: (name: string) => headersMap.get(name) ?? null,
    },
    text: opts.throwOnText ? () => Promise.reject(opts.throwOnText!) : () => Promise.resolve(opts.body ?? ''),
  } as unknown as Response;
}

describe('raw-fetch state machine — pre-extraction characterization', () => {
  let fetchMock: jest.Mock;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    // Silence console output emitted by the state machine on error paths
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Pure helpers (no fetch) — anchor the URL-shape contracts
  // ─────────────────────────────────────────────────────────────────────────

  describe('isJsonContentUrl', () => {
    it('returns true for content.json URLs', () => {
      expect(isJsonContentUrl('https://grafana.com/docs/foo/content.json')).toBe(true);
    });

    it('returns true for any .json URL (even with query string)', () => {
      expect(isJsonContentUrl('https://grafana.com/docs/foo.json?v=1')).toBe(true);
    });

    it('returns false for .html URLs', () => {
      expect(isJsonContentUrl('https://grafana.com/docs/foo/unstyled.html')).toBe(false);
    });

    it('ignores fragment when matching', () => {
      expect(isJsonContentUrl('https://grafana.com/docs/foo/content.json#section')).toBe(true);
    });
  });

  describe('getContentUrls', () => {
    it('strips trailing slash and builds {jsonUrl, htmlUrl}', () => {
      expect(getContentUrls('https://grafana.com/docs/learning-paths/foo/')).toEqual({
        jsonUrl: 'https://grafana.com/docs/learning-paths/foo/content.json',
        htmlUrl: 'https://grafana.com/docs/learning-paths/foo/unstyled.html',
      });
    });

    it('preserves URL when no trailing slash', () => {
      expect(getContentUrls('https://grafana.com/docs/learning-paths/foo')).toEqual({
        jsonUrl: 'https://grafana.com/docs/learning-paths/foo/content.json',
        htmlUrl: 'https://grafana.com/docs/learning-paths/foo/unstyled.html',
      });
    });
  });

  describe('generateInteractiveLearningVariations', () => {
    it('returns [content.json, unstyled.html] in this order for a trailing-slash URL', () => {
      expect(generateInteractiveLearningVariations('https://interactive-learning.grafana.net/guide/')).toEqual([
        'https://interactive-learning.grafana.net/guide/content.json',
        'https://interactive-learning.grafana.net/guide/unstyled.html',
      ]);
    });

    it('returns an empty array for non-interactive-learning URLs', () => {
      expect(generateInteractiveLearningVariations('https://grafana.com/docs/foo/')).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Drain behavior — call count + URL order assertions
  // (these are the Pattern G "interleaving invariant" anchors)
  // ─────────────────────────────────────────────────────────────────────────

  describe('drain behavior — interactive-learning variation path', () => {
    it('1) JSON-first: stops after content.json hit (exactly 1 fetch call)', async () => {
      fetchMock.mockResolvedValueOnce(
        fakeResponse({
          status: 200,
          url: 'https://interactive-learning.grafana.net/test/content.json',
          body: '{"valid":"json"}',
        })
      );

      const result = await fetchRawHtml('https://interactive-learning.grafana.net/test/', {});

      expect(result.html).toBe('{"valid":"json"}');
      expect(result.isNativeJson).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]![0]).toBe('https://interactive-learning.grafana.net/test/content.json');
    });

    it('2) HTML fallback: when content.json 404s, calls unstyled.html in order', async () => {
      fetchMock.mockResolvedValueOnce(fakeResponse({ status: 404 })).mockResolvedValueOnce(
        fakeResponse({
          status: 200,
          url: 'https://interactive-learning.grafana.net/test/unstyled.html',
          body: FETCHED_HTML,
        })
      );

      const result = await fetchRawHtml('https://interactive-learning.grafana.net/test/', {});

      expect(result.html).toBe(FETCHED_HTML);
      expect(result.isNativeJson).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0]![0]).toBe('https://interactive-learning.grafana.net/test/content.json');
      expect(fetchMock.mock.calls[1]![0]).toBe('https://interactive-learning.grafana.net/test/unstyled.html');
    });
  });

  describe('drain behavior — Grafana docs direct path', () => {
    it('3) null-body fallthrough: base → content.json("null") → unstyled.html (3 calls in order)', async () => {
      const baseUrl = 'https://grafana.com/docs/learning-paths/foo/';
      const jsonUrl = 'https://grafana.com/docs/learning-paths/foo/content.json';
      const htmlUrl = 'https://grafana.com/docs/learning-paths/foo/unstyled.html';

      fetchMock
        .mockResolvedValueOnce(fakeResponse({ status: 200, url: baseUrl, body: '<html>base</html>' }))
        .mockResolvedValueOnce(fakeResponse({ status: 200, url: jsonUrl, body: 'null' }))
        .mockResolvedValueOnce(fakeResponse({ status: 200, url: htmlUrl, body: FETCHED_HTML }));

      const result = await fetchRawHtml(baseUrl, {});

      expect(result.html).toBe(FETCHED_HTML);
      expect(result.isNativeJson).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls[0]![0]).toBe(baseUrl);
      expect(fetchMock.mock.calls[1]![0]).toBe(jsonUrl);
      expect(fetchMock.mock.calls[2]![0]).toBe(htmlUrl);
    });

    it('4) content.json valid (not "null"): stops after json hit, NO htmlUrl call', async () => {
      const baseUrl = 'https://grafana.com/docs/learning-paths/foo/';
      const jsonUrl = 'https://grafana.com/docs/learning-paths/foo/content.json';

      fetchMock
        .mockResolvedValueOnce(fakeResponse({ status: 200, url: baseUrl, body: '<html>base</html>' }))
        .mockResolvedValueOnce(fakeResponse({ status: 200, url: jsonUrl, body: '{"real":"guide"}' }));

      const result = await fetchRawHtml(baseUrl, {});

      expect(result.html).toBe('{"real":"guide"}');
      expect(result.isNativeJson).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0]![0]).toBe(baseUrl);
      expect(fetchMock.mock.calls[1]![0]).toBe(jsonUrl);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Trust/HTTPS asymmetry — the most important security invariants
  // ─────────────────────────────────────────────────────────────────────────

  describe('trust/HTTPS asymmetry', () => {
    it('5) cross-origin manual redirect blocked when Location is protocol-relative to a different origin', async () => {
      // 301 with Location starting with `/` (only path that triggers the
      // explicit cross-origin block); use protocol-relative `//evil.com/x`
      // so `new URL(loc, origin)` produces a different-origin URL.
      fetchMock.mockResolvedValueOnce(
        fakeResponse({
          status: 301,
          headers: { Location: '//evil.com/hijack' },
          url: 'https://grafana.com/docs/foo/',
        })
      );

      const result = await fetchRawHtml('https://grafana.com/docs/foo/', {});

      expect(result.html).toBeNull();
      expect(result.error?.message).toMatch(/Cross-origin redirect blocked/i);
      // Only the original URL was called; cross-origin redirect was NOT followed
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]![0]).toBe('https://grafana.com/docs/foo/');
    });

    it('6) variation path: trust check uses response.url || urlVariation; empty response.url falls back to https variation', async () => {
      // response.url='' simulates proxied/intercepted environments. The
      // variation URL itself is the trust anchor. The variation path
      // intentionally does NOT call enforceHttps (asymmetry vs direct path).
      fetchMock.mockResolvedValueOnce(
        fakeResponse({
          status: 200,
          url: '', // proxied env — empty response.url
          body: '{"hello":"world"}',
        })
      );

      const result = await fetchRawHtml('https://interactive-learning.grafana.net/test/', {});

      // Falls back to urlVariation (which is https + trusted) → returns content
      expect(result.html).toBe('{"hello":"world"}');
      expect(result.isNativeJson).toBe(true);
      expect(result.finalUrl).toBe('https://interactive-learning.grafana.net/test/content.json');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('7a) direct path: rejects when response.url downgrades to http (trust gate trips first)', async () => {
      // Initial URL is https + trusted. Response.url comes back as http://...
      // (simulates a misbehaving proxy). On the direct path the trust check
      // runs FIRST against `response.url || url`. `isAllowedContentUrl` requires
      // https, so the http downgrade fails the trust gate before enforceHttps
      // gets a chance. We pin the current error wording to detect future drift.
      fetchMock.mockResolvedValueOnce(
        fakeResponse({
          status: 200,
          url: 'http://grafana.com/docs/foo/',
          body: FETCHED_HTML,
        })
      );

      const result = await fetchRawHtml('https://grafana.com/docs/foo/', {});

      expect(result.html).toBeNull();
      expect(result.error?.message).toMatch(/trusted domain list/i);
      expect(result.error?.errorType).toBe('other');
    });

    it('7b) enforceHttps unit-contract: rejects http://, accepts https://, allows localhost only in dev', () => {
      // The direct path calls enforceHttps after the trust check; pin its
      // contract independently so future moves cannot silently change the
      // semantics that the asymmetry depends on.
      expect(enforceHttps('https://grafana.com/docs/foo/')).toBe(true);
      expect(enforceHttps('http://grafana.com/docs/foo/')).toBe(false);
      // Localhost branch depends on dev-mode global; without dev-mode set,
      // http://localhost is rejected. Asserting a stable boolean here pins
      // the production-mode default.
      expect(enforceHttps('http://localhost:3000/foo')).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Error classification matrix
  // ─────────────────────────────────────────────────────────────────────────

  describe('error classification (FetchError.errorType)', () => {
    it('8a) 404 on direct path → errorType "not-found"', async () => {
      // Use a non-Grafana-docs URL so the json/html fallback does not engage;
      // the 404 is recorded directly. We use a docs URL but the Grafana-docs
      // path only kicks in on `response.ok`, so a 404 falls into the else
      // branch on line 757.
      fetchMock.mockResolvedValueOnce(fakeResponse({ status: 404 }));

      const result = await fetchRawHtml('https://grafana.com/docs/missing/', {});

      expect(result.html).toBeNull();
      expect(result.error?.errorType).toBe('not-found');
      expect(result.error?.statusCode).toBe(404);
    });

    it('8b) 500 on direct path → errorType "server-error"', async () => {
      fetchMock.mockResolvedValueOnce(fakeResponse({ status: 500 }));

      const result = await fetchRawHtml('https://grafana.com/docs/broken/', {});

      expect(result.html).toBeNull();
      expect(result.error?.errorType).toBe('server-error');
      expect(result.error?.statusCode).toBe(500);
    });

    it('8c) AbortError (timeout) on direct path → errorType "timeout"', async () => {
      fetchMock.mockRejectedValueOnce(new Error('The operation was aborted due to timeout'));

      const result = await fetchRawHtml('https://grafana.com/docs/slow/', {});

      expect(result.html).toBeNull();
      expect(result.error?.errorType).toBe('timeout');
    });

    it('8d) NetworkError on direct path → errorType "network"', async () => {
      fetchMock.mockRejectedValueOnce(new Error('NetworkError when attempting to fetch resource'));

      const result = await fetchRawHtml('https://grafana.com/docs/down/', {});

      expect(result.html).toBeNull();
      expect(result.error?.errorType).toBe('network');
    });

    it('8e) generic error on direct path → errorType "other"', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Something else exploded'));

      const result = await fetchRawHtml('https://grafana.com/docs/wat/', {});

      expect(result.html).toBeNull();
      expect(result.error?.errorType).toBe('other');
    });

    it('8f) all variations exhausted (404s) on variation path → errorType "not-found"', async () => {
      fetchMock
        .mockResolvedValueOnce(fakeResponse({ status: 404 }))
        .mockResolvedValueOnce(fakeResponse({ status: 404 }));

      const result = await fetchRawHtml('https://interactive-learning.grafana.net/missing/', {});

      expect(result.html).toBeNull();
      // No lastError recorded for 404s in tryUrlVariations; falls through to default
      expect(result.error?.errorType).toBe('not-found');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // isNativeJson detection on finalUrl vs urlVariation (trust-asymmetry tail)
  // ─────────────────────────────────────────────────────────────────────────

  describe('isNativeJson detection', () => {
    it('treats response as native JSON when urlVariation ends in .json even if response.url is empty', async () => {
      fetchMock.mockResolvedValueOnce(fakeResponse({ status: 200, url: '', body: '{"x":1}' }));

      const result = await fetchRawHtml('https://interactive-learning.grafana.net/g/', {});

      expect(result.isNativeJson).toBe(true);
    });

    it('does NOT mark as native JSON when both finalUrl and urlVariation are .html', async () => {
      fetchMock
        .mockResolvedValueOnce(fakeResponse({ status: 404 })) // content.json miss
        .mockResolvedValueOnce(fakeResponse({ status: 200, url: '', body: FETCHED_HTML })); // unstyled.html hit

      const result = await fetchRawHtml('https://interactive-learning.grafana.net/g/', {});

      expect(result.isNativeJson).toBe(false);
    });
  });
});
