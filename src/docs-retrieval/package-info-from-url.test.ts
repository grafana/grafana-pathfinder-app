import { getPackageResolver } from './content-fetcher/package-resolver-registry';
import type { PackageResolver, PackageResolution } from '../types';

jest.mock('./content-fetcher/package-resolver-registry', () => ({
  getPackageResolver: jest.fn(),
}));

// Imported after the mock so the module under test picks up the mocked registry.
import { fetchPackageInfoFromUrl, isPackageContentUrl } from './package-info-from-url';

const mockedGetPackageResolver = getPackageResolver as jest.MockedFunction<typeof getPackageResolver>;

function makeResolver(resolution: PackageResolution): PackageResolver {
  return {
    resolve: jest.fn().mockResolvedValue(resolution),
  };
}

beforeEach(() => {
  mockedGetPackageResolver.mockReset();
});

describe('isPackageContentUrl', () => {
  it('matches interactive-learning package content URLs', () => {
    expect(isPackageContentUrl('https://interactive-learning.grafana.net/packages/foo/content.json')).toBe(true);
  });

  it('matches backend-guide: URLs with a non-empty id', () => {
    expect(isPackageContentUrl('backend-guide:grafana-foundations-lp')).toBe(true);
  });

  it('rejects a bare backend-guide: prefix with no id', () => {
    expect(isPackageContentUrl('backend-guide:')).toBe(false);
    expect(isPackageContentUrl('backend-guide:   ')).toBe(false);
  });

  it('rejects unrelated URLs', () => {
    expect(isPackageContentUrl('https://example.com/docs/foo')).toBe(false);
    expect(isPackageContentUrl('api:some-id')).toBe(false);
  });
});

describe('fetchPackageInfoFromUrl — backend-guide: scheme', () => {
  it('resolves packageInfo via the shared PackageResolver, metadata-only', async () => {
    const resolution: PackageResolution = {
      ok: true,
      id: 'grafana-foundations-lp',
      contentUrl: 'backend-guide:grafana-foundations-lp',
      manifestUrl: 'app-platform:default/grafana-foundations-lp',
      repository: 'app-platform',
      manifest: { id: 'grafana-foundations-lp', type: 'path', repository: 'app-platform' } as any,
    };
    const resolver = makeResolver(resolution);
    mockedGetPackageResolver.mockResolvedValue(resolver);

    const info = await fetchPackageInfoFromUrl('backend-guide:grafana-foundations-lp');

    expect(resolver.resolve).toHaveBeenCalledWith('grafana-foundations-lp', { loadContent: 'metadata-only' });
    expect(info).toEqual({
      packageId: 'grafana-foundations-lp',
      packageManifest: { id: 'grafana-foundations-lp', type: 'path', repository: 'app-platform' },
      repository: 'app-platform',
    });
  });

  it('returns undefined when the resolver declines (not found / not published)', async () => {
    mockedGetPackageResolver.mockResolvedValue(
      makeResolver({ ok: false, id: 'missing', error: { code: 'not-found', message: 'nope' } })
    );

    const info = await fetchPackageInfoFromUrl('backend-guide:missing');

    expect(info).toBeUndefined();
  });

  it('returns undefined when no resolver is configured', async () => {
    mockedGetPackageResolver.mockResolvedValue(undefined);

    const info = await fetchPackageInfoFromUrl('backend-guide:whatever');

    expect(info).toBeUndefined();
  });

  it('returns undefined for a bare backend-guide: URL with no id, without calling the resolver', async () => {
    const resolver = makeResolver({ ok: false, id: '', error: { code: 'not-found', message: '' } });
    mockedGetPackageResolver.mockResolvedValue(resolver);

    const info = await fetchPackageInfoFromUrl('backend-guide:');

    expect(info).toBeUndefined();
    expect(resolver.resolve).not.toHaveBeenCalled();
  });
});
