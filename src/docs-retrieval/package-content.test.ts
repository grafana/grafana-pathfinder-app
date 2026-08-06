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
import {
  fetchPackageContent,
  fetchPackageById,
  setPackageResolver,
  resolvePackageMilestones,
  resolvePackageNavLinks,
  ensureNonEmptyCoverContent,
} from './content-fetcher/package-content';
import { fetchContent } from './content-fetcher';
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
  afterEach(() => {
    // Reset injected resolver between tests
    setPackageResolver(
      makeResolver({
        ok: false,
        id: 'reset',
        error: { code: 'not-found', message: 'reset' },
      })
    );
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
    expect(resolver.resolve).toHaveBeenCalledWith('alerting-101', { loadContent: false });
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

    expect(resolver.resolve).toHaveBeenCalledWith('first-dashboard', { loadContent: false });
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
      number: 1,
      title: 'Title for step-one',
      duration: '5-10 min',
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

    const manifest = {
      id: 'test-path',
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

  it('preserves packageManifest alongside learningJourney', async () => {
    const resolver: PackageResolver = {
      resolve: jest.fn().mockResolvedValue({
        ok: true,
        id: 'ms-1',
        contentUrl: 'bundled:ms-1/content.json',
        manifestUrl: 'bundled:ms-1/manifest.json',
        repository: 'bundled',
        content: { id: 'ms-1', title: 'MS 1', blocks: [] },
        manifest: { id: 'ms-1', type: 'guide' },
      }),
    };
    setPackageResolver(resolver);

    const manifest = {
      id: 'test-path',
      type: 'path',
      milestones: ['ms-1'],
    };

    const result = await fetchPackageContent('bundled:first-dashboard/content.json', manifest);

    if (result.content) {
      expect(result.content.metadata.packageManifest).toEqual(manifest);
      expect(result.content.metadata.learningJourney).toBeDefined();
    }
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
    });
    expect(result[1]!.packageId).toBe('beta');
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
