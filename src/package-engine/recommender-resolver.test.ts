/**
 * Recommender Package Resolver Tests (Layer 2)
 *
 * Tests the RecommenderPackageResolver against mocked HTTP responses
 * for the GET /api/v1/packages/{id} endpoint.
 */

import type { ContentJson, ManifestJson } from '../types/package.types';

import { RecommenderPackageResolver } from './recommender-resolver';

const BASE_URL = 'https://recommender.example.com';

const FIXTURE_RESOLUTION = {
  id: 'alerting-101',
  contentUrl: 'https://cdn.example.com/packages/alerting-101/content.json',
  manifestUrl: 'https://cdn.example.com/packages/alerting-101/manifest.json',
  repository: 'interactive-tutorials',
};

const FIXTURE_CONTENT: ContentJson = {
  id: 'alerting-101',
  title: 'Grafana Alerting 101',
  blocks: [{ type: 'markdown', content: '# Alerting' }],
};

const FIXTURE_MANIFEST: ManifestJson = {
  id: 'alerting-101',
  type: 'guide',
  description: 'Learn alerting',
};

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('RecommenderPackageResolver', () => {
  let resolver: RecommenderPackageResolver;

  beforeEach(() => {
    resolver = new RecommenderPackageResolver(BASE_URL);
    jest.clearAllMocks();
  });

  describe('resolve (metadata only)', () => {
    it('should resolve a package successfully on 200', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(FIXTURE_RESOLUTION),
      });

      const result = await resolver.resolve('alerting-101');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.id).toBe('alerting-101');
        expect(result.contentUrl).toBe(FIXTURE_RESOLUTION.contentUrl);
        expect(result.manifestUrl).toBe(FIXTURE_RESOLUTION.manifestUrl);
        expect(result.repository).toBe('interactive-tutorials');
        expect(result.content).toBeUndefined();
        expect(result.manifest).toBeUndefined();
      }
    });

    it('should construct the URL using the URL API with encoded package ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ...FIXTURE_RESOLUTION, id: 'my package/with special' }),
      });

      await resolver.resolve('my package/with special');

      const calledUrl = mockFetch.mock.calls[0]![0] as string;
      expect(calledUrl).toContain('/api/v1/packages/my%20package%2Fwith%20special');
      expect(calledUrl).toStartWith(BASE_URL);
    });

    it('should return not-found on 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: 'package not found', code: 'not-found' }),
      });

      const result = await resolver.resolve('nonexistent');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('not-found');
        expect(result.error.message).toBe('package not found');
      }
    });

    it('should return not-found on 400 (invalid package id)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'invalid package id', code: 'bad-request' }),
      });

      const result = await resolver.resolve('!!!invalid!!!');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('not-found');
      }
    });

    it('should return network-error on other HTTP errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await resolver.resolve('alerting-101');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('network-error');
        expect(result.error.message).toContain('500');
      }
    });

    it('should return network-error on fetch rejection', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Failed to fetch'));

      const result = await resolver.resolve('alerting-101');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('network-error');
        expect(result.error.message).toBe('Failed to fetch');
      }
    });

    it('should return network-error on non-Error rejection', async () => {
      mockFetch.mockRejectedValueOnce('something went wrong');

      const result = await resolver.resolve('alerting-101');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('network-error');
        expect(result.error.message).toBe('Unknown network error');
      }
    });
  });

  describe('resolve with loadContent', () => {
    it('should load content and manifest from CDN on success', async () => {
      // First call: resolution endpoint
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(FIXTURE_RESOLUTION),
      });
      // Second call: content.json from CDN
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(FIXTURE_CONTENT),
      });
      // Third call: manifest.json from CDN
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(FIXTURE_MANIFEST),
      });

      const result = await resolver.resolve('alerting-101', { loadContent: true });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.content).toEqual(FIXTURE_CONTENT);
        expect(result.manifest).toMatchObject(FIXTURE_MANIFEST);
      }
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should succeed with content only if manifest fetch fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(FIXTURE_RESOLUTION),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(FIXTURE_CONTENT),
      });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await resolver.resolve('alerting-101', { loadContent: true });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.content).toEqual(FIXTURE_CONTENT);
        expect(result.manifest).toBeUndefined();
      }
    });

    it('should fail if content fetch returns non-200', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(FIXTURE_RESOLUTION),
      });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await resolver.resolve('alerting-101', { loadContent: true });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('network-error');
      }
    });

    it('should fail if content JSON is invalid', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(FIXTURE_RESOLUTION),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ invalid: 'missing required fields' }),
      });

      const result = await resolver.resolve('alerting-101', { loadContent: true });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('validation-error');
      }
    });

    it('should not fetch CDN content when loadContent is not set', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(FIXTURE_RESOLUTION),
      });

      await resolver.resolve('alerting-101');

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});

// Custom matcher for URL prefix checking
expect.extend({
  toStartWith(received: string, prefix: string) {
    const pass = received.startsWith(prefix);
    return {
      pass,
      message: () => `expected "${received}" to start with "${prefix}"`,
    };
  },
});

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      toStartWith(prefix: string): R;
    }
  }
}
