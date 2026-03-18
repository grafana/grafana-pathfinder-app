/**
 * RecommenderPackageResolver Tests (Layer 2)
 *
 * Tests the resolver against mocked fetch responses for the
 * GET /api/v1/packages/{id} endpoint.
 */

import { RecommenderPackageResolver } from './recommender-resolver';

const BASE_URL = 'https://recommender.example.com';

const MOCK_RESOLUTION_RESPONSE = {
  id: 'alerting-101',
  contentUrl: 'https://cdn.example.com/packages/alerting-101/content.json',
  manifestUrl: 'https://cdn.example.com/packages/alerting-101/manifest.json',
  repository: 'interactive-tutorials',
};

const MOCK_CONTENT = {
  id: 'alerting-101',
  title: 'Grafana Alerting 101',
  blocks: [{ type: 'markdown', content: '# Hello' }],
};

const MOCK_MANIFEST = {
  id: 'alerting-101',
  type: 'guide',
  description: 'Hands-on alerting guide',
};

function mockFetch(
  responses: Array<{ ok: boolean; status: number; body: unknown }>
): jest.MockedFunction<typeof fetch> {
  let callIndex = 0;
  return jest.fn().mockImplementation(() => {
    const resp = responses[callIndex++] ?? responses[responses.length - 1]!;
    return Promise.resolve({
      ok: resp.ok,
      status: resp.status,
      json: () => Promise.resolve(resp.body),
    } as Response);
  });
}

describe('RecommenderPackageResolver', () => {
  let resolver: RecommenderPackageResolver;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    resolver = new RecommenderPackageResolver(BASE_URL);
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  // ============ 200 — successful resolution ============

  describe('resolve — 200 success', () => {
    it('should return success with CDN URLs on HTTP 200', async () => {
      global.fetch = mockFetch([{ ok: true, status: 200, body: MOCK_RESOLUTION_RESPONSE }]);

      const result = await resolver.resolve('alerting-101');

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.id).toBe('alerting-101');
      expect(result.contentUrl).toBe(MOCK_RESOLUTION_RESPONSE.contentUrl);
      expect(result.manifestUrl).toBe(MOCK_RESOLUTION_RESPONSE.manifestUrl);
      expect(result.repository).toBe(MOCK_RESOLUTION_RESPONSE.repository);
    });

    it('should call the correct endpoint URL', async () => {
      global.fetch = mockFetch([{ ok: true, status: 200, body: MOCK_RESOLUTION_RESPONSE }]);

      await resolver.resolve('alerting-101');

      expect(global.fetch).toHaveBeenCalledWith('https://recommender.example.com/api/v1/packages/alerting-101');
    });

    it('should URL-encode the package ID', async () => {
      global.fetch = mockFetch([{ ok: true, status: 200, body: { ...MOCK_RESOLUTION_RESPONSE, id: 'foo/bar' } }]);

      await resolver.resolve('foo/bar');

      const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(calledUrl).toContain('foo%2Fbar');
    });

    it('should not populate content or manifest when loadContent is not set', async () => {
      global.fetch = mockFetch([{ ok: true, status: 200, body: MOCK_RESOLUTION_RESPONSE }]);

      const result = await resolver.resolve('alerting-101');

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.content).toBeUndefined();
      expect(result.manifest).toBeUndefined();
    });

    it('should not populate content or manifest when loadContent is false', async () => {
      global.fetch = mockFetch([{ ok: true, status: 200, body: MOCK_RESOLUTION_RESPONSE }]);

      const result = await resolver.resolve('alerting-101', { loadContent: false });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.content).toBeUndefined();
      expect(result.manifest).toBeUndefined();
    });

    it('should return not-found when response body is malformed', async () => {
      global.fetch = mockFetch([{ ok: true, status: 200, body: { unexpected: true } }]);

      const result = await resolver.resolve('alerting-101');

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.error.code).toBe('not-found');
    });
  });

  // ============ loadContent: true ============

  describe('resolve — loadContent: true', () => {
    it('should fetch content and manifest from CDN URLs', async () => {
      global.fetch = mockFetch([
        { ok: true, status: 200, body: MOCK_RESOLUTION_RESPONSE }, // resolution call
        { ok: true, status: 200, body: MOCK_CONTENT }, // content.json
        { ok: true, status: 200, body: MOCK_MANIFEST }, // manifest.json
      ]);

      const result = await resolver.resolve('alerting-101', { loadContent: true });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.content).toMatchObject({ id: 'alerting-101', title: 'Grafana Alerting 101' });
      expect(result.manifest).toMatchObject({ id: 'alerting-101', type: 'guide' });
    });

    it('should succeed with undefined content when content fetch fails', async () => {
      global.fetch = mockFetch([
        { ok: true, status: 200, body: MOCK_RESOLUTION_RESPONSE },
        { ok: false, status: 404, body: null }, // content fetch fails
        { ok: true, status: 200, body: MOCK_MANIFEST },
      ]);

      const result = await resolver.resolve('alerting-101', { loadContent: true });

      // Resolution still succeeds; content just isn't populated
      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.content).toBeUndefined();
      expect(result.manifest).toMatchObject({ id: 'alerting-101' });
    });

    it('should succeed with undefined manifest when manifest fetch fails', async () => {
      global.fetch = mockFetch([
        { ok: true, status: 200, body: MOCK_RESOLUTION_RESPONSE },
        { ok: true, status: 200, body: MOCK_CONTENT },
        { ok: false, status: 404, body: null }, // manifest fetch fails
      ]);

      const result = await resolver.resolve('alerting-101', { loadContent: true });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.content).toMatchObject({ id: 'alerting-101' });
      expect(result.manifest).toBeUndefined();
    });
  });

  // ============ 404 — package not found ============

  describe('resolve — 404 not found', () => {
    it('should return not-found on HTTP 404', async () => {
      global.fetch = mockFetch([{ ok: false, status: 404, body: { error: 'package not found', code: 'not-found' } }]);

      const result = await resolver.resolve('nonexistent');

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.id).toBe('nonexistent');
      expect(result.error.code).toBe('not-found');
    });

    it('should include the error message from the API response', async () => {
      global.fetch = mockFetch([{ ok: false, status: 404, body: { error: 'package not found', code: 'not-found' } }]);

      const result = await resolver.resolve('nonexistent');

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.error.message).toContain('package not found');
    });
  });

  // ============ 400 — invalid package ID ============

  describe('resolve — 400 bad request', () => {
    it('should map HTTP 400 to not-found error code', async () => {
      global.fetch = mockFetch([
        { ok: false, status: 400, body: { error: 'invalid package id', code: 'bad-request' } },
      ]);

      const result = await resolver.resolve('!!invalid!!');

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.error.code).toBe('not-found');
    });
  });

  // ============ Network errors ============

  describe('resolve — network errors', () => {
    it('should return network-error when fetch throws', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Failed to fetch'));

      const result = await resolver.resolve('alerting-101');

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.error.code).toBe('network-error');
    });

    it('should include the thrown error message', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network connection refused'));

      const result = await resolver.resolve('alerting-101');

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.error.message).toContain('Network connection refused');
    });

    it('should return not-found when base URL is invalid', async () => {
      const badResolver = new RecommenderPackageResolver('not-a-url');

      const result = await badResolver.resolve('alerting-101');

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.error.code).toBe('not-found');
    });
  });

  // ============ Other HTTP errors ============

  describe('resolve — other HTTP errors', () => {
    it('should return network-error for HTTP 500', async () => {
      global.fetch = mockFetch([{ ok: false, status: 500, body: null }]);

      const result = await resolver.resolve('alerting-101');

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.error.code).toBe('network-error');
    });
  });
});
