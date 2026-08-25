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
import { fetchPackageContent } from './package-content';
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
