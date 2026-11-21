/**
 * @jest-environment node
 */

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { FIXTURE_IDS, mockStepIndexFetch } from '../../../../test-utils/step-index-fixtures';
import { __resetRepositoryClientForTests } from '../../repository-client';
import { __resetStepIndexForTests, cacheDirectory, getStepIndex, getVerifiedSelectors } from '../cache';

const RECHECK_INTERVAL_MS = 10 * 60_000;

const contentFetches = (fetchMock: jest.Mock, id?: string) =>
  fetchMock.mock.calls.filter(([url]) => String(url).endsWith('content.json') && (!id || String(url).includes(id)))
    .length;

const [quickpizza, slo, adaptive] = FIXTURE_IDS;
const failing = adaptive;
const stepIndexRoot = () => join(cacheDirectory(), 'step-index');
const repositoryDirectory = () => join(stepIndexRoot(), readdirSync(stepIndexRoot())[0]!);
const revisionDirectory = (revision: number) => join(repositoryDirectory(), String(revision));
const guideFiles = (revision = 1) => {
  try {
    return readdirSync(revisionDirectory(revision)).sort();
  } catch {
    return [];
  }
};

let cacheRoot: string;
let clock: number;

beforeEach(() => {
  cacheRoot = mkdtempSync(join(tmpdir(), 'step-index-'));
  process.env.XDG_CACHE_HOME = cacheRoot;
  clock = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
  __resetRepositoryClientForTests();
  __resetStepIndexForTests();
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.XDG_CACHE_HOME;
  rmSync(cacheRoot, { recursive: true, force: true });
});

const afterRecheckInterval = () => {
  clock += 11 * 60_000;
};

const freshProcess = (options?: Parameters<typeof mockStepIndexFetch>[0]) => {
  __resetStepIndexForTests();
  __resetRepositoryClientForTests();
  const fetchMock = mockStepIndexFetch(options);
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

describe('getStepIndex', () => {
  it('indexes only healthy guides and reports build stats', async () => {
    global.fetch = mockStepIndexFetch() as unknown as typeof fetch;
    const result = await getStepIndex();
    expect(result.ok && result.snapshot.stats).toEqual({
      healthRevision: 1,
      healthGeneratedAt: '2026-11-18T00:00:00Z',
      eligibleGuides: 3,
      indexedGuides: 3,
      procedures: expect.any(Number),
      builtAt: expect.any(String),
    });
    expect(result.ok && result.snapshot.procedures.get('grafana-quickpizza-working-filters#0')?.pathTitles).toEqual([
      'Dashboards learning path',
    ]);
    expect(result.ok && result.snapshot.paths).toEqual([
      expect.objectContaining({ id: 'dashboards-path', title: 'Dashboards learning path' }),
    ]);
  });

  it('shares one build between concurrent callers and holds it until the recheck interval', async () => {
    const fetchMock = mockStepIndexFetch();
    global.fetch = fetchMock as unknown as typeof fetch;
    const [first, second] = await Promise.all([getStepIndex(), getStepIndex()]);
    expect(first).toBe(second);
    expect(contentFetches(fetchMock)).toBe(3);

    afterRecheckInterval();
    const again = await getStepIndex();
    expect(again.ok && again.snapshot).toBe(first.ok && first.snapshot);
    expect(contentFetches(fetchMock)).toBe(3);
  });

  it('stores one raw content file per guide and reuses them in a fresh process without fetching content', async () => {
    global.fetch = mockStepIndexFetch() as unknown as typeof fetch;
    const built = await getStepIndex();
    expect(guideFiles()).toEqual([...FIXTURE_IDS].map((id) => `${id}.json`).sort());

    const fetchMock = freshProcess();
    const restored = await getStepIndex();
    expect(contentFetches(fetchMock)).toBe(0);
    expect(restored.ok && [...restored.snapshot.procedures.keys()]).toEqual(
      built.ok ? [...built.snapshot.procedures.keys()] : []
    );
  });

  it('refetches only a guide whose cached file is corrupt', async () => {
    global.fetch = mockStepIndexFetch() as unknown as typeof fetch;
    await getStepIndex();
    writeFileSync(join(revisionDirectory(1), `${slo}.json`), '{"blocks": [');
    const fetchMock = freshProcess();
    expect((await getStepIndex()).ok).toBe(true);
    expect(contentFetches(fetchMock)).toBe(1);
    expect(contentFetches(fetchMock, 'create-availability-slo-lj')).toBe(1);
  });

  const itWritableOnly = process.getuid?.() === 0 ? it.skip : it;
  itWritableOnly('builds in memory when a corrupt file sits in an unwritable cache directory', async () => {
    global.fetch = mockStepIndexFetch() as unknown as typeof fetch;
    await getStepIndex();
    writeFileSync(join(revisionDirectory(1), `${quickpizza}.json`), 'not json');
    chmodSync(revisionDirectory(1), 0o555);
    try {
      const fetchMock = freshProcess();
      const result = await getStepIndex();
      expect(result.ok && result.snapshot.stats.indexedGuides).toBe(3);
      expect(contentFetches(fetchMock)).toBe(1);
    } finally {
      chmodSync(revisionDirectory(1), 0o755);
    }
  });

  it('computes eligibility from the live health report even when the cache holds the guide', async () => {
    global.fetch = mockStepIndexFetch() as unknown as typeof fetch;
    await getStepIndex();
    freshProcess({ healthPackages: { [slo]: { health: 'unhealthy', blockedBy: [] } } });
    const result = await getStepIndex();
    expect(result.ok && result.snapshot.stats.eligibleGuides).toBe(2);
    expect(result.ok && result.snapshot.guidePaths[slo]).toBeUndefined();
    expect(result.ok && [...result.snapshot.procedures.values()].some((p) => p.guideId === slo)).toBe(false);
  });

  it('rebuilds on a new health revision and prunes only the older revision directory', async () => {
    global.fetch = mockStepIndexFetch({ revision: 1 }) as unknown as typeof fetch;
    await getStepIndex();
    const elsewhere = join(stepIndexRoot(), 'other-install', '7');
    mkdirSync(elsewhere, { recursive: true });
    writeFileSync(join(elsewhere, 'guide.json'), '{}');
    writeFileSync(join(cacheDirectory(), 'unrelated.txt'), 'keep');
    writeFileSync(join(cacheDirectory(), 'step-index-legacy-abc.json'), '{}');

    const fetchMock = mockStepIndexFetch({ revision: 2 });
    global.fetch = fetchMock as unknown as typeof fetch;
    afterRecheckInterval();
    const result = await getStepIndex();
    expect(result.ok && result.snapshot.stats.healthRevision).toBe(2);
    expect(contentFetches(fetchMock)).toBe(3);
    expect(guideFiles(1)).toEqual([]);
    expect(guideFiles(2)).toHaveLength(3);
    expect(existsSync(join(elsewhere, 'guide.json'))).toBe(true);
    expect(readdirSync(cacheDirectory()).sort()).toEqual(['step-index', 'unrelated.txt']);
  });

  it('rebuilds when only the catalog changes, without refetching content', async () => {
    global.fetch = mockStepIndexFetch() as unknown as typeof fetch;
    const first = await getStepIndex();
    const fetchMock = mockStepIndexFetch({
      extraCatalog: { 'new-guide': { path: 'new-guide/', title: 'New', type: 'guide' } },
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    __resetRepositoryClientForTests();
    afterRecheckInterval();
    const result = await getStepIndex();
    expect(result.ok && result.snapshot).not.toBe(first.ok && first.snapshot);
    expect(contentFetches(fetchMock)).toBe(0);
  });
});

describe('getStepIndex failures', () => {
  it('returns an error and no index when the health report cannot be fetched on a cold start', async () => {
    global.fetch = mockStepIndexFetch({ healthStatus: 500 }) as unknown as typeof fetch;
    const result = await getStepIndex();
    expect(result).toEqual(expect.objectContaining({ ok: false, code: 'HTTP_ERROR' }));
    expect('snapshot' in result).toBe(false);
  });

  it('returns PARSE_ERROR and writes nothing for a malformed health report', async () => {
    global.fetch = mockStepIndexFetch({
      healthBody: { schemaVersion: '9.9', packages: [] },
    }) as unknown as typeof fetch;
    const result = await getStepIndex();
    expect(result).toEqual(expect.objectContaining({ ok: false, code: 'PARSE_ERROR' }));
    expect('snapshot' in result).toBe(false);
    expect(existsSync(stepIndexRoot())).toBe(false);
  });

  it('keeps serving the held index when a recheck cannot fetch the health report, retrying next interval', async () => {
    global.fetch = mockStepIndexFetch() as unknown as typeof fetch;
    const first = await getStepIndex();
    const fetchMock = mockStepIndexFetch({ healthStatus: 500 });
    global.fetch = fetchMock as unknown as typeof fetch;
    afterRecheckInterval();
    const kept = await getStepIndex();
    expect(kept.ok && kept.snapshot).toBe(first.ok && first.snapshot);
    const callsAfterFailure = fetchMock.mock.calls.length;
    await getStepIndex();
    expect(fetchMock.mock.calls).toHaveLength(callsAfterFailure);

    afterRecheckInterval();
    const healed = mockStepIndexFetch({ revision: 2 });
    global.fetch = healed as unknown as typeof fetch;
    const rebuilt = await getStepIndex();
    expect(rebuilt.ok && rebuilt.snapshot.stats.healthRevision).toBe(2);
  });

  describe('failed rechecks', () => {
    const held = async () => {
      global.fetch = mockStepIndexFetch({ revision: 1 }) as unknown as typeof fetch;
      const first = await getStepIndex();
      expect(first.ok).toBe(true);
      return first.ok ? first.snapshot : undefined;
    };

    it('serves the held index when every content fetch fails after a revision bump, until the next interval', async () => {
      const snapshot = await held();
      const fetchMock = mockStepIndexFetch({ revision: 2, content: () => 500 });
      global.fetch = fetchMock as unknown as typeof fetch;
      afterRecheckInterval();
      const failed = await getStepIndex();
      expect(failed.ok && failed.snapshot).toBe(snapshot);
      expect(contentFetches(fetchMock)).toBeGreaterThan(0);

      const calls = fetchMock.mock.calls.length;
      clock += RECHECK_INTERVAL_MS - 1;
      const early = await getStepIndex();
      expect(early.ok && early.snapshot).toBe(snapshot);
      expect(fetchMock.mock.calls).toHaveLength(calls);

      clock += 1;
      const due = await getStepIndex();
      expect(due.ok && due.snapshot).toBe(snapshot);
      expect(fetchMock.mock.calls.length).toBeGreaterThan(calls);
    });

    it('recovers on the next interval once content fetches succeed', async () => {
      await held();
      global.fetch = mockStepIndexFetch({ revision: 2, content: () => 500 }) as unknown as typeof fetch;
      afterRecheckInterval();
      await getStepIndex();

      global.fetch = mockStepIndexFetch({ revision: 2 }) as unknown as typeof fetch;
      afterRecheckInterval();
      const rebuilt = await getStepIndex();
      expect(rebuilt.ok && rebuilt.snapshot.stats).toEqual(
        expect.objectContaining({ healthRevision: 2, indexedGuides: 3 })
      );
    });

    it('replaces the held index with a partial rebuild at a new revision', async () => {
      await held();
      global.fetch = mockStepIndexFetch({
        revision: 2,
        content: (id) => (id === failing ? 503 : undefined),
      }) as unknown as typeof fetch;
      afterRecheckInterval();
      const partial = await getStepIndex();
      expect(partial.ok && partial.snapshot.stats).toEqual(
        expect.objectContaining({ healthRevision: 2, indexedGuides: 2, fetchFailedGuides: 1 })
      );
    });
  });

  it('fetches a permanently missing guide once per process, never retries it, and counts it unavailable', async () => {
    const fetchMock = mockStepIndexFetch({ content: (id) => (id === failing ? 404 : undefined) });
    global.fetch = fetchMock as unknown as typeof fetch;
    const result = await getStepIndex();
    expect(result.ok && result.snapshot.stats).toEqual(
      expect.objectContaining({ eligibleGuides: 3, indexedGuides: 2, unavailableGuides: 1 })
    );
    expect(result.ok && result.snapshot.stats.fetchFailedGuides).toBeUndefined();
    expect(contentFetches(fetchMock, 'adaptive-metrics-lj')).toBe(1);
    expect(guideFiles()).toEqual([quickpizza, slo].map((id) => `${id}.json`).sort());

    const second = freshProcess({ content: (id) => (id === failing ? 404 : undefined) });
    await getStepIndex();
    expect(contentFetches(second)).toBe(1);
    expect(contentFetches(second, 'adaptive-metrics-lj')).toBe(1);
  });

  it('treats a malformed guide response as permanently unavailable', async () => {
    const fetchMock = mockStepIndexFetch({ content: (id) => (id === failing ? ([] as never) : undefined) });
    global.fetch = fetchMock as unknown as typeof fetch;
    const result = await getStepIndex();
    expect(result.ok && result.snapshot.stats).toEqual(
      expect.objectContaining({ indexedGuides: 2, unavailableGuides: 1 })
    );
    expect(contentFetches(fetchMock, 'adaptive-metrics-lj')).toBe(1);
  });

  it('does not cache a guide that fails the content schema and fetches it again in a fresh process', async () => {
    global.fetch = mockStepIndexFetch({
      content: (id) => (id === failing ? ({ blocks: [] } as never) : undefined),
    }) as unknown as typeof fetch;
    const result = await getStepIndex();
    expect(result.ok && result.snapshot.stats).toEqual(
      expect.objectContaining({ indexedGuides: 2, unavailableGuides: 1 })
    );
    expect(guideFiles()).toHaveLength(2);

    const second = freshProcess({ content: (id) => (id === failing ? ({ blocks: [] } as never) : undefined) });
    await getStepIndex();
    expect(contentFetches(second)).toBe(1);
    expect(contentFetches(second, 'adaptive-metrics-lj')).toBe(1);
  });

  it('retries a transient failure once and indexes the recovered guide', async () => {
    const fetchMock = mockStepIndexFetch({
      content: (id, attempt) => (id === failing && attempt === 1 ? 500 : undefined),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const result = await getStepIndex();
    expect(result.ok && result.snapshot.stats).toEqual(expect.objectContaining({ indexedGuides: 3 }));
    expect(result.ok && result.snapshot.stats.fetchFailedGuides).toBeUndefined();
    expect(contentFetches(fetchMock, 'adaptive-metrics-lj')).toBe(2);
    expect(guideFiles()).toHaveLength(3);
  });

  it('counts a guide that fails twice as fetchFailed, keeps the others on disk, and refetches only it on rebuild', async () => {
    const failTwice = mockStepIndexFetch({ content: (id) => (id === failing ? 503 : undefined) });
    global.fetch = failTwice as unknown as typeof fetch;
    const partial = await getStepIndex();
    expect(partial.ok && partial.snapshot.stats).toEqual(
      expect.objectContaining({ eligibleGuides: 3, indexedGuides: 2, fetchFailedGuides: 1 })
    );
    expect(partial.ok && partial.snapshot.stats.unavailableGuides).toBeUndefined();
    expect(contentFetches(failTwice, 'adaptive-metrics-lj')).toBe(2);
    expect(guideFiles()).toHaveLength(2);

    const again = await getStepIndex();
    expect(again.ok && again.snapshot).toBe(partial.ok && partial.snapshot);

    const healed = mockStepIndexFetch();
    global.fetch = healed as unknown as typeof fetch;
    afterRecheckInterval();
    const rebuilt = await getStepIndex();
    expect(rebuilt.ok && rebuilt.snapshot.stats.indexedGuides).toBe(3);
    expect(rebuilt.ok && rebuilt.snapshot.stats.fetchFailedGuides).toBeUndefined();
    expect(contentFetches(healed)).toBe(1);
    expect(guideFiles()).toHaveLength(3);
  });

  it('returns EMPTY_INDEX and holds nothing when there are no eligible guides', async () => {
    global.fetch = mockStepIndexFetch({
      healthPackages: Object.fromEntries(FIXTURE_IDS.map((id) => [id, { health: 'unhealthy', blockedBy: [] }])),
    }) as unknown as typeof fetch;
    const result = await getStepIndex();
    expect(result).toEqual(
      expect.objectContaining({ ok: false, code: 'EMPTY_INDEX', message: expect.stringContaining('eligibleGuides: 0') })
    );
    expect('snapshot' in result).toBe(false);

    const fetchMock = mockStepIndexFetch();
    global.fetch = fetchMock as unknown as typeof fetch;
    __resetRepositoryClientForTests();
    expect((await getStepIndex()).ok).toBe(true);
  });

  it('returns EMPTY_INDEX when every guide fails or has no blocks', async () => {
    global.fetch = mockStepIndexFetch({ content: () => 500 }) as unknown as typeof fetch;
    expect(await getStepIndex()).toEqual(
      expect.objectContaining({
        ok: false,
        code: 'EMPTY_INDEX',
        message: expect.stringContaining('fetchFailedGuides: 3'),
      })
    );

    freshProcess({ content: (id) => ({ id, title: id, blocks: [] }) });
    const empty = await getStepIndex();
    expect(empty).toEqual(
      expect.objectContaining({ ok: false, code: 'EMPTY_INDEX', message: expect.stringContaining('indexedGuides: 3') })
    );
  });

  it('excludes healthy guides with blockers and guides missing from the health report', async () => {
    global.fetch = mockStepIndexFetch({
      extraCatalog: {
        'blocked-guide': { path: 'blocked-guide/', title: 'Blocked', type: 'guide' },
        'unreported-guide': { path: 'unreported-guide/', title: 'Unreported', type: 'guide' },
      },
      healthPackages: { 'blocked-guide': { health: 'healthy', blockedBy: ['some-dependency'] } },
    }) as unknown as typeof fetch;
    const result = await getStepIndex();
    expect(result.ok && result.snapshot.stats.eligibleGuides).toBe(3);
    expect(result.ok && result.snapshot.guidePaths['blocked-guide']).toBeUndefined();
    expect(result.ok && result.snapshot.guidePaths['unreported-guide']).toBeUndefined();
  });
});

describe('getVerifiedSelectors', () => {
  it('answers empty at once with nothing held, builds once in the background, then serves the indexed selectors', async () => {
    const fetchMock = freshProcess();
    expect(getVerifiedSelectors().size).toBe(0);
    expect(getVerifiedSelectors().size).toBe(0);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('package-health'))).toHaveLength(1);

    await getStepIndex();
    expect(getVerifiedSelectors()).toContain('[data-testid="install-quickpizza"], [data-testid="view-quickpizza"]');
    expect(getVerifiedSelectors()).toBe(getVerifiedSelectors());
  });

  it('never waits on a fetch when the build cannot finish', async () => {
    const never = new Promise<never>(() => undefined);
    global.fetch = jest.fn(() => never) as unknown as typeof fetch;
    __resetStepIndexForTests();
    __resetRepositoryClientForTests();
    for (let i = 0; i < 3; i++) {
      expect(getVerifiedSelectors().size).toBe(0);
    }
  });

  it('stays empty and does not throw when the build fails', async () => {
    freshProcess({ healthStatus: 500 });
    expect(getVerifiedSelectors().size).toBe(0);
    await getStepIndex();
    expect(getVerifiedSelectors().size).toBe(0);
  });
});
