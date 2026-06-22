/**
 * Tests for remote package resolution. The recommender resolver, the CDN
 * repository client, and guide validation are mocked so these tests exercise
 * the orchestration logic — outcome mapping, target filtering, and graceful
 * degradation — without real network or schema coupling.
 */

jest.mock('../../validation', () => ({
  validateGuideFromString: jest.fn(() => ({ isValid: true, warnings: [], errors: [] })),
}));
jest.mock('./recommender-resolver', () => ({
  resolvePackageById: jest.fn(),
}));
jest.mock('../mcp/lib/repository-client', () => ({
  fetchRepositoryIndex: jest.fn(),
  buildPackageFileUrl: jest.fn((base: string, path: string, file: string) => `${base}${path}/${file}`),
}));

import { resolveRemotePackage, resolveRemoteRepository } from './e2e-package';
import { validateGuideFromString } from '../../validation';
import { resolvePackageById } from './recommender-resolver';
import { fetchRepositoryIndex } from '../mcp/lib/repository-client';

const OPTIONS = {
  grafanaUrl: 'http://localhost:3000',
  currentTier: 'local' as const,
  resolverUrl: 'https://recommender.test',
};

/** Configure the recommender resolver mock to return a fixed resolution. */
function mockResolve(resolution: unknown): void {
  (resolvePackageById as jest.Mock).mockResolvedValue(resolution);
}

/** Configure global fetch to return a text body or an HTTP error. */
function mockFetch(body: { ok: true; text: string } | { ok: false; status: number }): void {
  global.fetch = jest
    .fn()
    .mockResolvedValue(
      body.ok ? { ok: true, text: async () => body.text } : { ok: false, status: body.status, statusText: 'Error' }
    ) as unknown as typeof fetch;
}

/** Configure the CDN index mock with the given packages. */
function mockIndex(packages: unknown[]): void {
  (fetchRepositoryIndex as jest.Mock).mockResolvedValue({
    ok: true,
    baseUrl: 'https://cdn.test/packages/',
    packages,
    rawIndex: {},
    validation: { isValid: true, issues: [] },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (validateGuideFromString as jest.Mock).mockReturnValue({ isValid: true, warnings: [], errors: [] });
  // Default to an empty index so single-package runnable tests resolve as
  // singletons (no dependencies) unless a test sets up an index explicitly.
  mockIndex([]);
});

describe('resolveRemotePackage (single, recommender)', () => {
  it('returns a runnable guide for a local-tier package', async () => {
    mockResolve({
      ok: true,
      id: 'alerting-101',
      contentUrl: 'https://cdn.test/alerting-101/content.json',
      manifestUrl: 'https://cdn.test/alerting-101/manifest.json',
      repository: 'r',
      manifest: { id: 'alerting-101', type: 'guide', testEnvironment: { tier: 'local' } },
    });
    mockFetch({ ok: true, text: '{"id":"alerting-101"}' });

    const result = await resolveRemotePackage('alerting-101', OPTIONS);

    expect(result.skipped).toHaveLength(0);
    expect(result.runnable).toHaveLength(1);
    expect(result.runnable[0]).toMatchObject({
      id: 'alerting-101',
      tier: 'local',
      targetUrl: 'http://localhost:3000',
      sourceUrl: 'https://cdn.test/alerting-101/content.json',
    });
    expect(result.runnable[0]!.guide.content).toBe('{"id":"alerting-101"}');
  });

  it('maps a recommender failure to resolution_failed', async () => {
    mockResolve({ ok: false, message: 'not-found: package not found' });

    const result = await resolveRemotePackage('missing', OPTIONS);

    expect(result.runnable).toHaveLength(0);
    expect(result.skipped[0]).toMatchObject({ id: 'missing', reason: 'resolution_failed' });
  });

  it('skips a non-guide package as unsupported_type', async () => {
    mockResolve({
      ok: true,
      id: 'prometheus-lj',
      contentUrl: 'https://cdn.test/prometheus-lj/content.json',
      manifestUrl: '',
      repository: 'r',
      manifest: { id: 'prometheus-lj', type: 'path', milestones: ['a', 'b'] },
    });

    const result = await resolveRemotePackage('prometheus-lj', OPTIONS);

    expect(result.runnable).toHaveLength(0);
    expect(result.skipped[0]).toMatchObject({ id: 'prometheus-lj', reason: 'unsupported_type' });
  });

  it('skips a cloud-tier package on a local environment', async () => {
    mockResolve({
      ok: true,
      id: 'cloud-guide',
      contentUrl: 'https://cdn.test/cloud-guide/content.json',
      manifestUrl: 'https://cdn.test/cloud-guide/manifest.json',
      repository: 'r',
      manifest: { id: 'cloud-guide', type: 'guide', testEnvironment: { tier: 'cloud' } },
    });

    const result = await resolveRemotePackage('cloud-guide', OPTIONS);

    expect(result.runnable).toHaveLength(0);
    expect(result.skipped[0]).toMatchObject({ id: 'cloud-guide', reason: 'skipped_tier_mismatch' });
  });

  it('maps a content fetch error to fetch_failed', async () => {
    mockResolve({
      ok: true,
      id: 'g',
      contentUrl: 'https://cdn.test/g/content.json',
      manifestUrl: '',
      repository: 'r',
      manifest: { id: 'g', type: 'guide', testEnvironment: { tier: 'local' } },
    });
    mockFetch({ ok: false, status: 503 });

    const result = await resolveRemotePackage('g', OPTIONS);

    expect(result.skipped[0]).toMatchObject({ id: 'g', reason: 'fetch_failed' });
  });

  it('maps invalid fetched content to validation_failed', async () => {
    mockResolve({
      ok: true,
      id: 'g',
      contentUrl: 'https://cdn.test/g/content.json',
      manifestUrl: '',
      repository: 'r',
      manifest: { id: 'g', type: 'guide', testEnvironment: { tier: 'local' } },
    });
    mockFetch({ ok: true, text: '{"not":"a guide"}' });
    (validateGuideFromString as jest.Mock).mockReturnValue({ isValid: false, warnings: [], errors: ['bad'] });

    const result = await resolveRemotePackage('g', OPTIONS);

    expect(result.skipped[0]).toMatchObject({ id: 'g', reason: 'validation_failed' });
  });

  it('treats a package with no manifest as a runnable local guide', async () => {
    mockResolve({
      ok: true,
      id: 'g',
      contentUrl: 'https://cdn.test/g/content.json',
      manifestUrl: '',
      repository: 'r',
      manifest: undefined,
    });
    mockFetch({ ok: true, text: '{"id":"g"}' });

    const result = await resolveRemotePackage('g', OPTIONS);

    expect(result.runnable).toHaveLength(1);
    expect(result.runnable[0]).toMatchObject({ id: 'g', tier: 'local' });
  });
});

describe('resolveRemoteRepository (batch, CDN index)', () => {
  it('runs local guides, skips cloud guides, and reconstructs the repository index', async () => {
    (fetchRepositoryIndex as jest.Mock).mockResolvedValue({
      ok: true,
      baseUrl: 'https://cdn.test/packages/',
      packages: [
        { id: 'local-a', path: 'local-a/', type: 'guide', testEnvironment: { tier: 'local' }, depends: ['local-b'] },
        { id: 'local-b', path: 'local-b/', type: 'guide', testEnvironment: { tier: 'local' } },
        { id: 'cloud-c', path: 'cloud-c/', type: 'guide', testEnvironment: { tier: 'cloud' } },
        { id: 'path-d', path: 'path-d/', type: 'path', milestones: ['local-a'] },
      ],
      rawIndex: {},
      validation: { isValid: true, issues: [] },
    });
    mockFetch({ ok: true, text: '{"id":"x"}' });

    const result = await resolveRemoteRepository(OPTIONS);

    expect(result.runnable.map((g) => g.id).sort()).toEqual(['local-a', 'local-b']);

    const reasons = Object.fromEntries(result.skipped.map((s) => [s.id, s.reason]));
    expect(reasons).toEqual({ 'cloud-c': 'skipped_tier_mismatch', 'path-d': 'unsupported_type' });

    // Repository index keeps every entry (including the depends edge) for chaining.
    expect(result.repository['local-a']).toMatchObject({ path: 'local-a/', depends: ['local-b'] });
    expect(Object.keys(result.repository).sort()).toEqual(['cloud-c', 'local-a', 'local-b', 'path-d']);
  });

  it('returns an error when the repository index cannot be fetched', async () => {
    (fetchRepositoryIndex as jest.Mock).mockResolvedValue({ ok: false, code: 'NETWORK_ERROR', message: 'offline' });

    const result = await resolveRemoteRepository(OPTIONS);

    expect(result.error).toMatch(/repository index/i);
    expect(result.runnable).toHaveLength(0);
  });
});

describe('resolveRemotePackage (dependency resolution)', () => {
  /** Recommender resolves a local-tier guide target by id. */
  function mockTargetResolve(targetId: string): void {
    mockResolve({
      ok: true,
      id: targetId,
      contentUrl: `https://cdn.test/${targetId}/content.json`,
      manifestUrl: `https://cdn.test/${targetId}/manifest.json`,
      repository: 'r',
      manifest: { id: targetId, type: 'guide', testEnvironment: { tier: 'local' } },
    });
  }

  it('resolves and includes a direct prerequisite, keeping the target as the selected guide', async () => {
    mockTargetResolve('loki-101');
    mockIndex([
      { id: 'loki-101', path: 'loki-101/', type: 'guide', depends: ['prom-101'], testEnvironment: { tier: 'local' } },
      { id: 'prom-101', path: 'prom-101/', type: 'guide', testEnvironment: { tier: 'local' } },
    ]);
    mockFetch({ ok: true, text: '{"id":"loki-101"}' });

    const result = await resolveRemotePackage('loki-101', OPTIONS);

    expect(result.runnable.map((g) => g.id)).toEqual(['loki-101']);
    expect(result.prerequisites.map((g) => g.id)).toEqual(['prom-101']);
    expect(result.skipped).toHaveLength(0);
    expect(Object.keys(result.repository).sort()).toEqual(['loki-101', 'prom-101']);
  });

  it('resolves transitive prerequisites', async () => {
    mockTargetResolve('c-guide');
    mockIndex([
      { id: 'c-guide', path: 'c/', type: 'guide', depends: ['b-guide'], testEnvironment: { tier: 'local' } },
      { id: 'b-guide', path: 'b/', type: 'guide', depends: ['a-guide'], testEnvironment: { tier: 'local' } },
      { id: 'a-guide', path: 'a/', type: 'guide', testEnvironment: { tier: 'local' } },
    ]);
    mockFetch({ ok: true, text: '{"id":"c-guide"}' });

    const result = await resolveRemotePackage('c-guide', OPTIONS);

    expect(result.runnable.map((g) => g.id)).toEqual(['c-guide']);
    expect(result.prerequisites.map((g) => g.id).sort()).toEqual(['a-guide', 'b-guide']);
  });

  it('resolves a prerequisite advertised via a provides capability', async () => {
    mockTargetResolve('dependent');
    mockIndex([
      { id: 'dependent', path: 'dependent/', type: 'guide', depends: ['db-ready'], testEnvironment: { tier: 'local' } },
      { id: 'provider', path: 'provider/', type: 'guide', provides: ['db-ready'], testEnvironment: { tier: 'local' } },
    ]);
    mockFetch({ ok: true, text: '{"id":"dependent"}' });

    const result = await resolveRemotePackage('dependent', OPTIONS);

    expect(result.prerequisites.map((g) => g.id)).toEqual(['provider']);
  });

  it('runs the target alone when it is absent from the index', async () => {
    mockTargetResolve('orphan');
    mockIndex([{ id: 'other', path: 'other/', type: 'guide', testEnvironment: { tier: 'local' } }]);
    mockFetch({ ok: true, text: '{"id":"orphan"}' });

    const result = await resolveRemotePackage('orphan', OPTIONS);

    expect(result.runnable.map((g) => g.id)).toEqual(['orphan']);
    expect(result.prerequisites).toHaveLength(0);
  });

  it('runs the target alone when the index is unreachable', async () => {
    mockTargetResolve('loki-101');
    (fetchRepositoryIndex as jest.Mock).mockResolvedValue({ ok: false, code: 'NETWORK_ERROR', message: 'offline' });
    mockFetch({ ok: true, text: '{"id":"loki-101"}' });

    const result = await resolveRemotePackage('loki-101', OPTIONS);

    expect(result.runnable.map((g) => g.id)).toEqual(['loki-101']);
    expect(result.prerequisites).toHaveLength(0);
    expect(result.repository).toEqual({});
  });

  it('reports a prerequisite whose content cannot be fetched', async () => {
    mockTargetResolve('loki-101');
    mockIndex([
      { id: 'loki-101', path: 'loki-101/', type: 'guide', depends: ['prom-101'], testEnvironment: { tier: 'local' } },
      { id: 'prom-101', path: 'prom-101/', type: 'guide', testEnvironment: { tier: 'local' } },
    ]);
    // Target content fetches OK; the prerequisite's content fetch fails.
    global.fetch = jest.fn((url: string) =>
      Promise.resolve(
        url.includes('prom-101')
          ? ({ ok: false, status: 503, statusText: 'Error' } as Response)
          : ({ ok: true, text: async () => '{"id":"loki-101"}' } as unknown as Response)
      )
    ) as unknown as typeof fetch;

    const result = await resolveRemotePackage('loki-101', OPTIONS);

    expect(result.runnable.map((g) => g.id)).toEqual(['loki-101']);
    expect(result.prerequisites).toHaveLength(0);
    expect(result.skipped[0]).toMatchObject({ id: 'prom-101', reason: 'fetch_failed' });
  });
});
