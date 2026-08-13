import { of, throwError } from 'rxjs';
import { AppPlatformPackageResolver } from './app-platform-resolver';

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

  it('maps a 403 (no read permission) to the same not-found result as a 404', async () => {
    mockFetch.mockReturnValue(throwError(() => ({ status: 403 })));
    const resolver = new AppPlatformPackageResolver();

    const result = await resolver.resolve('forbidden-guide', { loadContent: false, verifyPublished: true });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('not-found');
    expect(result.repository).toBe('app-platform');
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

  it('does not let a persisted spec.manifest.id override the resolved packageId', async () => {
    mockFetch.mockReturnValue(of(okResource({ manifest: { type: 'guide', id: 'some-other-id' } })));
    const resolver = new AppPlatformPackageResolver();

    const result = await resolver.resolve('fe-alerting-01', { loadContent: 'metadata-only' });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.manifest?.id).toBe('fe-alerting-01');
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
