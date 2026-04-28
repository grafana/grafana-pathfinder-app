/**
 * Unit tests for the package + resolver module (`package-fetcher.ts`).
 *
 * SCOPE: Pin the contract surface of the package-resolver singleton and
 * its consumers (Pattern J anchors).
 *
 * Critical invariants pinned:
 * 1. Singleton init contract — fetchPackageById fails predictably when
 *    setPackageResolver has not been called.
 * 2. STRICT-EQUALITY URL match in fetchPackageContent — the milestone
 *    `m.url === contentUrl` comparison must NOT be weakened to the
 *    normalized urlsMatch helper that metadata-extractor uses elsewhere
 *    (TOP-3 risk per INVESTIGATION §6 invariant 5).
 * 3. Promise.all three-leg orchestration — fetchPackageContent fans out
 *    fetchContent + resolvePackageMilestones + _packageResolver.resolve(id)
 *    in parallel.
 * 4. derivePathSlug `-lj` strip semantics — only the trailing suffix is
 *    stripped; bare and embedded `-lj` strings are returned as-is.
 * 5. isPathManifest dual-type acceptance — both `'path'` and `'journey'`
 *    are accepted; `'guide'` is rejected.
 * 6. buildMilestoneWebsiteUrl prefix check — milestone IDs that don't
 *    start with `${pathSlug}-` return undefined.
 *
 * Originated as `package-fetcher.pre-extraction.test.ts` for Phase 5 of
 * the content-fetcher refactor; promoted to the permanent
 * `package-fetcher.test.ts` after extraction.
 */

import {
  setPackageResolver,
  fetchPackageContent,
  resolvePackageMilestones,
  derivePathSlug,
  buildMilestoneWebsiteUrl,
  isPathManifest,
  getManifestMilestoneIds,
} from './package-fetcher';
import type { PackageResolver, PackageResolution } from '../types';

// jsdom: AbortSignal.timeout polyfill for fetchContent's inner timeout
if (!AbortSignal.timeout) {
  (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout = (ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  };
}

/**
 * Build a Response-like object for `global.fetch` mocks. The Node test
 * env exposed by jest config does NOT define `Response`, so we fabricate
 * the minimal shape that `fetchContent`'s pipeline reads.
 */
function fakeResponse(body: string, finalUrl = ''): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    url: finalUrl,
    headers: { get: () => null },
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

function makeFailingResolver(): PackageResolver {
  return {
    resolve: jest.fn().mockResolvedValue({
      ok: false as const,
      id: 'sentinel',
      error: { code: 'not-found' as const, message: 'sentinel: stubbed-out resolver' },
    } satisfies PackageResolution),
  };
}

function makeResolverFromMap(map: Record<string, PackageResolution>): PackageResolver {
  return {
    resolve: jest.fn(async (id: string) => {
      const r = map[id];
      if (!r) {
        return {
          ok: false as const,
          id,
          error: { code: 'not-found' as const, message: `no fixture for ${id}` },
        };
      }
      return r;
    }),
  };
}

function successResolution(overrides: Partial<Extract<PackageResolution, { ok: true }>> = {}) {
  return {
    ok: true as const,
    id: 'pkg',
    contentUrl: 'bundled:pkg/content.json',
    manifestUrl: 'bundled:pkg/manifest.json',
    repository: 'bundled',
    ...overrides,
  } satisfies PackageResolution;
}

describe('package + resolver', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    // CRITICAL: re-stub the module-scope `let _packageResolver` to a benign
    // failing resolver so test ordering does not leak the singleton across
    // suites. The init-contract test (#1) explicitly resets to undefined
    // via require-cache invalidation; here we use a stub that always returns
    // ok:false so subsequent tests start in a known-bad state.
    setPackageResolver(makeFailingResolver());
    warnSpy.mockRestore();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Pure helpers — pin URL/manifest shape contracts
  // ─────────────────────────────────────────────────────────────────────────

  describe('derivePathSlug', () => {
    it('5a) strips trailing -lj', () => {
      expect(derivePathSlug('grafana-cloud-tour-lj')).toBe('grafana-cloud-tour');
    });

    it('5b) returns the input unchanged when -lj is absent', () => {
      expect(derivePathSlug('foo')).toBe('foo');
    });

    it('5c) only strips the TRAILING suffix; embedded -lj-bar is preserved', () => {
      expect(derivePathSlug('foo-lj-bar')).toBe('foo-lj-bar');
    });
  });

  describe('isPathManifest', () => {
    it('6a) accepts type=path with milestones', () => {
      expect(isPathManifest({ type: 'path', milestones: [] })).toBe(true);
    });

    it('6b) accepts type=journey with milestones (legacy)', () => {
      expect(isPathManifest({ type: 'journey', milestones: [] })).toBe(true);
    });

    it('6c) rejects type=guide', () => {
      expect(isPathManifest({ type: 'guide' })).toBe(false);
    });

    it('6d) rejects undefined and missing-type manifests', () => {
      expect(isPathManifest(undefined)).toBe(false);
      expect(isPathManifest({})).toBe(false);
    });
  });

  describe('getManifestMilestoneIds', () => {
    it('returns [] for undefined manifest', () => {
      expect(getManifestMilestoneIds(undefined)).toEqual([]);
    });

    it('returns [] when milestones is missing or non-array', () => {
      expect(getManifestMilestoneIds({})).toEqual([]);
      expect(getManifestMilestoneIds({ milestones: 'not-an-array' })).toEqual([]);
    });

    it('filters to string entries only', () => {
      expect(getManifestMilestoneIds({ milestones: ['a', 1, 'b', null, 'c'] })).toEqual(['a', 'b', 'c']);
    });
  });

  describe('buildMilestoneWebsiteUrl', () => {
    it('7a) builds URL when milestoneId starts with pathSlug + "-"', () => {
      expect(buildMilestoneWebsiteUrl('grafana-cloud-tour', 'grafana-cloud-tour-business-value')).toBe(
        'https://grafana.com/docs/learning-paths/grafana-cloud-tour/business-value/'
      );
    });

    it('7b) returns undefined when milestoneId does not start with the pathSlug prefix', () => {
      expect(buildMilestoneWebsiteUrl('grafana-cloud-tour', 'unrelated-milestone')).toBeUndefined();
    });

    it('7c) requires the literal "-" separator (matches "grafana-cloud-tour-" not "grafana-cloud-tour")', () => {
      // The id "grafana-cloud-tourx" has the slug as a prefix but lacks the
      // "-" separator → should NOT match. Pin this so a future "startsWith"
      // regression cannot silently widen the match.
      expect(buildMilestoneWebsiteUrl('grafana-cloud-tour', 'grafana-cloud-tourx')).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Singleton init contract
  // ─────────────────────────────────────────────────────────────────────────

  describe('singleton init contract', () => {
    it('1) fetchPackageById returns no-resolver-configured error when invoked before setPackageResolver', async () => {
      // We cannot truly reset the module-scope `let` to undefined in-process
      // (the afterEach in this suite re-stubs to a failing resolver). To pin
      // the BRANCH that fires when _packageResolver is undefined, fork the
      // module by deleting it from the require cache and re-requiring it.
      jest.isolateModules(() => {
        // require inside isolated context → fresh module with _packageResolver = undefined

        const { fetchPackageById: freshFetchPackageById } = require('./package-fetcher');
        return freshFetchPackageById('any-pkg-id').then((result: any) => {
          expect(result.content).toBeNull();
          expect(result.error).toMatch(/No package resolver configured/i);
          expect(result.errorType).toBe('other');
        });
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // resolvePackageMilestones contract — sequential renumber, skip on rejection
  // ─────────────────────────────────────────────────────────────────────────

  describe('resolvePackageMilestones', () => {
    it('returns [] when resolver is unset (returns ok:false from stub) and ids is empty', async () => {
      expect(await resolvePackageMilestones([])).toEqual([]);
    });

    it('renumbers sequentially starting at 1 and skips ok:false resolutions', async () => {
      const resolver = makeResolverFromMap({
        'm-1': successResolution({ id: 'm-1', contentUrl: 'https://x.com/m-1', repository: 'cdn' }),
        'm-2': { ok: false, id: 'm-2', error: { code: 'not-found', message: 'gone' } },
        'm-3': successResolution({ id: 'm-3', contentUrl: 'https://x.com/m-3', repository: 'cdn' }),
      });
      setPackageResolver(resolver);

      const result = await resolvePackageMilestones(['m-1', 'm-2', 'm-3']);

      expect(result).toHaveLength(2);
      expect(result[0]!.number).toBe(1);
      expect(result[0]!.url).toBe('https://x.com/m-1');
      expect(result[1]!.number).toBe(2); // skipped m-2 → m-3 becomes #2
      expect(result[1]!.url).toBe('https://x.com/m-3');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // STRICT-EQUALITY URL match — INVESTIGATION §6 invariant 5
  // ─────────────────────────────────────────────────────────────────────────

  describe('fetchPackageContent — strict-equality URL match (TOP-3 risk)', () => {
    let fetchMock: jest.Mock;

    beforeEach(() => {
      fetchMock = jest.fn().mockResolvedValue(fakeResponse('{"id":"pkg","title":"Pkg","blocks":[]}'));
      global.fetch = fetchMock as unknown as typeof fetch;
    });

    it('2) trailing-slash mismatch leaves currentMilestone === 0 (no normalization)', async () => {
      // Milestone url has trailing slash, contentUrl does not → strict ===
      // returns false → currentMilestone === 0. If a future refactor swaps
      // in urlsMatch normalization, currentMilestone would become 1 here.
      const resolver = makeResolverFromMap({
        'pkg-m-a': successResolution({
          id: 'pkg-m-a',
          contentUrl: 'https://grafana.com/docs/learning-paths/pkg/y/', // trailing slash
          repository: 'cdn',
        }),
        'pkg-lj': successResolution({
          id: 'pkg-lj',
          contentUrl: 'https://grafana.com/docs/learning-paths/pkg/base',
          repository: 'cdn',
        }),
      });
      setPackageResolver(resolver);

      const manifest = {
        id: 'pkg-lj',
        type: 'path',
        milestones: ['pkg-m-a'],
      };

      const result = await fetchPackageContent('https://grafana.com/docs/learning-paths/pkg/y', manifest);

      expect(result.content).toBeTruthy();
      expect(result.content?.metadata.learningJourney?.currentMilestone).toBe(0);
      // Milestone array still contains the resolved milestone, just not the "current" one
      expect(result.content?.metadata.learningJourney?.totalMilestones).toBe(1);
    });

    it('3) exact match → currentMilestone === 1 and baseUrl from baseUrlResolution', async () => {
      const resolver = makeResolverFromMap({
        'pkg-m-a': successResolution({
          id: 'pkg-m-a',
          contentUrl: 'https://grafana.com/docs/learning-paths/pkg/y',
          repository: 'cdn',
        }),
        'pkg-lj': successResolution({
          id: 'pkg-lj',
          contentUrl: 'https://grafana.com/docs/learning-paths/pkg/base-from-resolver',
          repository: 'cdn',
        }),
      });
      setPackageResolver(resolver);

      const manifest = {
        id: 'pkg-lj',
        type: 'path',
        milestones: ['pkg-m-a'],
      };

      const result = await fetchPackageContent('https://grafana.com/docs/learning-paths/pkg/y', manifest);

      expect(result.content?.metadata.learningJourney?.currentMilestone).toBe(1);
      expect(result.content?.metadata.learningJourney?.baseUrl).toBe(
        'https://grafana.com/docs/learning-paths/pkg/base-from-resolver'
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Promise.all three-leg orchestration
  // ─────────────────────────────────────────────────────────────────────────

  describe('fetchPackageContent orchestration', () => {
    it('4) fans out resolver.resolve to manifestId AND each milestoneId in the same call', async () => {
      const fetchMock = jest.fn().mockResolvedValue(fakeResponse('{"id":"pkg","title":"Pkg","blocks":[]}'));
      global.fetch = fetchMock as unknown as typeof fetch;

      const resolveFn = jest.fn(async (id: string) => {
        return successResolution({
          id,
          contentUrl: `https://grafana.com/docs/learning-paths/pkg/${id}`,
          repository: 'cdn',
        });
      });
      setPackageResolver({ resolve: resolveFn });

      const manifest = {
        id: 'pkg-lj',
        type: 'path',
        milestones: ['m-1', 'm-2'],
      };

      await fetchPackageContent('https://grafana.com/docs/learning-paths/pkg/m-1', manifest);

      // Resolver invoked for: each milestone (m-1, m-2) AND the manifest id
      // (baseUrl resolution leg). Total 3 calls. Order may vary because the
      // three legs run in Promise.all.
      expect(resolveFn).toHaveBeenCalledTimes(3);
      const calledIds = resolveFn.mock.calls.map((c) => c[0]).sort();
      expect(calledIds).toEqual(['m-1', 'm-2', 'pkg-lj']);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // post-extraction additions
  // (added after Phase 5 extract; cover gaps the disposable pre-tests missed)
  // ─────────────────────────────────────────────────────────────────────────

  describe('post-extraction additions', () => {
    it('setPackageResolver replacement: most recent call wins', async () => {
      // The PLAN's tripwire pinned *that* setPackageResolver replaces, but
      // not that the new resolver is actually used by subsequent reads. Pin
      // both halves: install resolver A, then resolver B, then verify only
      // B is consulted.
      const resolveA = jest.fn().mockResolvedValue({
        ok: false as const,
        id: 'a',
        error: { code: 'not-found' as const, message: 'A' },
      });
      const resolveB = jest.fn().mockResolvedValue(
        successResolution({
          id: 'pkg-x',
          contentUrl: 'https://grafana.com/docs/learning-paths/pkg-x',
          repository: 'cdn',
        })
      );

      setPackageResolver({ resolve: resolveA });
      setPackageResolver({ resolve: resolveB });

      // resolvePackageMilestones consults the active resolver
      await resolvePackageMilestones(['pkg-x']);

      expect(resolveA).not.toHaveBeenCalled();
      expect(resolveB).toHaveBeenCalledTimes(1);
      expect(resolveB).toHaveBeenCalledWith('pkg-x', { loadContent: 'metadata-only' });
    });

    it('resolvePackageMilestones falls back to manifest.description when content is absent', async () => {
      // Pin the title-fallback chain: resolution.content?.title ??
      // resolution.manifest?.description ?? id. Without explicit pins, a
      // refactor could silently swap the order and produce wrong-looking
      // milestone titles.
      const resolver = makeResolverFromMap({
        'has-content': successResolution({
          id: 'has-content',
          contentUrl: 'https://x/has-content',
          repository: 'cdn',
          content: { id: 'has-content', title: 'Title from content' },
          // manifest absent
        } as any),
        'manifest-only': successResolution({
          id: 'manifest-only',
          contentUrl: 'https://x/manifest-only',
          repository: 'cdn',
          manifest: { id: 'manifest-only', description: 'Title from manifest' },
          // content absent
        } as any),
        'no-metadata': successResolution({
          id: 'no-metadata',
          contentUrl: 'https://x/no-metadata',
          repository: 'cdn',
          // both content and manifest absent
        }),
      });
      setPackageResolver(resolver);

      const milestones = await resolvePackageMilestones(['has-content', 'manifest-only', 'no-metadata']);

      expect(milestones).toHaveLength(3);
      expect(milestones[0]!.title).toBe('Title from content');
      expect(milestones[1]!.title).toBe('Title from manifest');
      expect(milestones[2]!.title).toBe('no-metadata'); // falls all the way through to id
    });

    it('buildMilestoneWebsiteUrl handles empty pathSlug edge case (would prefix with bare "-")', () => {
      // Pin the literal "${pathSlug}-" prefix construction. When pathSlug
      // is the empty string, the prefix becomes just "-", so any milestoneId
      // starting with "-" matches. Documenting this current behavior keeps
      // a future refactor honest.
      expect(buildMilestoneWebsiteUrl('', '-some-milestone')).toBe(
        'https://grafana.com/docs/learning-paths//some-milestone/'
      );
      expect(buildMilestoneWebsiteUrl('', 'no-leading-dash')).toBeUndefined();
    });
  });
});
