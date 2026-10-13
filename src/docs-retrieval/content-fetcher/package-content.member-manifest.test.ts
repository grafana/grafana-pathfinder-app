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
import { fetchPackageContent, setPackageResolver } from './package-content';
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

  it("falls back to the path's starting location for a milestone that declares none", async () => {
    expect(await startingLocationFor(bUrl, 'b-guide')).toBe('/x-start');
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
