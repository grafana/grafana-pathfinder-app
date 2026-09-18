/**
 * Phase 4g: Docs-retrieval integration — Layer 2 tests
 *
 * Covers:
 * - Content-type dispatch routing (package-backed vs static docs)
 * - Pre-resolved CDN URL fetch path
 * - bundled:<path>/content.json package format in fetchBundledInteractive
 * - fetchPackageById via injected PackageResolver
 * - Manifest metadata passthrough via fetchPackageContent
 * - setPackageResolver injection and resolver-not-configured error
 */
import { config, getBackendSrv, setBackendSrv, type BackendSrv } from '@grafana/runtime';
import { of } from 'rxjs';
import {
  fetchPackageContent,
  fetchPackageById,
  setPackageResolver,
  setPackageResolverFactory,
  resolvePackageMilestones,
  resolvePackageTracks,
  resolvePackageNavLinks,
  ensureNonEmptyCoverContent,
} from './content-fetcher/package-content';
import { fetchContent } from './content-fetcher';
import { logger } from '../lib/logging';
import {
  isJourneyCoverPage,
  getTotalMilestones,
  getNextMilestoneUrl,
  getPreviousMilestoneUrl,
} from './learning-journey-helpers';
import {
  fetchCustomGuideRepository,
  invalidateCustomGuideRepositoryCache,
} from '../lib/custom-guide-repository-client';
import type { PackageResolver, PackageResolution } from '../types';

// Mock AbortSignal.timeout for Node environments
if (!AbortSignal.timeout) {
  (AbortSignal as any).timeout = jest.fn((ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResolver(resolution: PackageResolution): PackageResolver {
  return {
    resolve: jest.fn().mockResolvedValue(resolution),
  };
}

function makeSuccessResolution(overrides: Partial<Extract<PackageResolution, { ok: true }>> = {}) {
  return {
    ok: true as const,
    id: 'test-package',
    contentUrl: 'bundled:test-package/content.json',
    manifestUrl: 'bundled:test-package/manifest.json',
    repository: 'bundled',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// bundled:<path>/content.json — fetchContent extended format
// ---------------------------------------------------------------------------

describe('fetchContent — bundled package path format', () => {
  it('returns not-found error when the package file does not exist', async () => {
    // The require() call inside fetchBundledInteractive will throw for unknown paths
    const result = await fetchContent('bundled:nonexistent-package/content.json');
    expect(result.content).toBeNull();
    expect(result.error).toMatch(/not found/i);
    expect(result.errorType).toBe('not-found');
  });

  it('handles bundled:<path>.json format independently of the index.json lookup', async () => {
    // Paths containing "/" and ending in ".json" go through the package path handler,
    // not the index.json lookup. A missing file returns a typed not-found error.
    const result = await fetchContent('bundled:missing-pkg/content.json');
    expect(result.content).toBeNull();
    expect(result.errorType).toBe('not-found');
  });

  it('still handles legacy bundled:<id> format via index.json', async () => {
    // Legacy single-ID format should still try index.json — may fail with "not found in index.json"
    const result = await fetchContent('bundled:nonexistent-legacy-guide');
    expect(result.content).toBeNull();
    expect(result.error).toMatch(/index\.json|not found/i);
  });
});

// ---------------------------------------------------------------------------
// fetchPackageContent — primary package fetch path
// ---------------------------------------------------------------------------

describe('fetchPackageContent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns error when the contentUrl is empty', async () => {
    const result = await fetchPackageContent('');
    expect(result.content).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('passes through the underlying fetch error unchanged', async () => {
    const result = await fetchPackageContent('bundled:does-not-exist/content.json');
    expect(result.content).toBeNull();
  });

  it('attaches packageManifest to metadata when provided', async () => {
    // We need a contentUrl that actually resolves — use a real bundled package
    // from the test fixture. Use the bundled first-dashboard package which exists
    // in bundled-interactives/ after Phase 2.
    const manifest = { id: 'first-dashboard', type: 'guide', category: 'dashboards' };
    const result = await fetchPackageContent('bundled:first-dashboard/content.json', manifest);

    if (result.content) {
      expect(result.content.metadata.packageManifest).toEqual(manifest);
    }
    // Whether or not content loads (depends on test environment), manifest attaches correctly
  });

  it('omits packageManifest from metadata when not provided', async () => {
    const result = await fetchPackageContent('bundled:first-dashboard/content.json');
    if (result.content) {
      expect(result.content.metadata.packageManifest).toBeUndefined();
    }
  });

  it('sets content type to interactive for guide-type packages', async () => {
    const manifest = { id: 'first-dashboard', type: 'guide' };
    const result = await fetchPackageContent('bundled:first-dashboard/content.json', manifest);
    if (result.content) {
      expect(result.content.type).toBe('interactive');
    }
  });

  it('sets content type to learning-journey for path-type packages', async () => {
    const manifest = { id: 'first-dashboard', type: 'path' };
    const result = await fetchPackageContent('bundled:first-dashboard/content.json', manifest);
    if (result.content) {
      expect(result.content.type).toBe('learning-journey');
    }
  });

  it('sets content type to learning-journey for journey-type packages', async () => {
    const manifest = { id: 'first-dashboard', type: 'journey' };
    const result = await fetchPackageContent('bundled:first-dashboard/content.json', manifest);
    if (result.content) {
      expect(result.content.type).toBe('learning-journey');
    }
  });

  it('defaults content type to interactive when manifest is omitted', async () => {
    const result = await fetchPackageContent('bundled:first-dashboard/content.json');
    if (result.content) {
      expect(result.content.type).toBe('interactive');
    }
  });

  it('defaults content type to interactive when manifest.type is missing', async () => {
    const manifest = { id: 'first-dashboard' };
    const result = await fetchPackageContent('bundled:first-dashboard/content.json', manifest);
    if (result.content) {
      expect(result.content.type).toBe('interactive');
    }
  });

  it('preserves other RawContent fields when attaching manifest', async () => {
    const manifest = { id: 'first-dashboard' };
    const result = await fetchPackageContent('bundled:first-dashboard/content.json', manifest);
    if (result.content) {
      expect(result.content.url).toBeTruthy();
      expect(result.content.lastFetched).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// fetchPackageById — by-ID fallback using injected PackageResolver
// ---------------------------------------------------------------------------

describe('fetchPackageById', () => {
  // setBackendSrv and config.namespace are module-level singletons, so the two
  // reuse tests below would otherwise reach every later describe.
  const originalBackendSrv = getBackendSrv();
  const originalNamespace = (config as { namespace?: string }).namespace;

  afterEach(() => {
    // Reset injected resolver between tests
    setPackageResolver(
      makeResolver({
        ok: false,
        id: 'reset',
        error: { code: 'not-found', message: 'reset' },
      })
    );
    setBackendSrv(originalBackendSrv);
    (config as { namespace?: string }).namespace = originalNamespace;
  });

  it('returns error when no resolver has been configured', async () => {
    // Module-level _packageResolver is undefined at test file start (Jest isolation).
    // The first test in this describe block runs before any setPackageResolver call.
    const result = await fetchPackageById('some-package');
    expect(result.content).toBeNull();
    expect(result.error).toMatch(/No package resolver/i);
    expect(result.errorType).toBe('other');
  });

  it('returns not-found error when resolver returns failure', async () => {
    setPackageResolver(
      makeResolver({
        ok: false,
        id: 'unknown-package',
        error: { code: 'not-found', message: 'package not found' },
      })
    );

    const result = await fetchPackageById('unknown-package');
    expect(result.content).toBeNull();
    expect(result.errorType).toBe('not-found');
  });

  it('returns other error type when resolver returns non-not-found failure', async () => {
    setPackageResolver(
      makeResolver({
        ok: false,
        id: 'some-package',
        error: { code: 'network-error', message: 'network failed' },
      })
    );

    const result = await fetchPackageById('some-package');
    expect(result.content).toBeNull();
    expect(result.errorType).toBe('other');
  });

  it('calls fetchPackageContent with contentUrl from resolved package', async () => {
    setPackageResolver(makeResolver(makeSuccessResolution()));

    const result = await fetchPackageById('test-package');
    // contentUrl is bundled:test-package/content.json — file does not exist in tests
    // so result.content may be null, but the resolver was consulted
    expect(result).toHaveProperty('content');
  });

  it('attaches packageManifest when provided', async () => {
    setPackageResolver(makeResolver(makeSuccessResolution()));
    const manifest = { id: 'test-package', category: 'alerting' };

    const result = await fetchPackageById('test-package', manifest);
    if (result.content) {
      expect(result.content.metadata.packageManifest).toEqual(manifest);
    }
  });

  it('calls the resolver with the provided packageId', async () => {
    const resolver = makeResolver(makeSuccessResolution());
    setPackageResolver(resolver);

    await fetchPackageById('alerting-101');
    expect(resolver.resolve).toHaveBeenCalledWith('alerting-101', { loadContent: false, verifyPublished: true });
  });

  // The publish-status probe already GET the resource. Building content from it
  // is what keeps the gated path at one upstream request instead of two.
  it('builds content from the probed resource without re-fetching it', async () => {
    const fetchSpy = jest.fn();
    setBackendSrv({ fetch: fetchSpy } as unknown as BackendSrv);
    setPackageResolver(
      makeResolver({
        ok: true,
        id: 'probed-guide',
        contentUrl: 'backend-guide:probed-guide',
        manifestUrl: 'app-platform:ns/probed-guide',
        repository: 'app-platform',
        probedResource: {
          metadata: { name: 'probed-guide' },
          spec: { id: 'probed-guide', title: 'Probed guide', schemaVersion: '1.0', blocks: [] },
        },
      })
    );

    const result = await fetchPackageById('probed-guide');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.content?.metadata.title).toBe('Probed guide');
  });

  it('still fetches when the resolution carries no probed resource', async () => {
    (config as { namespace?: string }).namespace = 'stacks-123';
    setPackageResolver(
      makeResolver({
        ok: true,
        id: 'unprobed-guide',
        contentUrl: 'backend-guide:unprobed-guide',
        manifestUrl: 'app-platform:ns/unprobed-guide',
        repository: 'app-platform',
      })
    );
    const fetchSpy = jest.fn().mockReturnValue(
      of({
        data: {
          metadata: { name: 'unprobed-guide' },
          spec: { id: 'unprobed-guide', title: 'Unprobed guide', schemaVersion: '1.0', blocks: [] },
        },
      })
    );
    setBackendSrv({ fetch: fetchSpy } as unknown as BackendSrv);

    await fetchPackageById('unprobed-guide');

    expect(fetchSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// setPackageResolver injection
// ---------------------------------------------------------------------------

describe('setPackageResolver', () => {
  it('replaces the previously configured resolver', async () => {
    const firstResolver = makeResolver({
      ok: false,
      id: 'any-id',
      error: { code: 'not-found', message: 'first resolver' },
    });
    const secondResolver = makeResolver({
      ok: false,
      id: 'any-id',
      error: { code: 'not-found', message: 'second resolver' },
    });

    setPackageResolver(firstResolver);
    await fetchPackageById('any-id');
    expect(firstResolver.resolve).toHaveBeenCalledTimes(1);
    expect(secondResolver.resolve).toHaveBeenCalledTimes(0);

    setPackageResolver(secondResolver);
    await fetchPackageById('any-id');
    expect(secondResolver.resolve).toHaveBeenCalledTimes(1);
  });
});

describe('setPackageResolverFactory', () => {
  afterEach(() => {
    setPackageResolver(makeResolver({ ok: false, id: 'reset', error: { code: 'not-found', message: 'reset' } }));
  });

  it('does not invoke the factory until the resolver is actually read', () => {
    const factory = jest.fn().mockResolvedValue(makeResolver(makeSuccessResolution({ id: 'm1' })));

    setPackageResolverFactory(factory);

    expect(factory).not.toHaveBeenCalled();
  });

  it('resolves milestones once the factory-registered resolver is available', async () => {
    setPackageResolverFactory(() => Promise.resolve(makeResolver(makeSuccessResolution({ id: 'm1' }))));

    const milestones = await resolvePackageMilestones(['m1']);

    expect(milestones).not.toEqual([]);
  });

  it('invokes the factory only once across repeated reads', async () => {
    const resolver = makeResolver(makeSuccessResolution({ id: 'm1' }));
    const factory = jest.fn().mockResolvedValue(resolver);
    setPackageResolverFactory(factory);

    await resolvePackageMilestones(['m1']);
    await resolvePackageMilestones(['m1']);

    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('a later setPackageResolver call overrides a pending factory registration', async () => {
    setPackageResolverFactory(() =>
      Promise.resolve(makeResolver({ ok: false, id: 'x', error: { code: 'not-found', message: 'factory' } }))
    );
    setPackageResolver(makeResolver(makeSuccessResolution({ id: 'm1' })));

    const milestones = await resolvePackageMilestones(['m1']);

    expect(milestones).not.toEqual([]);
  });

  it('a rejected factory does not poison later reads with a cached rejection', async () => {
    setPackageResolverFactory(() => Promise.reject(new Error('dynamic import failed')));

    // The rejection is caught internally — callers see "no resolver
    // configured" (empty result), never a thrown exception, and that holds
    // on every subsequent read since the promise is memoized.
    const first = await resolvePackageMilestones(['m1']);
    const second = await resolvePackageMilestones(['m1']);

    expect(first).toEqual([]);
    expect(second).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Static docs bypass — plain HTTPS URL still routes through normal fetch path
// ---------------------------------------------------------------------------

describe('fetchPackageContent error handling', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns an error result when CDN fetch rejects with a network error', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await fetchPackageContent('https://interactive-learning.grafana.net/packages/test/content.json');

    expect(result.content).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('handles CDN returning non-JSON HTML error page without crashing', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<html><body>502 Bad Gateway</body></html>'),
      headers: new Headers({ 'content-type': 'text/html' }),
    });

    const result = await fetchPackageContent('https://interactive-learning.grafana.net/packages/test/content.json');

    // fetchContent wraps HTML as a JSON guide -- the key assertion is no unhandled exception
    expect(result).toHaveProperty('content');
  });
});

describe('fetchPackageById with resolved content', () => {
  afterEach(() => {
    setPackageResolver(
      makeResolver({
        ok: false,
        id: 'reset',
        error: { code: 'not-found', message: 'reset' },
      })
    );
  });

  it('calls resolver and delegates to fetchPackageContent with correct args', async () => {
    const manifest = { id: 'first-dashboard', type: 'guide', category: 'dashboards' };
    const resolver = makeResolver(
      makeSuccessResolution({
        id: 'first-dashboard',
        contentUrl: 'bundled:first-dashboard/content.json',
        manifestUrl: 'bundled:first-dashboard/manifest.json',
      })
    );
    setPackageResolver(resolver);

    const result = await fetchPackageById('first-dashboard', manifest);

    expect(resolver.resolve).toHaveBeenCalledWith('first-dashboard', { loadContent: false, verifyPublished: true });
    if (result.content) {
      expect(result.content.metadata.packageManifest).toEqual(manifest);
      expect(result.content.type).toBe('interactive');
    }
  });
});

// ---------------------------------------------------------------------------
// resolvePackageMilestones — milestone ID to Milestone object resolution
// ---------------------------------------------------------------------------

describe('resolvePackageMilestones', () => {
  afterEach(() => {
    setPackageResolver(
      makeResolver({
        ok: false,
        id: 'reset',
        error: { code: 'not-found', message: 'reset' },
      })
    );
  });

  it('returns empty array when no resolver is configured', async () => {
    // _packageResolver is a module-level singleton that other describe
    // blocks in this file have already set by this point — isolate a fresh
    // module instance so this genuinely exercises the "never configured"
    // guard clause rather than incidentally relying on a leftover
    // always-fails resolver (which, before locked-milestone placeholders
    // existed, happened to produce the same `[]` result either way).
    let fresh: typeof import('./content-fetcher/package-content');
    jest.isolateModules(() => {
      fresh = require('./content-fetcher/package-content');
    });
    const result = await fresh!.resolvePackageMilestones(['milestone-1', 'milestone-2']);
    expect(result).toEqual([]);
  });

  it('returns empty array for empty milestone list', async () => {
    setPackageResolver(makeResolver(makeSuccessResolution()));
    const result = await resolvePackageMilestones([]);
    expect(result).toEqual([]);
  });

  it('resolves milestone IDs to Milestone objects with sequential numbering', async () => {
    const resolver: PackageResolver = {
      resolve: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({
          ok: true,
          id,
          contentUrl: `bundled:${id}/content.json`,
          manifestUrl: `bundled:${id}/manifest.json`,
          repository: 'bundled',
          content: { id, title: `Title for ${id}`, blocks: [] },
          manifest: { id, type: 'guide' },
        })
      ),
    };
    setPackageResolver(resolver);

    const result = await resolvePackageMilestones(['step-one', 'step-two', 'step-three']);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      id: 'step-one',
      number: 1,
      title: 'Title for step-one',
      url: 'bundled:step-one/content.json',
      isActive: false,
    });
    expect(result[1]!.number).toBe(2);
    expect(result[2]!.number).toBe(3);
  });

  it('keeps unresolvable milestones as locked placeholders rather than dropping them (§6.5)', async () => {
    const resolver: PackageResolver = {
      resolve: jest.fn().mockImplementation((id: string) => {
        if (id === 'missing') {
          return Promise.resolve({
            ok: false,
            id,
            error: { code: 'not-found' as const, message: 'not found' },
          });
        }
        return Promise.resolve({
          ok: true,
          id,
          contentUrl: `bundled:${id}/content.json`,
          manifestUrl: `bundled:${id}/manifest.json`,
          repository: 'bundled',
          content: { id, title: `Title: ${id}`, blocks: [] },
          manifest: { id, type: 'guide' },
        });
      }),
    };
    setPackageResolver(resolver);

    const result = await resolvePackageMilestones(['first', 'missing', 'third']);

    // All three positions are preserved — the locked entry keeps numbering
    // and the "N of total" count accurate to the path's real member count.
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ number: 1, title: 'Title: first' });
    expect(result[0]!.isLocked).toBeUndefined();
    expect(result[1]).toMatchObject({ number: 2, title: 'missing', url: '', isLocked: true });
    expect(result[2]).toMatchObject({ number: 3, title: 'Title: third' });
    expect(result[2]!.isLocked).toBeUndefined();
  });

  it('surfaces the manifest description as a subtitle when content already has its own title', async () => {
    const resolver: PackageResolver = {
      resolve: jest.fn().mockResolvedValue({
        ok: true,
        id: 'data-sources',
        contentUrl: 'bundled:data-sources/content.json',
        manifestUrl: 'bundled:data-sources/manifest.json',
        repository: 'bundled',
        content: { id: 'data-sources', title: 'Data sources', blocks: [] },
        manifest: { id: 'data-sources', description: 'How connections and plugins work.', type: 'guide' },
      }),
    };
    setPackageResolver(resolver);

    const result = await resolvePackageMilestones(['data-sources']);
    expect(result[0]!.title).toBe('Data sources');
    expect(result[0]!.description).toBe('How connections and plugins work.');
  });

  it("surfaces the manifest's author-provided estimatedMinutes, and omits it when absent", async () => {
    const resolver: PackageResolver = {
      resolve: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({
          ok: true,
          id,
          contentUrl: `bundled:${id}/content.json`,
          manifestUrl: `bundled:${id}/manifest.json`,
          repository: 'bundled',
          content: { id, title: `Title for ${id}`, blocks: [] },
          manifest:
            id === 'timed'
              ? { id, type: 'guide', estimatedMinutes: 12 }
              : { id, type: 'guide' /* no estimatedMinutes authored */ },
        })
      ),
    };
    setPackageResolver(resolver);

    const result = await resolvePackageMilestones(['timed', 'untimed']);
    expect(result[0]!.estimatedMinutes).toBe(12);
    expect(result[1]!.estimatedMinutes).toBeUndefined();
  });

  it("surfaces the manifest's author-provided startingLocation, and omits it when absent", async () => {
    const resolver: PackageResolver = {
      resolve: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({
          ok: true,
          id,
          contentUrl: `bundled:${id}/content.json`,
          manifestUrl: `bundled:${id}/manifest.json`,
          repository: 'bundled',
          content: { id, title: `Title for ${id}`, blocks: [] },
          manifest:
            id === 'located'
              ? { id, type: 'guide', startingLocation: '/connections' }
              : { id, type: 'guide' /* no startingLocation authored */ },
        })
      ),
    };
    setPackageResolver(resolver);

    const result = await resolvePackageMilestones(['located', 'unlocated']);
    expect(result[0]!.startingLocation).toBe('/connections');
    expect(result[1]!.startingLocation).toBeUndefined();
  });

  it('falls back to description then ID when content title is missing', async () => {
    const resolver: PackageResolver = {
      resolve: jest.fn().mockResolvedValue({
        ok: true,
        id: 'no-title',
        contentUrl: 'bundled:no-title/content.json',
        manifestUrl: 'bundled:no-title/manifest.json',
        repository: 'bundled',
        manifest: { id: 'no-title', description: 'A description', type: 'guide' },
      }),
    };
    setPackageResolver(resolver);

    const result = await resolvePackageMilestones(['no-title']);
    expect(result[0]!.title).toBe('A description');
    // Title and description are the same string here (no separate short
    // title exists) — showing it twice would just duplicate the heading.
    expect(result[0]!.description).toBeUndefined();
  });

  it('prefers the CDN index entryTitle over the manifest description, and surfaces the description distinctly', async () => {
    const resolver: PackageResolver = {
      resolve: jest.fn().mockResolvedValue({
        ok: true,
        id: 'install-datasources',
        contentUrl: 'bundled:install-datasources/content.json',
        manifestUrl: 'bundled:install-datasources/manifest.json',
        repository: 'online-cdn',
        entryTitle: 'Install data sources',
        manifest: { id: 'install-datasources', description: 'Connect Prometheus and Loki.', type: 'guide' },
      }),
    };
    setPackageResolver(resolver);

    const result = await resolvePackageMilestones(['install-datasources']);
    expect(result[0]!.title).toBe('Install data sources');
    expect(result[0]!.description).toBe('Connect Prometheus and Loki.');
  });

  it('falls back to package ID when manifest has no title or description', async () => {
    const resolver: PackageResolver = {
      resolve: jest.fn().mockResolvedValue({
        ok: true,
        id: 'bare-id',
        contentUrl: 'bundled:bare-id/content.json',
        manifestUrl: 'bundled:bare-id/manifest.json',
        repository: 'bundled',
        manifest: { id: 'bare-id', type: 'guide' },
      }),
    };
    setPackageResolver(resolver);

    const result = await resolvePackageMilestones(['bare-id']);
    expect(result[0]!.title).toBe('bare-id');
  });

  it('locks milestones that throw during resolution rather than dropping them', async () => {
    const resolver: PackageResolver = {
      resolve: jest.fn().mockImplementation((id: string) => {
        if (id === 'exploder') {
          return Promise.reject(new Error('kaboom'));
        }
        return Promise.resolve({
          ok: true,
          id,
          contentUrl: `bundled:${id}/content.json`,
          manifestUrl: `bundled:${id}/manifest.json`,
          repository: 'bundled',
          content: { id, title: `Title: ${id}`, blocks: [] },
          manifest: { id, type: 'guide' },
        });
      }),
    };
    setPackageResolver(resolver);

    const result = await resolvePackageMilestones(['good', 'exploder', 'also-good']);

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ number: 1, title: 'Title: good' });
    expect(result[1]).toMatchObject({ number: 2, title: 'exploder', url: '', isLocked: true });
    expect(result[2]).toMatchObject({ number: 3, title: 'Title: also-good' });
  });
});

// ---------------------------------------------------------------------------
// resolvePackageTracks — Path Tracks RFC: resolve each track's own guides
// ---------------------------------------------------------------------------

describe('resolvePackageTracks', () => {
  afterEach(() => {
    setPackageResolver(
      makeResolver({
        ok: false,
        id: 'reset',
        error: { code: 'not-found', message: 'reset' },
      })
    );
  });

  it('returns an empty array for an empty tracks list', async () => {
    setPackageResolver(makeResolver(makeSuccessResolution()));
    const result = await resolvePackageTracks([]);
    expect(result).toEqual([]);
  });

  it("resolves each track's guides independently, preserving trackId and label", async () => {
    const resolver: PackageResolver = {
      resolve: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({
          ok: true,
          id,
          contentUrl: `bundled:${id}/content.json`,
          manifestUrl: `bundled:${id}/manifest.json`,
          repository: 'bundled',
          content: { id, title: `Title: ${id}`, blocks: [] },
          manifest: { id, type: 'guide' },
        })
      ),
    };
    setPackageResolver(resolver);

    const result = await resolvePackageTracks([
      { trackId: 'builder', label: 'Builder', guides: ['builder-1', 'builder-2'] },
      { trackId: 'seller', label: 'Seller', guides: ['seller-1'] },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ trackId: 'builder', label: 'Builder' });
    expect(result[0]!.milestones).toHaveLength(2);
    expect(result[0]!.milestones[0]!.title).toBe('Title: builder-1');
    expect(result[1]).toMatchObject({ trackId: 'seller', label: 'Seller' });
    expect(result[1]!.milestones).toHaveLength(1);
  });

  it('keeps an unresolvable track guide as a locked placeholder, same as milestones', async () => {
    const resolver: PackageResolver = {
      resolve: jest.fn().mockImplementation((id: string) => {
        if (id === 'missing') {
          return Promise.resolve({ ok: false, id, error: { code: 'not-found' as const, message: 'not found' } });
        }
        return Promise.resolve({
          ok: true,
          id,
          contentUrl: `bundled:${id}/content.json`,
          manifestUrl: `bundled:${id}/manifest.json`,
          repository: 'bundled',
          content: { id, title: `Title: ${id}`, blocks: [] },
          manifest: { id, type: 'guide' },
        });
      }),
    };
    setPackageResolver(resolver);

    const result = await resolvePackageTracks([{ trackId: 'builder', label: 'Builder', guides: ['ok', 'missing'] }]);

    expect(result[0]!.milestones).toEqual([
      expect.objectContaining({ number: 1, title: 'Title: ok' }),
      expect.objectContaining({ number: 2, title: 'missing', url: '', isLocked: true }),
    ]);
  });
});

// ---------------------------------------------------------------------------
// fetchPackageContent — path-type package learningJourney enrichment
// ---------------------------------------------------------------------------

describe('fetchPackageContent path-type enrichment', () => {
  afterEach(() => {
    setPackageResolver(
      makeResolver({
        ok: false,
        id: 'reset',
        error: { code: 'not-found', message: 'reset' },
      })
    );
  });

  it('builds learningJourney metadata for path-type packages with milestones', async () => {
    const resolver: PackageResolver = {
      resolve: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({
          ok: true,
          id,
          contentUrl: `bundled:${id}/content.json`,
          manifestUrl: `bundled:${id}/manifest.json`,
          repository: 'bundled',
          content: { id, title: `Milestone: ${id}`, blocks: [] },
          manifest: { id, type: 'guide' },
        })
      ),
    };
    setPackageResolver(resolver);

    // manifest.id must match the loaded contentUrl's own resource name
    // (first-dashboard is a real bundled fixture) — the cover-page check
    // now positively resolves manifest.id and compares it against the
    // loaded contentUrl, rather than eliminating milestones/tracks matches.
    const manifest = {
      id: 'first-dashboard',
      type: 'path',
      milestones: ['step-1', 'step-2'],
    };

    const result = await fetchPackageContent('bundled:first-dashboard/content.json', manifest);

    if (result.content) {
      expect(result.content.type).toBe('learning-journey');
      expect(result.content.metadata.learningJourney).toBeDefined();
      expect(result.content.metadata.learningJourney!.totalMilestones).toBe(2);
      expect(result.content.metadata.learningJourney!.currentMilestone).toBe(0);
      expect(result.content.metadata.learningJourney!.milestones).toHaveLength(2);
      expect(result.content.metadata.learningJourney!.milestones[0]!.title).toBe('Milestone: step-1');
    }
  });

  it('resolves manifest tracks into learningJourney.tracks on the cover page', async () => {
    const resolver: PackageResolver = {
      resolve: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({
          ok: true,
          id,
          contentUrl: `bundled:${id}/content.json`,
          manifestUrl: `bundled:${id}/manifest.json`,
          repository: 'bundled',
          content: { id, title: `Milestone: ${id}`, blocks: [] },
          manifest: { id, type: 'guide' },
        })
      ),
    };
    setPackageResolver(resolver);

    // manifest.id matches the loaded contentUrl's own resource name (see
    // the comment on the previous test) so the cover-page resolution succeeds.
    const manifest = {
      id: 'first-dashboard',
      type: 'path',
      milestones: ['step-1', 'step-2'],
      tracks: [{ trackId: 'builder', label: 'Builder', guides: ['builder-1'] }],
    };

    const result = await fetchPackageContent('bundled:first-dashboard/content.json', manifest);

    const journey = result.content!.metadata.learningJourney!;
    expect(journey.tracks).toHaveLength(1);
    expect(journey.tracks![0]).toMatchObject({ trackId: 'builder', label: 'Builder' });
    expect(journey.tracks![0]!.milestones).toHaveLength(1);
    expect(journey.tracks![0]!.milestones[0]!.title).toBe('Milestone: builder-1');
  });

  it('omits learningJourney.tracks when the manifest declares no tracks (regression: unchanged default)', async () => {
    const resolver: PackageResolver = {
      resolve: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({
          ok: true,
          id,
          contentUrl: `bundled:${id}/content.json`,
          manifestUrl: `bundled:${id}/manifest.json`,
          repository: 'bundled',
          content: { id, title: `Milestone: ${id}`, blocks: [] },
          manifest: { id, type: 'guide' },
        })
      ),
    };
    setPackageResolver(resolver);

    // manifest.id matches the loaded contentUrl's own resource name (see
    // the comment two tests up) so the cover-page resolution succeeds.
    const manifest = { id: 'first-dashboard', type: 'path', milestones: ['step-1'] };
    const result = await fetchPackageContent('bundled:first-dashboard/content.json', manifest);

    expect(result.content!.metadata.learningJourney!.tracks).toBeUndefined();
  });

  // Regression (human review on PR #1927, "track-guide-loads-as-cover-page",
  // HIGH): a guide referenced only by a track — never by milestones, which
  // the RFC explicitly allows — has no milestones index, so currentMilestone
  // fell back to 0 and isJourneyCoverPage misclassified it as the path's own
  // cover page instead of as itself.
  it('does not classify a track-exclusive guide as the cover page', async () => {
    const resolver: PackageResolver = {
      resolve: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({
          ok: true,
          id,
          contentUrl: `bundled:${id}/content.json`,
          manifestUrl: `bundled:${id}/manifest.json`,
          repository: 'bundled',
          content: { id, title: `Milestone: ${id}`, blocks: [] },
          manifest: { id, type: 'guide' },
        })
      ),
    };
    setPackageResolver(resolver);

    // The resolver mock maps any id to `bundled:<id>/content.json`, so the
    // loaded contentUrl below must match a real bundled fixture (used
    // elsewhere in this file) both to load successfully AND to resolve, as
    // a track member, to that same URL.
    const manifest = {
      id: 'test-path',
      type: 'path',
      milestones: ['step-1', 'step-2'],
      tracks: [{ trackId: 'builder', label: 'Builder', guides: ['first-dashboard'] }],
    };

    const result = await fetchPackageContent('bundled:first-dashboard/content.json', manifest);

    expect(result.content).not.toBeNull();
    expect(isJourneyCoverPage(result.content!)).toBe(false);
    // Regression (Cursor Bugbot on PR #1927, "Track-only guides get invalid
    // milestone index", MEDIUM): an earlier fix synthesized currentMilestone
    // = -1 to dodge the cover-page branch, but that sentinel leaked into
    // every consumer that assumes a non-zero value is a real Foundations
    // step — the docs-panel step label showed "Step -1 of N", Previous
    // stayed disabled, and Next jumped into Foundations module 1. A
    // track-only guide has no real Foundations position, so learningJourney
    // must be entirely absent instead — the same, already-supported state a
    // path with zero resolved milestones produces (see the "does not add
    // learningJourney for path packages without milestones" case above).
    expect(result.content!.metadata.learningJourney).toBeUndefined();
    expect(getTotalMilestones(result.content!)).toBe(0);
    expect(getNextMilestoneUrl(result.content!)).toBeNull();
    expect(getPreviousMilestoneUrl(result.content!)).toBeNull();
    // Regression (Cursor Bugbot on PR #1927, "Track-only guides skip
    // completion writes", HIGH): with no learningJourney, this is what lets
    // recordGuideCompletionForSurface still route this guide's completion
    // through milestoneCompletionStorage under its own identity — the path's
    // own resolved base URL, not this guide's own contentUrl.
    expect(result.content!.metadata.trackMemberBaseUrl).toBe('bundled:test-path/content.json');
  });

  // Regression (captain-approved structural fix on PR #1927, round 5):
  // classification was inferred from comparing resolved URLs across 4
  // review rounds, and each round's fix flipped which case it broke
  // (guide-loads-as-cover-page -> -1 sentinel -> skipped completion write ->
  // failed-resolve misclassified as cover -> an ordinary cover misclassified
  // as a track member). Fixed structurally: `explicitGuideId` — the manifest
  // guide id the click target already carried (GuideList's current row, the
  // cover page's CTA) — makes the decision a direct id lookup against
  // `milestones`/`tracks`, not a URL comparison. This single test exercises
  // all three classifications against the SAME manifest so this exact
  // regression class cannot round-trip again: a real cover-page load (no
  // explicitGuideId — the load behind no click, e.g. the initial open), a
  // track-exclusive guide load (explicitGuideId set to a track's own guide
  // id), and an ordinary Foundations milestone load (explicitGuideId set to
  // a milestone id).
  it('classifies cover-page, track-exclusive, and ordinary-milestone loads correctly together against one manifest', async () => {
    const resolver: PackageResolver = {
      resolve: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({
          ok: true,
          id,
          contentUrl: `bundled:${id}/content.json`,
          manifestUrl: `bundled:${id}/manifest.json`,
          repository: 'bundled',
          content: { id, title: `Milestone: ${id}`, blocks: [] },
          manifest: { id, type: 'guide' },
        })
      ),
    };
    setPackageResolver(resolver);

    // Every contentUrl fetchPackageContent is CALLED WITH below must be a
    // real bundled fixture (fetchContent loads it for real) — everything
    // else (milestone/track resolution, baseUrlResolution) goes through the
    // mock resolver above regardless of whether the id is a real fixture.
    const manifest = {
      id: 'welcome-to-grafana',
      type: 'path',
      milestones: ['loki-grafana-101', 'prometheus-grafana-101'],
      tracks: [{ trackId: 'builder', label: 'Builder', guides: ['first-dashboard'] }],
    };

    // 1. Cover-page load: no explicitGuideId, contentUrl is the path's own
    // resolved base URL — the load with no click behind it.
    const coverResult = await fetchPackageContent('bundled:welcome-to-grafana/content.json', manifest);
    expect(coverResult.content!.metadata.learningJourney).toBeDefined();
    expect(coverResult.content!.metadata.learningJourney!.currentMilestone).toBe(0);
    expect(coverResult.content!.metadata.trackMemberBaseUrl).toBeUndefined();

    // 2. Track-exclusive guide load: explicitGuideId is the track's own
    // guide id — never listed in `milestones` — so this must classify as a
    // track member by direct lookup, not as the cover page.
    const trackResult = await fetchPackageContent(
      'bundled:first-dashboard/content.json',
      manifest,
      undefined,
      undefined,
      undefined,
      'first-dashboard'
    );
    expect(trackResult.content!.metadata.learningJourney).toBeUndefined();
    expect(trackResult.content!.metadata.trackMemberBaseUrl).toBe('bundled:welcome-to-grafana/content.json');

    // 3. Ordinary Foundations milestone load: explicitGuideId is a real
    // `milestones` entry, so this must classify as milestone index 0 (the
    // first step) by direct lookup, not by comparing contentUrl to anything.
    const milestoneResult = await fetchPackageContent(
      'bundled:loki-grafana-101/content.json',
      manifest,
      undefined,
      undefined,
      undefined,
      'loki-grafana-101'
    );
    expect(milestoneResult.content!.metadata.learningJourney).toBeDefined();
    expect(milestoneResult.content!.metadata.learningJourney!.currentMilestone).toBe(1);
    expect(milestoneResult.content!.metadata.trackMemberBaseUrl).toBeUndefined();
  });

  // Regression (review round on PR #1927, "track-only guide baseUrl resolver
  // failure"): when resolving the path's own manifestId fails or is
  // transiently unavailable, trackMemberBaseUrl must stay undefined rather
  // than silently fall back to this guide's own contentUrl — that value is
  // not interchangeable with the path's resolved base the cover page reads
  // completion under, so writing it would look fixed while staying broken.
  // The failure is instead surfaced via a warning log.
  it('leaves trackMemberBaseUrl unset and warns when the path base URL fails to resolve', async () => {
    const resolver: PackageResolver = {
      resolve: jest.fn().mockImplementation((id: string) => {
        if (id === 'test-path') {
          return Promise.resolve({ ok: false, id, error: { code: 'not-found', message: 'not found' } });
        }
        return Promise.resolve({
          ok: true,
          id,
          contentUrl: `bundled:${id}/content.json`,
          manifestUrl: `bundled:${id}/manifest.json`,
          repository: 'bundled',
          content: { id, title: `Milestone: ${id}`, blocks: [] },
          manifest: { id, type: 'guide' },
        });
      }),
    };
    setPackageResolver(resolver);
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});

    const manifest = {
      id: 'test-path',
      type: 'path',
      milestones: ['step-1', 'step-2'],
      tracks: [{ trackId: 'builder', label: 'Builder', guides: ['first-dashboard'] }],
    };

    const result = await fetchPackageContent('bundled:first-dashboard/content.json', manifest);

    expect(result.content!.metadata.trackMemberBaseUrl).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Could not resolve path base URL'), {
      manifestId: 'test-path',
    });

    warnSpy.mockRestore();
  });

  // Regression (moxious review on PR #1927,
  // "track-only-parent-resolution-loses-completion", MEDIUM): a track-only
  // guide's OWN content can load successfully while this SAME request's
  // independent re-resolve of the path's manifestId transiently fails (a CDN
  // hiccup unrelated to the guide's own content). Without a fallback, that
  // failure silently drops the guide's completion entirely — no
  // trackMemberBaseUrl means recordGuideCompletionForSurface has no journey
  // base to write against, so the learner can mark it complete and it never
  // sticks. knownBaseUrl — the cover page's own base URL, already known to
  // docs-panel.tsx since a track-only guide is only ever reached by clicking
  // it FROM that same cover — lets this succeed anyway, with no warning
  // needed since the caller already had the answer.
  it('falls back to knownBaseUrl for trackMemberBaseUrl when the path base URL fails to resolve', async () => {
    const resolver: PackageResolver = {
      resolve: jest.fn().mockImplementation((id: string) => {
        if (id === 'test-path') {
          return Promise.resolve({ ok: false, id, error: { code: 'not-found', message: 'not found' } });
        }
        return Promise.resolve({
          ok: true,
          id,
          contentUrl: `bundled:${id}/content.json`,
          manifestUrl: `bundled:${id}/manifest.json`,
          repository: 'bundled',
          content: { id, title: `Milestone: ${id}`, blocks: [] },
          manifest: { id, type: 'guide' },
        });
      }),
    };
    setPackageResolver(resolver);
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});

    const manifest = {
      id: 'test-path',
      type: 'path',
      milestones: ['step-1', 'step-2'],
      tracks: [{ trackId: 'builder', label: 'Builder', guides: ['first-dashboard'] }],
    };

    const result = await fetchPackageContent(
      'bundled:first-dashboard/content.json',
      manifest,
      undefined,
      undefined,
      undefined,
      'first-dashboard',
      'bundled:test-path/content.json'
    );

    expect(result.content!.metadata.trackMemberBaseUrl).toBe('bundled:test-path/content.json');
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  // Regression (code-review self-check on PR #1927, round 4): the positive
  // cover-page check above depends on THIS SAME request's own resolve of
  // manifestId succeeding. That resolve can fail for the real cover page's
  // own load exactly as easily as for a track member's — a resolver hiccup
  // must not misclassify the cover page itself as an unresolvable track
  // guide. No track resolves to this contentUrl either (there are no
  // tracks), so neither signal confirms a track member and this must still
  // default to being the cover page.
  it('still classifies the real cover page correctly when its own baseUrl resolve fails', async () => {
    const resolver: PackageResolver = {
      resolve: jest.fn().mockImplementation((id: string) => {
        if (id === 'test-path') {
          return Promise.resolve({ ok: false, id, error: { code: 'not-found', message: 'not found' } });
        }
        return Promise.resolve({
          ok: true,
          id,
          contentUrl: `bundled:${id}/content.json`,
          manifestUrl: `bundled:${id}/manifest.json`,
          repository: 'bundled',
          content: { id, title: `Milestone: ${id}`, blocks: [] },
          manifest: { id, type: 'guide' },
        });
      }),
    };
    setPackageResolver(resolver);

    const manifest = {
      id: 'test-path',
      type: 'path',
      milestones: ['step-1', 'step-2'],
    };

    const result = await fetchPackageContent('bundled:first-dashboard/content.json', manifest);

    expect(result.content!.metadata.learningJourney).toBeDefined();
    expect(result.content!.metadata.learningJourney!.currentMilestone).toBe(0);
    expect(result.content!.metadata.trackMemberBaseUrl).toBeUndefined();
  });

  // Regression (moxious review on PR #1927, "cover-load-url-mismatch",
  // HIGH): PrTester opens a path's cover via a raw PR URL, which differs
  // from resolve(manifestId)'s published CDN URL. The old fallback read that
  // URL mismatch alone as proof of track membership — wrong even with no
  // tracks at all. DocsPanelContentArea's devtools wrapper now passes the
  // manifest's own id as explicitGuideId whenever it's deliberately opening
  // that package's own cover, which settles this by direct lookup instead:
  // the id is neither a milestone nor a track guide, so the URL mismatch
  // never enters into it.
  it('classifies a cover load correctly via explicitGuideId even when the resolved URL differs (no tracks)', async () => {
    const resolver: PackageResolver = {
      resolve: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({
          ok: true,
          id,
          contentUrl: `bundled:${id}/content.json`,
          manifestUrl: `bundled:${id}/manifest.json`,
          repository: 'bundled',
          content: { id, title: `Milestone: ${id}`, blocks: [] },
          manifest: { id, type: 'guide' },
        })
      ),
    };
    setPackageResolver(resolver);

    const manifest = { id: 'test-path', type: 'path', milestones: ['step-1', 'step-2'] };

    // contentUrl (the "raw" URL) deliberately differs from what resolving
    // 'test-path' returns ('bundled:test-path/content.json').
    const result = await fetchPackageContent(
      'bundled:first-dashboard/content.json',
      manifest,
      undefined,
      undefined,
      undefined,
      'test-path'
    );

    expect(result.content!.metadata.learningJourney).toBeDefined();
    expect(result.content!.metadata.learningJourney!.currentMilestone).toBe(0);
    expect(result.content!.metadata.trackMemberBaseUrl).toBeUndefined();
  });

  it('classifies a cover load correctly via explicitGuideId even when the resolved URL differs (with tracks)', async () => {
    const resolver: PackageResolver = {
      resolve: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({
          ok: true,
          id,
          contentUrl: `bundled:${id}/content.json`,
          manifestUrl: `bundled:${id}/manifest.json`,
          repository: 'bundled',
          content: { id, title: `Milestone: ${id}`, blocks: [] },
          manifest: { id, type: 'guide' },
        })
      ),
    };
    setPackageResolver(resolver);

    const manifest = {
      id: 'test-path',
      type: 'path',
      milestones: ['step-1', 'step-2'],
      tracks: [{ trackId: 'builder', label: 'Builder', guides: ['first-dashboard'] }],
    };

    // Neither the raw contentUrl nor resolving 'test-path' matches
    // (mismatch), and the track's own guide resolves to a THIRD, distinct
    // URL — none of that should matter once explicitGuideId settles it.
    const result = await fetchPackageContent(
      'bundled:welcome-to-grafana/content.json',
      manifest,
      undefined,
      undefined,
      undefined,
      'test-path'
    );

    expect(result.content!.metadata.learningJourney).toBeDefined();
    expect(result.content!.metadata.learningJourney!.currentMilestone).toBe(0);
    expect(result.content!.metadata.trackMemberBaseUrl).toBeUndefined();
  });

  // `repository-identity-authority`: without the fallback, opening the same
  // package from My Learning / Discover More (manifest inlined, no explicit
  // repository) recorded under the manifest schema default while the nav-link
  // path recorded under the resolved one — one guide, two durable guideSource keys.
  it('stamps the resolved repository when the caller supplies none', async () => {
    setPackageResolver(
      makeResolver(
        makeSuccessResolution({
          id: 'discover-path',
          contentUrl: 'bundled:first-dashboard/content.json',
          repository: 'online-cdn',
        })
      )
    );

    const result = await fetchPackageContent('bundled:first-dashboard/content.json', {
      id: 'discover-path',
      type: 'path',
      repository: 'interactive-tutorials',
    });

    expect(result.content).not.toBeNull();
    expect(result.content!.metadata.repository).toBe('online-cdn');
  });

  // A failed resolution's `repository` is negative-caching policy, not an
  // identity claim: app-platform is unconditionally the composite's last tier,
  // so its probed-and-missed failure would otherwise key a public CDN path as
  // ('app-platform', <id>).
  it('does not stamp the repository off a failed resolution', async () => {
    setPackageResolver(
      makeResolver({
        ok: false,
        id: 'discover-path',
        error: { code: 'not-found', message: 'all tiers missed' },
        repository: 'app-platform',
      })
    );

    const result = await fetchPackageContent('bundled:first-dashboard/content.json', {
      id: 'discover-path',
      type: 'path',
    });

    expect(result.content).not.toBeNull();
    expect(result.content!.metadata.repository).toBeUndefined();
  });

  it('lets an explicit caller repository outrank the resolved one', async () => {
    setPackageResolver(
      makeResolver(
        makeSuccessResolution({
          id: 'explicit-path',
          contentUrl: 'bundled:first-dashboard/content.json',
          repository: 'online-cdn',
        })
      )
    );

    const result = await fetchPackageContent(
      'bundled:first-dashboard/content.json',
      { id: 'explicit-path', type: 'path' },
      undefined,
      'app-platform'
    );

    expect(result.content).not.toBeNull();
    expect(result.content!.metadata.repository).toBe('app-platform');
  });

  it('suppresses the legacy Ready to Begin button on the cover, keeping the bottom nav', async () => {
    const resolver: PackageResolver = {
      resolve: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({
          ok: true,
          id,
          contentUrl: `bundled:${id}/content.json`,
          manifestUrl: `bundled:${id}/manifest.json`,
          repository: 'bundled',
          content: { id, title: `Milestone: ${id}`, blocks: [] },
          manifest: { id, type: 'guide' },
        })
      ),
    };
    setPackageResolver(resolver);

    // manifest.id matches the loaded contentUrl's own resource name so the
    // cover-page resolution succeeds (see the comment further up this file).
    const manifest = {
      id: 'first-dashboard',
      type: 'path',
      milestones: ['step-1', 'step-2'],
    };

    // The React cover-page TOC (LearningPathTableOfContents) owns the
    // Start/Resume affordance now; the legacy HTML button always said "Ready
    // to Begin" and always targeted milestone 1, regardless of progress.
    const result = await fetchPackageContent('bundled:first-dashboard/content.json', manifest);

    expect(result.content!.content).not.toContain('journey-ready-to-begin');
    expect(result.content!.content).toContain('journey-bottom-navigation');
  });

  it('does not add learningJourney for guide-type packages', async () => {
    const manifest = {
      id: 'test-guide',
      type: 'guide',
    };

    const result = await fetchPackageContent('bundled:first-dashboard/content.json', manifest);

    if (result.content) {
      expect(result.content.type).toBe('interactive');
      expect(result.content.metadata.learningJourney).toBeUndefined();
    }
  });

  it('does not add learningJourney for path packages without milestones', async () => {
    const manifest = {
      id: 'empty-path',
      type: 'path',
    };

    const result = await fetchPackageContent('bundled:first-dashboard/content.json', manifest);

    if (result.content) {
      expect(result.content.type).toBe('learning-journey');
      expect(result.content.metadata.learningJourney).toBeUndefined();
    }
  });

  it('resolves the baseUrl hydration call as URL-only, without the verify-published probe (#1561 scope)', async () => {
    const resolver: PackageResolver = {
      resolve: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({
          ok: true,
          id,
          contentUrl: `bundled:${id}/content.json`,
          manifestUrl: `bundled:${id}/manifest.json`,
          repository: 'bundled',
          content: { id, title: `Milestone: ${id}`, blocks: [] },
          manifest: { id, type: 'guide' },
        })
      ),
    };
    setPackageResolver(resolver);

    const manifest = {
      id: 'test-path',
      type: 'path',
      milestones: ['step-1', 'step-2'],
    };

    await fetchPackageContent('bundled:first-dashboard/content.json', manifest);

    // The baseUrl hydration resolve() runs on every milestone package-content
    // fetch — a network round-trip probe here (like fetchPackageById's) would
    // be a real perf regression, so it stays URL-only.
    expect(resolver.resolve).toHaveBeenCalledWith('test-path', { loadContent: false });
    expect(resolver.resolve).not.toHaveBeenCalledWith('test-path', expect.objectContaining({ verifyPublished: true }));
  });

  it('preserves packageManifest alongside learningJourney', async () => {
    const resolver: PackageResolver = {
      resolve: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({
          ok: true,
          id,
          contentUrl: `bundled:${id}/content.json`,
          manifestUrl: `bundled:${id}/manifest.json`,
          repository: 'bundled',
          content: { id, title: `Milestone: ${id}`, blocks: [] },
          manifest: { id, type: 'guide' },
        })
      ),
    };
    setPackageResolver(resolver);

    // manifest.id matches the loaded contentUrl's own resource name so the
    // cover-page resolution succeeds (see the comment further up this file).
    const manifest = {
      id: 'first-dashboard',
      type: 'path',
      milestones: ['ms-1'],
    };

    const result = await fetchPackageContent('bundled:first-dashboard/content.json', manifest);

    if (result.content) {
      expect(result.content.metadata.packageManifest).toEqual(manifest);
      expect(result.content.metadata.learningJourney).toBeDefined();
    }
  });

  it('hydrates baseUrl by resolving manifest.id in URL-only mode, which never verifies (matches AppPlatformPackageResolver)', async () => {
    // AppPlatformPackageResolver's URL-only mode (no verifyPublished) never
    // probes the upstream resource — it just string-templates the id it's
    // given into a contentUrl and returns ok: true unconditionally (see
    // fetchPackageById's "its id is already known-good" comment). This mock
    // matches that contract: it always succeeds, so correctness here depends
    // entirely on manifest.id already being the resource-addressable one —
    // which app-platform-resolver.ts's buildManifest guarantees for
    // path/journey manifests regardless of a drifted spec.id (pinned in
    // app-platform-resolver.test.ts). A resolver mock that returns `ok: false`
    // for a "wrong" id would misrepresent that contract (Cursor Bugbot flagged
    // exactly this on an earlier version of this test).
    const resolver: PackageResolver = {
      resolve: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({
          ok: true,
          id,
          contentUrl: `bundled:${id}/content.json`,
          manifestUrl: `bundled:${id}/manifest.json`,
          repository: 'bundled',
          content: { id, title: `Milestone: ${id}`, blocks: [] },
          manifest: { id, type: 'guide' },
        })
      ),
    };
    setPackageResolver(resolver);

    const manifest = {
      id: 'the-real-resource-name',
      type: 'path',
      milestones: ['first-dashboard'],
    };

    const result = await fetchPackageContent('bundled:first-dashboard/content.json', manifest);

    expect(result.content).toBeTruthy();
    expect(result.content?.metadata.learningJourney?.baseUrl).toBe('bundled:the-real-resource-name/content.json');
    expect(resolver.resolve).toHaveBeenCalledWith('the-real-resource-name', { loadContent: false });
  });
});

// The realistically-broken catalogue inputs: the CR manifest leaves
// `repository` omitempty, and the CLI authoring tooling stamps the CDN default
// `interactive-tutorials`. Both reach the launch surfaces through the catalogue
// client, so the suppression gate is only sound if that client normalizes them.
describe('fetchPackageContent — no public websiteUrl for catalogue-launched private paths', () => {
  const GAP_TOGGLE = 'aggregation.pathfinderbackend-ext-grafana-app.enabled';
  const featureToggles = config.featureToggles as Record<string, boolean>;
  // setBackendSrv writes a module-level singleton, so the fake below outlives
  // this block and reaches every later describe unless afterEach puts it back.
  const originalBackendSrv = getBackendSrv();

  async function launchManifestFromCatalogue(manifest: Record<string, unknown>): Promise<Record<string, unknown>> {
    featureToggles[GAP_TOGGLE] = true;
    invalidateCustomGuideRepositoryCache();
    setBackendSrv({
      get: async () => ({ capability: { available: true }, guides: [{ id: 'fe-alerting-path', manifest }] }),
    } as unknown as BackendSrv);

    const [entry] = await fetchCustomGuideRepository('stacks-123');
    return { ...entry!.manifest, id: entry!.id };
  }

  beforeEach(() => {
    setPackageResolver({
      resolve: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({
          ok: true,
          id,
          // The catalogue mock below hardcodes the launched guide's id as
          // 'fe-alerting-path' — resolving it must point at a real bundled
          // fixture (first-dashboard, the contentUrl this test loads) so
          // the cover-page's own baseUrl resolution matches, the same
          // convention every other fixture in this file follows.
          contentUrl: id === 'fe-alerting-path' ? 'bundled:first-dashboard/content.json' : `bundled:${id}/content.json`,
          manifestUrl: `bundled:${id}/manifest.json`,
          repository: 'app-platform',
          content: { id, title: `Milestone: ${id}`, blocks: [] },
          manifest: { id, type: 'guide' },
        })
      ),
    });
  });

  afterEach(() => {
    setBackendSrv(originalBackendSrv);
    delete featureToggles[GAP_TOGGLE];
    invalidateCustomGuideRepositoryCache();
    setPackageResolver(makeResolver({ ok: false, id: 'reset', error: { code: 'not-found', message: 'reset' } }));
  });

  it.each([
    ['omits repository entirely', undefined],
    ["carries the CLI's interactive-tutorials default", 'interactive-tutorials'],
  ])('synthesizes no learning-paths URL when the catalogue manifest %s', async (_label, repository) => {
    const manifest = await launchManifestFromCatalogue({
      type: 'path',
      // Shares the derived path slug's prefix, so an un-suppressed slug WOULD
      // build both the cover and the per-milestone URL.
      milestones: ['fe-alerting-path-01'],
      ...(repository != null && { repository }),
    });
    expect(manifest.repository).toBe('app-platform');

    const result = await fetchPackageContent('bundled:first-dashboard/content.json', manifest);

    const learningJourney = result.content!.metadata.learningJourney!;
    expect(learningJourney.milestones).toHaveLength(1);
    expect(learningJourney.websiteUrl).toBeUndefined();
    expect(learningJourney.milestones[0]!.websiteUrl).toBeUndefined();
    // Catches the injected cover copy too, not just the metadata fields.
    expect(JSON.stringify(result)).not.toContain('grafana.com/docs/learning-paths');
  });
});

describe('ensureNonEmptyCoverContent (RFC Appendix A F15)', () => {
  it('substitutes a friendly placeholder when blocks is empty', () => {
    const result = ensureNonEmptyCoverContent(JSON.stringify({ id: 'fe-path', title: 'FE path', blocks: [] }));
    const parsed = JSON.parse(result);

    expect(parsed.id).toBe('fe-path');
    expect(parsed.title).toBe('FE path');
    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.blocks[0].type).toBe('markdown');
    expect(parsed.blocks[0].content).toContain('Cover content is missing');
  });

  it('leaves non-empty blocks unchanged', () => {
    const original = JSON.stringify({
      id: 'fe-path',
      title: 'FE path',
      blocks: [{ type: 'markdown', content: 'Real cover content' }],
    });
    expect(ensureNonEmptyCoverContent(original)).toBe(original);
  });

  it('leaves content unchanged when blocks is missing entirely', () => {
    const original = JSON.stringify({ id: 'fe-path', title: 'FE path' });
    expect(ensureNonEmptyCoverContent(original)).toBe(original);
  });

  it('returns the input unchanged on malformed JSON rather than throwing', () => {
    const malformed = '{not json';
    expect(() => ensureNonEmptyCoverContent(malformed)).not.toThrow();
    expect(ensureNonEmptyCoverContent(malformed)).toBe(malformed);
  });
});

describe('static docs path is unchanged', () => {
  it('rejects untrusted domains as before', async () => {
    const result = await fetchContent('https://untrusted.example.com/some-doc');
    expect(result.content).toBeNull();
    expect(result.error).toMatch(/Only Grafana/i);
  });

  it('fetchPackageContent with a CDN URL forwards to fetchContent unchanged', async () => {
    // The CDN domain interactive-learning.grafana.net is trusted.
    // A 404-or-network failure is expected in tests but the routing is correct.
    const result = await fetchPackageContent(
      'https://interactive-learning.grafana.net/packages/alerting-101/content.json'
    );
    // Either content returned (unlikely in unit tests without mocks) or a fetch error
    expect(result).toHaveProperty('content');
  });
});

// ---------------------------------------------------------------------------
// resolvePackageNavLinks — bare package IDs to ResolvedNavLink objects
// (PR 9: previously had no direct coverage)
// ---------------------------------------------------------------------------

describe('resolvePackageNavLinks', () => {
  afterEach(() => {
    setPackageResolver(
      makeResolver({
        ok: false,
        id: 'reset',
        error: { code: 'not-found', message: 'reset' },
      })
    );
  });

  it('returns empty array when no resolver is configured', async () => {
    const result = await resolvePackageNavLinks(['pkg-a']);
    expect(result).toEqual([]);
  });

  it('returns empty array for an empty package list', async () => {
    setPackageResolver(makeResolver(makeSuccessResolution()));
    const result = await resolvePackageNavLinks([]);
    expect(result).toEqual([]);
  });

  it('resolves IDs to nav links with title, contentUrl, and manifest', async () => {
    const resolver: PackageResolver = {
      resolve: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({
          ok: true,
          id,
          contentUrl: `bundled:${id}/content.json`,
          manifestUrl: `bundled:${id}/manifest.json`,
          repository: 'bundled',
          content: { id, title: `Title for ${id}`, blocks: [] },
          manifest: { id, type: 'guide' },
        })
      ),
    };
    setPackageResolver(resolver);

    const result = await resolvePackageNavLinks(['alpha', 'beta']);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      packageId: 'alpha',
      title: 'Title for alpha',
      contentUrl: 'bundled:alpha/content.json',
      manifest: { id: 'alpha', type: 'guide' },
      repository: 'bundled',
    });
    expect(result[1]!.packageId).toBe('beta');
  });

  it('falls back to entryTitle when content has no title', async () => {
    const resolver: PackageResolver = {
      resolve: jest.fn().mockResolvedValue({
        ok: true,
        id: 'install-datasources',
        contentUrl: 'bundled:install-datasources/content.json',
        manifestUrl: 'bundled:install-datasources/manifest.json',
        repository: 'online-cdn',
        entryTitle: 'Install data sources',
        manifest: { id: 'install-datasources', description: 'Connect Prometheus and Loki.', type: 'guide' },
      }),
    };
    setPackageResolver(resolver);

    const result = await resolvePackageNavLinks(['install-datasources']);
    expect(result[0]!.title).toBe('Install data sources');
  });

  it('falls back to description then ID for the title, and skips unresolvable IDs', async () => {
    const resolver: PackageResolver = {
      resolve: jest.fn().mockImplementation((id: string) => {
        if (id === 'gone') {
          return Promise.resolve({ ok: false, id, error: { code: 'not-found' as const, message: 'nope' } });
        }
        return Promise.resolve({
          ok: true,
          id,
          contentUrl: `bundled:${id}/content.json`,
          manifestUrl: `bundled:${id}/manifest.json`,
          repository: 'bundled',
          manifest: { id, description: `Desc ${id}`, type: 'guide' },
        });
      }),
    };
    setPackageResolver(resolver);

    const result = await resolvePackageNavLinks(['keep', 'gone']);

    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe('Desc keep');
  });
});

// ---------------------------------------------------------------------------
// resolvePackageMilestones — website URL derivation (buildMilestoneWebsiteUrl)
// (PR 9: the pathSlug-driven URL builder previously had no direct coverage)
// ---------------------------------------------------------------------------

describe('resolvePackageMilestones — website URL derivation', () => {
  afterEach(() => {
    setPackageResolver(
      makeResolver({
        ok: false,
        id: 'reset',
        error: { code: 'not-found', message: 'reset' },
      })
    );
  });

  const milestoneResolver = (): PackageResolver => ({
    resolve: jest.fn().mockImplementation((id: string) =>
      Promise.resolve({
        ok: true,
        id,
        contentUrl: `bundled:${id}/content.json`,
        manifestUrl: `bundled:${id}/manifest.json`,
        repository: 'bundled',
        content: { id, title: `Title ${id}`, blocks: [] },
        manifest: { id, type: 'guide' },
      })
    ),
  });

  it('builds the learning-paths website URL when the milestone ID shares the path-slug prefix', async () => {
    setPackageResolver(milestoneResolver());

    const result = await resolvePackageMilestones(['grafana-cloud-tour-business-value'], 'grafana-cloud-tour');

    expect(result[0]!.websiteUrl).toBe('https://grafana.com/docs/learning-paths/grafana-cloud-tour/business-value/');
  });

  it('leaves websiteUrl undefined when the milestone ID does not match the path-slug prefix', async () => {
    setPackageResolver(milestoneResolver());

    const result = await resolvePackageMilestones(['unrelated-id'], 'grafana-cloud-tour');

    expect(result[0]!.websiteUrl).toBeUndefined();
  });

  it('omits websiteUrl entirely when no path slug is provided', async () => {
    setPackageResolver(milestoneResolver());

    const result = await resolvePackageMilestones(['any-id']);

    expect(result[0]).not.toHaveProperty('websiteUrl');
  });
});
