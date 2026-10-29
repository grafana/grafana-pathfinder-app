/**
 * Regression coverage for the learning-path member launch (issue #1681).
 *
 * A member opened from inside a path is fetched through `fetchPackageContent`
 * with the *path's* catalogue manifest as `packageInfo`. That manifest is a slim
 * projection and declares no starting location, so attaching it wholesale used
 * to bury the complete manifest the `backend-guide:` loader had produced, and
 * the alignment prompt never appeared.
 */
import { of } from 'rxjs';
import { fetchPackageContent, setPackageResolver, setPackageResolverFactory } from './package-content';
import { resolveSurfaceCompletionIdentity } from '../learning-journey-helpers';
import { guideIdentityAnalyticsProperties, pathAnalytics } from '../../completion-records/completion-identity';
import { resolveStartingLocation } from '../../recovery/starting-location';

const mockFetch = jest.fn();

jest.mock('@grafana/runtime', () => ({
  config: {
    get namespace() {
      return 'stacks-123';
    },
    bootData: { user: {} },
  },
  getBackendSrv: () => ({ fetch: mockFetch }),
}));

jest.mock('../../validation', () => ({
  validateGuide: () => ({ isValid: true, errors: [] }),
}));

/** The path entry as the catalogue proxy returns it: no starting location on the wire. */
const slimCatalogueManifest = {
  id: 'fe-alerting-path',
  type: 'path',
  description: 'Alerting enablement',
};

function backendGuideResource(manifest: Record<string, unknown>) {
  return of({
    data: {
      metadata: { name: 'fe-alerting-01' },
      spec: {
        id: 'fe-alerting-01',
        title: 'Alerting module 1',
        schemaVersion: '1.0',
        blocks: [{ type: 'markdown', content: 'hi' }],
        manifest,
      },
    },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

function usePathResolver(repository: string) {
  setPackageResolver({
    resolve: jest.fn().mockResolvedValue({
      ok: true,
      id: 'path-id',
      contentUrl: 'https://example.test/path/content.json',
      manifestUrl: 'https://example.test/path/manifest.json',
      repository,
      manifest: { tracks: [] },
    }),
  });
}

const pathManifest = { id: 'path-id', type: 'path', milestones: ['member-id'], tracks: [] };
const resolvedMember = {
  id: 'member-id',
  number: 1,
  title: 'Member',
  url: 'backend-guide:member-id',
  isActive: false,
  repository: 'member-source',
  packageManifest: {
    id: 'member-id',
    repository: 'member-source',
    prerequisites: [{ id: 'own', label: 'Member prerequisite' }],
  },
};

describe('member launch keeps the loader manifest reachable', () => {
  it('does not let the slim path manifest bury the loader starting location', async () => {
    mockFetch.mockReturnValue(backendGuideResource({ startingLocation: '/alerting/routes' }));

    const result = await fetchPackageContent('backend-guide:fe-alerting-01', slimCatalogueManifest);

    const merged = result.content?.metadata.packageManifest;
    expect(merged).toBeDefined();
    expect(merged?.startingLocation).toBe('/alerting/routes');
    // The caller's own fields still win where it declares them.
    expect(merged?.id).toBe('fe-alerting-path');
    expect(merged?.type).toBe('path');
  });

  it('resolves the starting location the docs panel then reads', async () => {
    mockFetch.mockReturnValue(backendGuideResource({ startingLocation: '/alerting/routes' }));

    const result = await fetchPackageContent('backend-guide:fe-alerting-01', slimCatalogueManifest);

    // Mirrors the docs panel call: packageInfo first, fetched content second.
    expect(
      resolveStartingLocation('backend-guide:fe-alerting-01', [
        slimCatalogueManifest,
        result.content?.metadata.packageManifest,
      ])
    ).toBe('/alerting/routes');
  });

  it('reads a starting location App Platform left nested under additionalFields', async () => {
    mockFetch.mockReturnValue(
      backendGuideResource({ additionalFields: { startingLocation: '/alerting/notifications' } })
    );

    const result = await fetchPackageContent('backend-guide:fe-alerting-01', slimCatalogueManifest);

    expect(
      resolveStartingLocation('backend-guide:fe-alerting-01', [
        slimCatalogueManifest,
        result.content?.metadata.packageManifest,
      ])
    ).toBe('/alerting/notifications');
  });

  it('preserves prerequisites from catalogue and loaded manifest metadata', async () => {
    const loadedPrerequisites = [{ id: 'loaded', label: 'Loaded requirement' }];
    const cataloguePrerequisites = [{ id: 'catalogue', label: 'Catalogue requirement' }];
    mockFetch.mockReturnValue(backendGuideResource({ prerequisites: loadedPrerequisites }));

    const result = await fetchPackageContent('backend-guide:fe-alerting-01', {
      ...slimCatalogueManifest,
      prerequisites: cataloguePrerequisites,
    });

    expect(result.content?.metadata.packageManifest?.prerequisites).toEqual(cataloguePrerequisites);

    mockFetch.mockReturnValue(backendGuideResource({ prerequisites: loadedPrerequisites }));
    const loadedOnly = await fetchPackageContent('backend-guide:fe-alerting-01');
    expect(loadedOnly.content?.metadata.packageManifest?.prerequisites).toEqual(loadedPrerequisites);
  });

  it('recognizes a legacy URL-only milestone when the caller supplies its explicit guide id', async () => {
    mockFetch.mockReturnValue(backendGuideResource({}));

    const result = await fetchPackageContent(
      'backend-guide:member-id',
      pathManifest,
      [{ ...resolvedMember, id: undefined }],
      undefined,
      undefined,
      'member-id'
    );

    expect(result.content?.metadata.packageManifest).toMatchObject({ id: 'member-id', type: 'guide' });
    expect(result.content?.metadata.journeyManifest).toMatchObject({ id: 'path-id', type: 'path' });
  });

  it('does not let a conflicting milestone URL override an explicit member id', async () => {
    mockFetch.mockReturnValue(backendGuideResource({}));
    const owner = { ...pathManifest, milestones: ['a', 'b'] };
    const milestones = [
      { ...resolvedMember, id: 'a', url: 'backend-guide:b', packageManifest: { id: 'a' } },
      { ...resolvedMember, id: 'b', number: 2, url: 'backend-guide:c', packageManifest: { id: 'b' } },
    ];

    const result = await fetchPackageContent('backend-guide:c', owner, milestones, undefined, undefined, 'b');

    expect(result.content?.metadata.packageManifest?.id).toBe('b');
    expect(result.content?.metadata.journeyManifest).toEqual(owner);
    expect(result.content?.metadata.learningJourney?.currentMilestone).toBe(2);
  });

  it('does not let a conflicting track URL override an explicit member id', async () => {
    mockFetch.mockReturnValue(backendGuideResource({}));
    const owner = {
      ...pathManifest,
      tracks: [{ trackId: 'extra', label: 'Extra', guides: ['a', 'b'] }],
    };
    setPackageResolver({
      resolve: jest.fn().mockImplementation((id: string) =>
        Promise.resolve({
          ok: true,
          id,
          contentUrl: id === 'a' ? 'backend-guide:b' : id === 'b' ? 'backend-guide:c' : `backend-guide:${id}`,
          manifestUrl: `https://example.test/${id}/manifest.json`,
          repository: 'member-source',
          manifest: id === owner.id ? owner : { id, type: 'guide' },
          content: { id, title: id, blocks: [] },
        })
      ),
    });

    const result = await fetchPackageContent('backend-guide:c', owner, [resolvedMember], undefined, undefined, 'b');

    expect(result.content?.metadata.packageManifest?.id).toBe('b');
    expect(result.content?.metadata.journeyManifest).toEqual(owner);
    expect(result.content?.metadata.learningJourney).toBeUndefined();
  });

  it('keeps journey ownership separate from member metadata', async () => {
    mockFetch.mockReturnValue(backendGuideResource({}));
    const owningJourney = { id: 'journey-id', type: 'journey', milestones: ['member-id'] };

    const result = await fetchPackageContent(
      'backend-guide:member-id',
      owningJourney,
      [resolvedMember],
      undefined,
      undefined,
      'member-id'
    );

    expect(result.content?.metadata.packageManifest).toMatchObject({ id: 'member-id', type: 'guide' });
    expect(result.content?.metadata.journeyManifest).toEqual(owningJourney);
  });

  it('attributes private path members without a caller repository', async () => {
    usePathResolver('app-platform');
    mockFetch.mockReturnValue(backendGuideResource({}));
    const owner = { ...pathManifest, repository: 'interactive-tutorials' };
    const result = await fetchPackageContent('backend-guide:member-id', owner, [resolvedMember]);
    const identity = resolveSurfaceCompletionIdentity({
      contentUrl: result.content!.url,
      currentUrl: result.content!.url,
      metadata: result.content!.metadata,
    });
    expect(identity).toMatchObject({
      guideSource: 'app-platform',
      sourceConfirmed: true,
      pathIdentity: { guideSource: 'app-platform', guideId: 'path-id', sourceConfirmed: true },
    });
    expect(
      guideIdentityAnalyticsProperties({ kind: 'guide', ...identity!, guideTitle: result.content!.metadata.title })
    ).toMatchObject({
      guide_source: 'app_platform',
      guide_visibility: 'private',
      guide_id: 'member-id',
      guide_title: 'Alerting module 1',
    });
    expect(pathAnalytics(identity!.pathIdentity)).toEqual({
      properties: { path_id: 'path-id' },
      options: { privatePath: true },
    });
  });

  it('keeps the explicitly supplied path repository as the member completion source', async () => {
    usePathResolver('base-source');
    mockFetch.mockReturnValue(backendGuideResource({}));

    const result = await fetchPackageContent(
      'backend-guide:member-id',
      pathManifest,
      [resolvedMember],
      'explicit-source',
      undefined,
      'member-id'
    );

    expect(result.content?.metadata.repository).toBe('explicit-source');
    expect(result.content?.metadata.packageManifest).toMatchObject({ id: 'member-id', type: 'guide' });
    expect(result.content?.metadata.journeyManifest).toMatchObject({ id: 'path-id', type: 'path' });
    expect(result.content?.metadata.packageManifest?.prerequisites).toEqual([
      { id: 'own', label: 'Member prerequisite' },
    ]);
  });

  it('uses the owning path resolution before a member manifest repository fallback', async () => {
    usePathResolver('base-source');
    mockFetch.mockReturnValue(backendGuideResource({}));

    const result = await fetchPackageContent(
      'backend-guide:member-id',
      pathManifest,
      [resolvedMember],
      undefined,
      undefined,
      'member-id'
    );

    expect(result.content?.metadata.repository).toBe('base-source');
    expect(result.content?.metadata.journeyManifest).toMatchObject({ id: 'path-id', type: 'path' });
    expect(result.content?.metadata.packageManifest?.prerequisites).toEqual([
      { id: 'own', label: 'Member prerequisite' },
    ]);
  });

  describe('confirmed track membership without a member snapshot', () => {
    it.each(['retry', 'declared'] as const)(
      'preserves loaded member metadata and completion ownership for %s membership',
      async (membership) => {
        const owner = {
          ...pathManifest,
          repository: 'owner-source',
          prerequisites: [{ id: 'parent', label: 'Parent prerequisite' }],
          startingLocation: '/owner/start',
          tracks: [{ trackId: 'extra', label: 'Extra', guides: ['fe-alerting-01'] }],
        };
        const memberPrerequisites = [{ id: 'own', label: 'Member prerequisite' }];
        mockFetch.mockReturnValue(
          backendGuideResource({ prerequisites: memberPrerequisites, startingLocation: '/member/start' })
        );
        const resolve = jest.fn().mockImplementation((id: string, options: { bypassCache?: boolean }) => {
          if (id === 'fe-alerting-01' && !options.bypassCache) {
            return Promise.resolve({ ok: false, id, error: { code: 'not-found', message: 'missing metadata' } });
          }
          return Promise.resolve({
            ok: true,
            id,
            contentUrl: `backend-guide:${id}`,
            manifestUrl: `https://example.test/${id}/manifest.json`,
            repository: 'base-source',
            ...(id === owner.id && { manifest: owner }),
          });
        });
        if (membership === 'retry') {
          setPackageResolver({ resolve });
        } else {
          setPackageResolverFactory(() => Promise.reject(new Error('resolver unavailable')));
        }

        const result = await fetchPackageContent(
          'backend-guide:fe-alerting-01',
          owner,
          [resolvedMember],
          undefined,
          undefined,
          membership === 'declared' ? 'fe-alerting-01' : undefined
        );

        expect(result.content?.metadata.packageManifest).toMatchObject({
          id: 'fe-alerting-01',
          type: 'guide',
          prerequisites: memberPrerequisites,
          startingLocation: '/member/start',
        });
        expect(result.content?.metadata.journeyManifest).toEqual(owner);
        expect(result.content?.metadata.learningJourney).toBeUndefined();
        expect(result.content?.metadata.trackMemberBaseUrl).toBe(
          membership === 'retry' ? 'backend-guide:path-id' : 'backend-guide:fe-alerting-01'
        );
        expect(
          resolveStartingLocation('backend-guide:fe-alerting-01', [
            result.content?.metadata.packageManifest,
            result.content?.metadata.journeyManifest,
          ])
        ).toBe('/member/start');
        const source = membership === 'retry' ? 'base-source' : 'app-platform';
        expect(
          resolveSurfaceCompletionIdentity({
            currentUrl: 'backend-guide:fe-alerting-01',
            contentUrl: result.content?.url,
            metadata: result.content?.metadata,
          })
        ).toMatchObject({
          guideId: 'fe-alerting-01',
          guideSource: source,
          pathIdentity: { guideId: 'path-id', guideSource: source },
        });
        if (membership === 'retry') {
          expect(resolve).toHaveBeenCalledTimes(4);
          expect(resolve).toHaveBeenCalledWith('path-id', { loadContent: false });
          expect(resolve).toHaveBeenCalledWith('path-id', { loadContent: 'metadata-only' });
          expect(resolve).toHaveBeenCalledWith('fe-alerting-01', { loadContent: 'metadata-only' });
          expect(resolve).toHaveBeenCalledWith('fe-alerting-01', { loadContent: false, bypassCache: true });
        } else {
          expect(resolve).not.toHaveBeenCalled();
        }
        expect(mockFetch).toHaveBeenCalledTimes(1);
      }
    );

    it.each(['member-id', 'fe-alerting-01'])(
      'keeps declared member %s ownership when no member or Foundations snapshot is available',
      async (guideId) => {
        const owner = {
          ...pathManifest,
          prerequisites: [{ id: 'parent', label: 'Parent prerequisite' }],
          tracks: [{ trackId: 'extra', label: 'Extra', guides: ['fe-alerting-01'] }],
        };
        mockFetch.mockReturnValue(backendGuideResource({}));
        setPackageResolverFactory(() => Promise.reject(new Error('resolver unavailable')));

        const result = await fetchPackageContent(
          `backend-guide:${guideId}`,
          owner,
          undefined,
          'explicit-source',
          undefined,
          guideId
        );

        expect(result.content?.metadata.packageManifest?.type).toBe('guide');
        expect(result.content?.metadata.packageManifest?.prerequisites).toBeUndefined();
        expect(result.content?.metadata.journeyManifest).toEqual(owner);
        expect(result.content?.metadata.repository).toBe('explicit-source');
        expect(mockFetch).toHaveBeenCalledTimes(1);
      }
    );

    it('does not inherit owner prerequisites when the confirmed member declares none', async () => {
      const owner = {
        ...pathManifest,
        prerequisites: [{ id: 'parent', label: 'Parent prerequisite' }],
        startingLocation: '/owner/start',
        tracks: [{ trackId: 'extra', label: 'Extra', guides: ['fe-alerting-01'] }],
      };
      mockFetch.mockReturnValue(backendGuideResource({}));
      setPackageResolverFactory(() => Promise.reject(new Error('resolver unavailable')));

      const result = await fetchPackageContent(
        'backend-guide:fe-alerting-01',
        owner,
        [resolvedMember],
        'explicit-source',
        undefined,
        'fe-alerting-01'
      );

      expect(result.content?.metadata.packageManifest).toMatchObject({ id: 'fe-alerting-01', type: 'guide' });
      expect(result.content?.metadata.packageManifest?.prerequisites).toBeUndefined();
      expect(result.content?.metadata.journeyManifest).toEqual(owner);
      expect(result.content?.metadata.repository).toBe('explicit-source');
      expect(
        resolveStartingLocation('backend-guide:fe-alerting-01', [
          result.content?.metadata.packageManifest,
          result.content?.metadata.journeyManifest,
        ])
      ).toBe('/owner/start');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  it('still resolves to null when no manifest declares one', async () => {
    mockFetch.mockReturnValue(backendGuideResource({}));

    const result = await fetchPackageContent('backend-guide:fe-alerting-01', slimCatalogueManifest);

    expect(
      resolveStartingLocation('backend-guide:fe-alerting-01', [
        slimCatalogueManifest,
        result.content?.metadata.packageManifest,
      ])
    ).toBeNull();
  });
});

describe('a milestone narrows its path starting location', () => {
  const pathManifest = { ...slimCatalogueManifest, startingLocation: '/x-start' };

  it("keeps the milestone's own starting location over the path's", async () => {
    mockFetch.mockReturnValue(backendGuideResource({ startingLocation: '/a-start' }));

    const result = await fetchPackageContent('backend-guide:fe-alerting-01', pathManifest);

    expect(result.content?.metadata.packageManifest?.startingLocation).toBe('/a-start');
    expect(result.content?.metadata.packageManifest?.id).toBe('fe-alerting-path');
  });

  it('keeps a starting location App Platform left under additionalFields over the path one', async () => {
    mockFetch.mockReturnValue(backendGuideResource({ additionalFields: { startingLocation: '/a-start' } }));

    const result = await fetchPackageContent('backend-guide:fe-alerting-01', pathManifest);

    expect(result.content?.metadata.packageManifest?.startingLocation).toBe('/a-start');
  });

  it("falls back to the path's starting location when the milestone declares none", async () => {
    mockFetch.mockReturnValue(backendGuideResource({}));

    const result = await fetchPackageContent('backend-guide:fe-alerting-01', pathManifest);

    expect(result.content?.metadata.packageManifest?.startingLocation).toBe('/x-start');
  });
});

describe('a CDN milestone narrows its path starting location', () => {
  const CDN = 'https://interactive-learning.grafana.net/packages';
  const pathUrl = `${CDN}/x-path/content.json`;
  const aUrl = `${CDN}/a-guide/content.json`;
  const bUrl = `${CDN}/b-guide/content.json`;
  const pathManifest = { id: 'x-path', type: 'path', milestones: ['a-guide', 'b-guide'], startingLocation: '/x-start' };
  const milestones = [
    { id: 'a-guide', number: 1, title: 'A', url: aUrl, isActive: false, startingLocation: '/a-start' },
    { id: 'b-guide', number: 2, title: 'B', url: bUrl, isActive: false },
  ];

  afterEach(() => {
    setPackageResolverFactory(() => Promise.reject(new Error('resolver reset')));
  });

  function cdnContent(url: string) {
    return {
      content: {
        content: '{"id":"guide","title":"Guide","blocks":[]}',
        type: 'interactive' as const,
        url,
        lastFetched: '2026-10-13T00:00:00.000Z',
        metadata: { title: url },
      },
    };
  }

  async function startingLocationFor(url: string, explicitGuideId?: string) {
    const result = await fetchPackageContent(
      url,
      pathManifest,
      milestones,
      undefined,
      cdnContent(url),
      explicitGuideId
    );
    return result.content?.metadata.packageManifest?.startingLocation;
  }

  it("uses the resolved milestone's own starting location when the loader attaches no manifest", async () => {
    expect(await startingLocationFor(aUrl)).toBe('/a-start');
    expect(await startingLocationFor(aUrl, 'a-guide')).toBe('/a-start');
  });

  it('leaves a milestone that declares none without a starting location of its own', async () => {
    expect(await startingLocationFor(bUrl, 'b-guide')).toBeUndefined();
  });

  it("keeps the path's starting location on its own landing page", async () => {
    expect(await startingLocationFor(pathUrl)).toBe('/x-start');
  });

  it("uses a track-only guide's own starting location over the path's", async () => {
    const tUrl = `${CDN}/t-guide/content.json`;
    setPackageResolver({
      resolve: async (id: string) =>
        id === 't-guide'
          ? {
              ok: true,
              id,
              contentUrl: tUrl,
              manifestUrl: '',
              repository: 'cdn',
              manifest: { startingLocation: '/t-start' },
            }
          : { ok: false, id, error: { code: 'not-found', message: 'not found' } },
    } as never);
    const trackedPath = {
      ...pathManifest,
      tracks: [{ trackId: 'deep-dive', label: 'Deep dive', guides: ['t-guide'] }],
    };

    const result = await fetchPackageContent(tUrl, trackedPath, milestones, undefined, cdnContent(tUrl), 't-guide');

    expect(result.content?.metadata.packageManifest?.startingLocation).toBe('/t-start');
  });
});
