import { beginGuideLoad, finishGuideLoad } from '../lib/telemetry/guide-load';
import { recordGuideRender } from '../lib/telemetry/facade';
import { getPackageResolver } from './content-fetcher/package-resolver-registry';
import type { PackageResolver, PackageResolution } from '../types';

jest.mock('../lib/telemetry/facade', () => ({
  ...jest.requireActual('../lib/telemetry/facade'),
  recordGuideRender: jest.fn(),
}));

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

it.each(['not-supported', 42, { type: 'markdown' }])(
  'keeps malformed prerequisite format %p as literal metadata from CDN manifests',
  async (format) => {
    const url = 'https://interactive-learning.grafana.net/packages/example/content.json';
    const prerequisites = [{ id: 'runtime-format', label: '[Read docs](https://example.com)', format }];
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'example', type: 'guide', prerequisites }),
    });

    try {
      const info = await fetchPackageInfoFromUrl(url);

      expect(info?.packageManifest?.prerequisites).toEqual([
        { id: 'runtime-format', label: '[Read docs](https://example.com)' },
      ]);
    } finally {
      global.fetch = originalFetch;
    }
  }
);

it('preserves direct-URL path navigation metadata, exact strings, order, and supported markdown', async () => {
  const manifest = {
    id: 'test-path',
    type: 'path',
    milestones: ['first', 'second'],
    tracks: [{ trackId: 'extra', label: 'Extra', guides: ['track-guide'] }],
    prerequisites: [
      { id: ' literal ', label: ' <b>Literal</b> ', format: 42 },
      { id: 'markdown', label: '**Markdown**', format: 'markdown' },
      { id: 'plain', label: 'Plain' },
    ],
  };
  const originalFetch = global.fetch;
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(manifest) });
  global.fetch = fetchMock;
  try {
    const info = await fetchPackageInfoFromUrl('https://interactive-learning.grafana.net/packages/test-path/content.json');

    expect(info?.packageManifest).toMatchObject({
      ...manifest,
      prerequisites: [
        { id: ' literal ', label: ' <b>Literal</b> ' },
        { id: 'markdown', label: '**Markdown**', format: 'markdown' },
        { id: 'plain', label: 'Plain' },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://interactive-learning.grafana.net/packages/test-path/manifest.json',
      expect.objectContaining({ method: 'GET' })
    );
  } finally {
    global.fetch = originalFetch;
  }
});

it('keeps an optional manifest failure non-terminal so content can still render', async () => {
  const url = 'https://interactive-learning.grafana.net/packages/example/content.json';
  const context = beginGuideLoad(url);
  const originalFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });
  jest.mocked(recordGuideRender).mockClear();
  try {
    expect(await fetchPackageInfoFromUrl(url, context)).toBeUndefined();
    expect(recordGuideRender).toHaveBeenCalledWith(context, 'degraded', expect.any(Number), {
      source: 'cdn',
      stage: 'fetch',
      reason: 'http-error',
      statusCode: 404,
    });
    finishGuideLoad(context, 'rendered');
    expect(recordGuideRender).toHaveBeenLastCalledWith(context, 'rendered', expect.any(Number), undefined);
    expect(recordGuideRender).toHaveBeenCalledTimes(2);
  } finally {
    finishGuideLoad(context, 'cancelled');
    global.fetch = originalFetch;
  }
});
