import { of, throwError } from 'rxjs';
import { AppPlatformPackageResolver } from './app-platform-resolver';
import { resolveStartingLocation } from '../recovery/starting-location';
import type { ManifestJson } from '../types/package.types';

/** `PackageOpenInfo.packageManifest` is an untyped record; widen at the same seam the panel does. */
const asPanelManifest = (manifest?: ManifestJson): Record<string, unknown> | undefined =>
  manifest as Record<string, unknown> | undefined;

let mockNamespace: string | undefined = 'stacks-123';
let mockFeatureToggles: Record<string, boolean> = { 'aggregation.pathfinderbackend-ext-grafana-app.enabled': true };
const mockFetch = jest.fn();

jest.mock('@grafana/runtime', () => ({
  config: {
    get namespace() {
      return mockNamespace;
    },
    get featureToggles() {
      return mockFeatureToggles;
    },
  },
  getBackendSrv: () => ({ fetch: mockFetch }),
}));

const okResource = (overrides: Record<string, unknown> = {}) => ({
  data: {
    metadata: { name: 'fe-alerting-01' },
    spec: {
      id: 'fe-alerting-01',
      title: 'Alerting module 1',
      schemaVersion: '1.0',
      status: 'published',
      blocks: [{ type: 'markdown', content: 'hi' }],
      ...overrides,
    },
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockNamespace = 'stacks-123';
  mockFeatureToggles = { 'aggregation.pathfinderbackend-ext-grafana-app.enabled': true };
});

describe('AppPlatformPackageResolver — no loadContent', () => {
  it('resolves URLs without hitting the backend', async () => {
    const resolver = new AppPlatformPackageResolver();
    const result = await resolver.resolve('fe-alerting-01');

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.contentUrl).toBe('backend-guide:fe-alerting-01');
    expect(result.repository).toBe('app-platform');
    expect(result.manifest).toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fails when no namespace is available', async () => {
    mockNamespace = undefined;
    const resolver = new AppPlatformPackageResolver();
    const result = await resolver.resolve('fe-alerting-01');

    expect(result.ok).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
    // Untagged: composite-resolver.ts keys cache eviction on `repository`, so a
    // tag here would repeal negative caching for every tier.
    expect(result.repository).toBeUndefined();
  });

  it('declines (not-found) when the GAP aggregation toggle is off', async () => {
    mockFeatureToggles = {};
    const resolver = new AppPlatformPackageResolver();
    const result = await resolver.resolve('fe-alerting-01', { loadContent: true });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('not-found');
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.repository).toBeUndefined();
  });
});

describe('AppPlatformPackageResolver — verifyPublished (URL-only probe, #1561)', () => {
  it('fails a draft guide instead of silently succeeding, tagged for cache eviction', async () => {
    mockFetch.mockReturnValue(of(okResource({ status: 'draft' })));
    const resolver = new AppPlatformPackageResolver();

    const result = await resolver.resolve('fe-alerting-01', { loadContent: false, verifyPublished: true });

    expect(mockFetch).toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('not-found');
    // Repository-tagged (attemptedFailure), not decline — composite-resolver's
    // cache eviction keys on `repository`, so an untagged failure here would
    // stay cache-locked as missing even after the guide is published.
    expect(result.repository).toBe('app-platform');
  });

  it('fails a nonexistent guide the same way (404)', async () => {
    mockFetch.mockReturnValue(throwError(() => ({ status: 404 })));
    const resolver = new AppPlatformPackageResolver();

    const result = await resolver.resolve('missing-guide', { loadContent: false, verifyPublished: true });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('not-found');
    expect(result.repository).toBe('app-platform');
  });

  // Kept distinct from not-found on purpose: this GET runs in the caller's own
  // browser under their own session, so collapsing it conceals nothing they
  // haven't already seen, and it would show a revoked or expired session a
  // "not found" with a retry that can never succeed.
  it('keeps a 403 (no read permission) distinct from not-found', async () => {
    mockFetch.mockReturnValue(throwError(() => ({ status: 403 })));
    const resolver = new AppPlatformPackageResolver();

    const result = await resolver.resolve('forbidden-guide', { loadContent: false, verifyPublished: true });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('permission-denied');
    expect(result.repository).toBe('app-platform');
  });

  // A previously infallible URL-only path is now fallible: anything that isn't
  // a 404 or 403 must still tag the repository so the failure is evicted.
  it('reports a transport failure as network-error, still repository-tagged', async () => {
    mockFetch.mockReturnValue(throwError(() => new Error('connection reset')));
    const resolver = new AppPlatformPackageResolver();

    const result = await resolver.resolve('flaky-guide', { loadContent: false, verifyPublished: true });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('network-error');
    expect(result.error.message).toContain('connection reset');
    expect(result.repository).toBe('app-platform');
  });

  it('reports not-found when the resource carries no spec', async () => {
    mockFetch.mockReturnValue(of({ data: { metadata: { name: 'spec-less' } } }));
    const resolver = new AppPlatformPackageResolver();

    const result = await resolver.resolve('spec-less', { loadContent: false, verifyPublished: true });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('not-found');
  });

  it('still resolves successfully for a published guide (no regression)', async () => {
    mockFetch.mockReturnValue(of(okResource()));
    const resolver = new AppPlatformPackageResolver();

    const result = await resolver.resolve('fe-alerting-01', { loadContent: false, verifyPublished: true });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.contentUrl).toBe('backend-guide:fe-alerting-01');
    // URL-only mode still doesn't populate content/manifest, even when verified.
    expect(result.content).toBeUndefined();
    expect(result.manifest).toBeUndefined();
  });

  it('does not probe when verifyPublished is absent (baseUrl hydration hot path stays cheap)', async () => {
    const resolver = new AppPlatformPackageResolver();

    const result = await resolver.resolve('fe-alerting-01', { loadContent: false });

    expect(result.ok).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('AppPlatformPackageResolver — metadata-only', () => {
  it('returns the persisted manifest without fetching content', async () => {
    mockFetch.mockReturnValue(
      of(
        okResource({
          manifest: {
            type: 'path',
            repository: 'app-platform',
            milestones: ['fe-alerting-01', 'fe-alerting-02'],
            description: 'Six private guides',
          },
        })
      )
    );

    const resolver = new AppPlatformPackageResolver();
    const result = await resolver.resolve('fe-alerting-path', { loadContent: 'metadata-only' });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.content).toBeUndefined();
    expect(result.manifest?.type).toBe('path');
    expect(result.manifest?.milestones).toEqual(['fe-alerting-01', 'fe-alerting-02']);
  });

  it('infers a guide manifest and maps title into description when spec.manifest is absent (§6.5, Appendix A3)', async () => {
    mockFetch.mockReturnValue(of(okResource()));

    const resolver = new AppPlatformPackageResolver();
    const result = await resolver.resolve('fe-alerting-01', { loadContent: 'metadata-only' });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.manifest).toEqual({
      id: 'fe-alerting-01',
      type: 'guide',
      repository: 'app-platform',
      description: 'Alerting module 1',
    });
  });

  it('prefers spec.id over the resolve() input in the inferred (no spec.manifest) branch too', async () => {
    mockFetch.mockReturnValue(of(okResource({ id: 'renamed-guide-id' })));

    const resolver = new AppPlatformPackageResolver();
    const result = await resolver.resolve('legacy-resource-name', { loadContent: 'metadata-only' });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.manifest?.id).toBe('renamed-guide-id');
  });

  // The loader in docs-retrieval synthesizes a manifest for the same resource shape. If only one of
  // the two filled in a description, a reader would see a different shape depending on which entry
  // point opened the guide.
  it('maps title into description for a PERSISTED manifest that carries none', async () => {
    mockFetch.mockReturnValue(of(okResource({ manifest: { type: 'path', milestones: ['m1'] } })));

    const resolver = new AppPlatformPackageResolver();
    const result = await resolver.resolve('fe-alerting-01', { loadContent: 'metadata-only' });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.manifest?.description).toBe('Alerting module 1');
    expect(result.manifest?.type).toBe('path');
  });

  it('leaves a persisted description alone rather than overwriting it with the title', async () => {
    mockFetch.mockReturnValue(of(okResource({ manifest: { type: 'guide', description: 'Authored summary' } })));

    const resolver = new AppPlatformPackageResolver();
    const result = await resolver.resolve('fe-alerting-01', { loadContent: 'metadata-only' });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.manifest?.description).toBe('Authored summary');
  });

  it('round-trips a stamped stats object off a persisted manifest', async () => {
    const stats = {
      version: 1,
      blockCount: 4,
      sectionCount: 1,
      completableBlockCount: 2,
      finalCompletablePosition: 4,
    };
    mockFetch.mockReturnValue(of(okResource({ manifest: { type: 'guide', stats } })));

    const resolver = new AppPlatformPackageResolver();
    const result = await resolver.resolve('fe-alerting-01', { loadContent: 'metadata-only' });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.manifest?.stats).toEqual(stats);
  });

  // ManifestJsonObjectSchema defaults `startingLocation` to '/', and
  // resolveStartingLocation reads the typed field before additionalFields — so a
  // materialised default would shadow the authored value and prompt for the root.
  it('does not let the schema default shadow additionalFields.startingLocation', async () => {
    mockFetch.mockReturnValue(
      of(okResource({ manifest: { type: 'guide', additionalFields: { startingLocation: '/alerting' } } }))
    );

    const resolver = new AppPlatformPackageResolver();
    const result = await resolver.resolve('fe-alerting-01', { loadContent: 'metadata-only' });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.manifest).not.toHaveProperty('startingLocation');
    expect(resolveStartingLocation('app-platform:stacks-123/fe-alerting-01', asPanelManifest(result.manifest))).toBe(
      '/alerting'
    );
  });

  it('keeps a startingLocation the persisted manifest genuinely declares', async () => {
    mockFetch.mockReturnValue(
      of(
        okResource({
          manifest: {
            type: 'guide',
            startingLocation: '/dashboards',
            additionalFields: { startingLocation: '/alerting' },
          },
        })
      )
    );

    const resolver = new AppPlatformPackageResolver();
    const result = await resolver.resolve('fe-alerting-01', { loadContent: 'metadata-only' });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.manifest?.startingLocation).toBe('/dashboards');
    expect(resolveStartingLocation('app-platform:stacks-123/fe-alerting-01', asPanelManifest(result.manifest))).toBe(
      '/dashboards'
    );
  });

  it('returns not-found on 404 without throwing', async () => {
    mockFetch.mockReturnValue(throwError(() => ({ status: 404 })));

    const resolver = new AppPlatformPackageResolver();
    const result = await resolver.resolve('missing-guide', { loadContent: 'metadata-only' });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('not-found');
  });
});

describe('AppPlatformPackageResolver — full content', () => {
  it('populates both content and manifest', async () => {
    mockFetch.mockReturnValue(of(okResource()));

    const resolver = new AppPlatformPackageResolver();
    const result = await resolver.resolve('fe-alerting-01', { loadContent: true });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.content?.title).toBe('Alerting module 1');
    expect(result.content?.blocks).toHaveLength(1);
    expect(result.manifest?.type).toBe('guide');
  });

  it('SECURITY: encodes the package ID in the request URL (F3 path traversal)', async () => {
    mockFetch.mockReturnValue(of(okResource()));
    const resolver = new AppPlatformPackageResolver();

    await resolver.resolve('../../etc/passwd', { loadContent: true });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringContaining(encodeURIComponent('../../etc/passwd')) })
    );
    const calledUrl = mockFetch.mock.calls[0][0].url as string;
    expect(calledUrl).not.toContain('../../etc/passwd');
  });

  it('fails validation when blocks or title are missing', async () => {
    mockFetch.mockReturnValue(
      of({ data: { metadata: { name: 'x' }, spec: { status: 'published', title: 'No blocks' } } })
    );
    const resolver = new AppPlatformPackageResolver();

    const result = await resolver.resolve('x', { loadContent: true });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('validation-error');
  });

  it('resolves not-found for a non-published (draft) guide', async () => {
    mockFetch.mockReturnValue(of(okResource({ status: 'draft' })));
    const resolver = new AppPlatformPackageResolver();

    const result = await resolver.resolve('fe-alerting-01', { loadContent: 'metadata-only' });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('not-found');
  });

  it("does not let a persisted spec.manifest.id override the resource's own declared identity", async () => {
    mockFetch.mockReturnValue(of(okResource({ manifest: { type: 'guide', id: 'some-other-id' } })));
    const resolver = new AppPlatformPackageResolver();

    const result = await resolver.resolve('fe-alerting-01', { loadContent: 'metadata-only' });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.manifest?.id).toBe('fe-alerting-01');
  });

  it('prefers spec.id over the resolve() input when a guide was renamed after its resource name was set', async () => {
    // packageId ('legacy-resource-name') is the immutable k8s resource name a
    // guide was created under; spec.id ('renamed-guide-id') is the author's
    // current, editable guide id. buildLoaderManifest (docs-retrieval's
    // backend-guide.ts) has always preferred spec.id for this same resource
    // shape — this pins the two builders agreeing, so completion identity
    // doesn't drift depending on which one happened to run.
    mockFetch.mockReturnValue(of(okResource({ id: 'renamed-guide-id', manifest: { type: 'guide' } })));
    const resolver = new AppPlatformPackageResolver();

    const result = await resolver.resolve('legacy-resource-name', { loadContent: 'metadata-only' });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.manifest?.id).toBe('renamed-guide-id');
  });

  it('falls back to the resolve() input when the resource carries no spec.id of its own', async () => {
    mockFetch.mockReturnValue(of(okResource({ id: undefined, manifest: { type: 'guide' } })));
    const resolver = new AppPlatformPackageResolver();

    const result = await resolver.resolve('fe-alerting-01', { loadContent: 'metadata-only' });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.manifest?.id).toBe('fe-alerting-01');
  });

  it('keeps the resolve() input as id for a path/journey manifest, even when spec.id has drifted', async () => {
    // A path/journey's id must stay resource-name-equal: fetchPackageContent's
    // baseUrl-hydration re-resolves it in URL-only mode, which never verifies
    // — it only string-templates `backend-guide:<id>` — on the documented
    // assumption that the id is "already known-good" (fetchPackageById's own
    // comment). A drifted spec.id would silently produce an unfetchable URL.
    // This is the one case where a plain guide's spec.id preference does not
    // apply (Cursor Bugbot flagged this on the guide-preference commit).
    mockFetch.mockReturnValue(
      of(okResource({ id: 'renamed-path-id', manifest: { type: 'path', milestones: ['m1'] } }))
    );
    const resolver = new AppPlatformPackageResolver();

    const result = await resolver.resolve('legacy-resource-name', { loadContent: 'metadata-only' });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.manifest?.id).toBe('legacy-resource-name');
  });

  it('keeps the resolve() input as id for a journey manifest too', async () => {
    mockFetch.mockReturnValue(of(okResource({ id: 'renamed-journey-id', manifest: { type: 'journey' } })));
    const resolver = new AppPlatformPackageResolver();

    const result = await resolver.resolve('legacy-resource-name', { loadContent: 'metadata-only' });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.manifest?.id).toBe('legacy-resource-name');
  });

  it('overwrites a persisted spec.manifest.repository pointing at the public CDN', async () => {
    mockFetch.mockReturnValue(of(okResource({ manifest: { type: 'guide', repository: 'interactive-tutorials' } })));
    const resolver = new AppPlatformPackageResolver();

    const result = await resolver.resolve('fe-alerting-01', { loadContent: 'metadata-only' });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // `repository` is the sole input to the durable completion key (guideSource),
    // so a stale CDN value would mislabel a private guide's provenance.
    expect(result.manifest?.repository).toBe('app-platform');
  });

  it('tags failures with the app-platform repository so the composite resolver can skip caching them', async () => {
    mockFetch.mockReturnValue(throwError(() => ({ status: 404 })));
    const resolver = new AppPlatformPackageResolver();

    const result = await resolver.resolve('missing', { loadContent: 'metadata-only' });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.repository).toBe('app-platform');
  });
});
