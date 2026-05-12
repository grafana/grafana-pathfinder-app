/**
 * @jest-environment node
 *
 * Tests for the CDN repository client (P6).
 *
 * Mocks `global.fetch` at module scope. Each test sets a return value via
 * `mockFetchOnce` (or `mockFetchTimes` for sequenced responses). The index
 * cache is reset in beforeEach so TTL tests can opt in explicitly.
 */

import {
  __resetRepositoryClientForTests,
  buildPackageFileUrl,
  fetchPackageContent,
  fetchPackageManifest,
  fetchRepositoryIndex,
  getRepositoryBaseUrl,
  REPOSITORY_URL_ENV_VAR,
} from '../repository-client';

const DEFAULT_BASE = 'https://interactive-learning.grafana.net/packages/';

const sampleIndex = {
  'business-value': {
    path: 'business-value/',
    type: 'guide',
    title: 'Business value',
    description: 'A guide about value.',
    category: 'observability',
  },
  'getting-started': {
    path: 'getting-started/',
    type: 'guide',
    title: 'Getting started',
    description: 'First steps with Grafana.',
    category: 'onboarding',
  },
  'tour-journey': {
    path: 'tour-journey/',
    type: 'journey',
    title: 'Grafana tour',
    description: 'Take a tour.',
    category: 'onboarding',
    milestones: ['business-value'],
  },
};

const sampleContent = {
  schemaVersion: '1.0.0',
  id: 'business-value',
  title: 'Business value',
  blocks: [{ type: 'markdown', id: 'm-1', content: 'hi' }],
};

const sampleManifest = {
  schemaVersion: '1.0.0',
  id: 'business-value',
  type: 'guide',
  description: 'A guide.',
};

let fetchMock: jest.Mock;

function mockFetchJsonOnce(body: unknown, init: { ok?: boolean; status?: number; statusText?: string } = {}): void {
  const ok = init.ok !== false;
  fetchMock.mockResolvedValueOnce({
    ok,
    status: init.status ?? (ok ? 200 : 500),
    statusText: init.statusText ?? (ok ? 'OK' : 'Internal Server Error'),
    json: async () => body,
  });
}

function mockFetchHttpErrorOnce(status: number): void {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    status,
    statusText: status === 404 ? 'Not Found' : 'Internal Server Error',
    json: async () => ({}),
  });
}

beforeEach(() => {
  __resetRepositoryClientForTests();
  delete process.env[REPOSITORY_URL_ENV_VAR];
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('getRepositoryBaseUrl', () => {
  it('defaults to the public CDN with a trailing slash', () => {
    expect(getRepositoryBaseUrl()).toBe(DEFAULT_BASE);
  });

  it('reads PATHFINDER_REPOSITORY_URL when set', () => {
    process.env[REPOSITORY_URL_ENV_VAR] = 'https://staging.example.com/packages';
    expect(getRepositoryBaseUrl()).toBe('https://staging.example.com/packages/');
  });

  it('preserves a trailing slash on the override', () => {
    process.env[REPOSITORY_URL_ENV_VAR] = 'https://staging.example.com/packages/';
    expect(getRepositoryBaseUrl()).toBe('https://staging.example.com/packages/');
  });

  it('treats whitespace-only override as unset', () => {
    process.env[REPOSITORY_URL_ENV_VAR] = '   ';
    expect(getRepositoryBaseUrl()).toBe(DEFAULT_BASE);
  });
});

describe('buildPackageFileUrl', () => {
  it('joins base, path, and filename with a single slash between each', () => {
    expect(buildPackageFileUrl('https://cdn/packages/', 'foo/', 'content.json')).toBe(
      'https://cdn/packages/foo/content.json'
    );
  });

  it('strips a trailing slash on baseUrl', () => {
    expect(buildPackageFileUrl('https://cdn/packages//', 'foo', 'content.json')).toBe(
      'https://cdn/packages/foo/content.json'
    );
  });

  it('strips leading and trailing slashes on entryPath', () => {
    expect(buildPackageFileUrl('https://cdn/packages', '/foo/', 'manifest.json')).toBe(
      'https://cdn/packages/foo/manifest.json'
    );
  });

  it('returns empty string when baseUrl is all slashes', () => {
    expect(buildPackageFileUrl('///', 'foo', 'content.json')).toBe('');
  });

  it('returns empty string when entryPath is empty after trimming', () => {
    expect(buildPackageFileUrl('https://cdn/packages/', '/', 'content.json')).toBe('');
  });

  it('returns empty string when fileName is empty', () => {
    expect(buildPackageFileUrl('https://cdn/packages/', 'foo', '')).toBe('');
  });
});

describe('fetchRepositoryIndex', () => {
  it('returns flattened packages with the configured baseUrl', async () => {
    mockFetchJsonOnce(sampleIndex);
    const result = await fetchRepositoryIndex();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.baseUrl).toBe(DEFAULT_BASE);
    expect(result.packages).toHaveLength(3);
    const ids = result.packages.map((p) => p.id).sort();
    expect(ids).toEqual(['business-value', 'getting-started', 'tour-journey']);
    expect(result.validation.isValid).toBe(true);
  });

  it('hits the env-var override URL when set', async () => {
    process.env[REPOSITORY_URL_ENV_VAR] = 'https://staging.example/packages';
    mockFetchJsonOnce(sampleIndex);
    await fetchRepositoryIndex();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://staging.example/packages/repository.json',
      expect.objectContaining({ signal: expect.anything() })
    );
  });

  it('caches the index for 60 s', async () => {
    mockFetchJsonOnce(sampleIndex);
    await fetchRepositoryIndex();
    await fetchRepositoryIndex();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetches after the cache is reset', async () => {
    mockFetchJsonOnce(sampleIndex);
    await fetchRepositoryIndex();
    __resetRepositoryClientForTests();
    mockFetchJsonOnce(sampleIndex);
    await fetchRepositoryIndex();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports HTTP_ERROR on 5xx', async () => {
    mockFetchHttpErrorOnce(503);
    const result = await fetchRepositoryIndex();
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe('HTTP_ERROR');
  });

  it('reports NETWORK_ERROR when fetch rejects', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connection refused'));
    const result = await fetchRepositoryIndex();
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe('NETWORK_ERROR');
    expect(result.message).toContain('connection refused');
  });

  it('reports PARSE_ERROR when repository.json is not a JSON object', async () => {
    mockFetchJsonOnce(['not', 'an', 'object']);
    const result = await fetchRepositoryIndex();
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe('PARSE_ERROR');
  });

  it('surfaces drift in a single entry as validation issues without failing', async () => {
    const drift = {
      ...sampleIndex,
      'broken-entry': { type: 42, path: 'broken/' }, // type must be enum
    };
    mockFetchJsonOnce(drift);
    const result = await fetchRepositoryIndex();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.validation.isValid).toBe(false);
    expect(result.validation.issues.some((i) => i.path[0] === 'broken-entry')).toBe(true);
    // Best-effort include: id is still surfaced because the entry is at least an object with a path.
    expect(result.packages.find((p) => p.id === 'broken-entry')).toBeDefined();
  });
});

describe('fetchPackageContent', () => {
  it('returns content + parsed when the file is well-formed', async () => {
    mockFetchJsonOnce(sampleIndex);
    mockFetchJsonOnce(sampleContent);
    const result = await fetchPackageContent('business-value');
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.url).toBe('https://interactive-learning.grafana.net/packages/business-value/content.json');
    expect(result.raw).toEqual(sampleContent);
    expect(result.parsed).toEqual(sampleContent);
    expect(result.validation.isValid).toBe(true);
  });

  it('returns NOT_FOUND when the id is missing from the index', async () => {
    mockFetchJsonOnce(sampleIndex);
    const result = await fetchPackageContent('does-not-exist');
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe('NOT_FOUND');
  });

  it('returns raw + validation issues on schema drift, no throw', async () => {
    mockFetchJsonOnce(sampleIndex);
    const drifted = { ...sampleContent, blocks: 'not an array' };
    mockFetchJsonOnce(drifted);
    const result = await fetchPackageContent('business-value');
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.raw).toEqual(drifted);
    expect(result.parsed).toBeNull();
    expect(result.validation.isValid).toBe(false);
    expect(result.validation.issues.length).toBeGreaterThan(0);
  });

  it('reports HTTP_ERROR when the per-package fetch 404s', async () => {
    mockFetchJsonOnce(sampleIndex);
    mockFetchHttpErrorOnce(404);
    const result = await fetchPackageContent('business-value');
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe('HTTP_ERROR');
    if (result.code === 'HTTP_ERROR') {
      expect(result.status).toBe(404);
    }
  });
});

describe('fetchPackageManifest', () => {
  it('returns manifest + parsed when the file is well-formed', async () => {
    mockFetchJsonOnce(sampleIndex);
    mockFetchJsonOnce(sampleManifest);
    const result = await fetchPackageManifest('business-value');
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.url).toBe('https://interactive-learning.grafana.net/packages/business-value/manifest.json');
    expect(result.raw).toEqual(sampleManifest);
    expect(result.validation.isValid).toBe(true);
  });

  it('preserves unknown fields via .loose() validation', async () => {
    mockFetchJsonOnce(sampleIndex);
    const manifestWithExtra = { ...sampleManifest, futureFlag: true };
    mockFetchJsonOnce(manifestWithExtra);
    const result = await fetchPackageManifest('business-value');
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.raw).toEqual(manifestWithExtra);
    expect(result.validation.isValid).toBe(true);
  });

  it('returns NOT_FOUND when the id is missing from the index', async () => {
    mockFetchJsonOnce(sampleIndex);
    const result = await fetchPackageManifest('does-not-exist');
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe('NOT_FOUND');
  });
});
