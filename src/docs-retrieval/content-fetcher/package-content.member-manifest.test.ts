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
