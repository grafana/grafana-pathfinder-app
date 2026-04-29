jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(),
}));

import { getBackendSrv } from '@grafana/runtime';

import {
  __resetPackageRecommendationsClientForTests,
  buildPackageFileUrl,
  fetchOnlinePackageRecommendations,
} from './package-recommendations-client';

const mockGet = jest.fn();

const samplePayload = {
  baseUrl: 'https://interactive-learning.grafana.net/packages/',
  packages: [
    {
      id: 'prom-101',
      path: 'prom-101/v1.0.0',
      title: 'Prometheus 101',
      targeting: { match: { urlPrefix: '/connections' } },
    },
  ],
};

let originalOnLine: PropertyDescriptor | undefined;

beforeAll(() => {
  originalOnLine = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
});

afterAll(() => {
  if (originalOnLine) {
    Object.defineProperty(window.navigator, 'onLine', originalOnLine);
  }
});

function setOnline(value: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetPackageRecommendationsClientForTests();
  setOnline(true);
  (getBackendSrv as jest.Mock).mockReturnValue({ get: mockGet });
});

describe('fetchOnlinePackageRecommendations', () => {
  it('returns empty packages when offline without contacting backend', async () => {
    setOnline(false);

    const result = await fetchOnlinePackageRecommendations();

    expect(result.packages).toEqual([]);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('hits the package-recommendations resource endpoint', async () => {
    mockGet.mockResolvedValue(samplePayload);

    const result = await fetchOnlinePackageRecommendations();

    expect(mockGet).toHaveBeenCalledWith(
      '/api/plugins/grafana-pathfinder-app/resources/package-recommendations',
      undefined,
      undefined,
      expect.objectContaining({ showErrorAlert: false })
    );
    expect(result.packages).toHaveLength(1);
    expect(result.packages[0]?.id).toBe('prom-101');
  });

  it('caches the response across calls', async () => {
    mockGet.mockResolvedValue(samplePayload);

    await fetchOnlinePackageRecommendations();
    await fetchOnlinePackageRecommendations();
    await fetchOnlinePackageRecommendations();

    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent in-flight requests', async () => {
    let resolveFetch!: (value: typeof samplePayload) => void;
    mockGet.mockImplementation(
      () =>
        new Promise<typeof samplePayload>((resolve) => {
          resolveFetch = resolve;
        })
    );

    const a = fetchOnlinePackageRecommendations();
    const b = fetchOnlinePackageRecommendations();
    const c = fetchOnlinePackageRecommendations();

    resolveFetch(samplePayload);
    await Promise.all([a, b, c]);

    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('goes sticky-unavailable on first failure and stops calling backend', async () => {
    mockGet.mockRejectedValue(new Error('boom'));

    const first = await fetchOnlinePackageRecommendations();
    const second = await fetchOnlinePackageRecommendations();
    const third = await fetchOnlinePackageRecommendations();

    expect(first.packages).toEqual([]);
    expect(second.packages).toEqual([]);
    expect(third.packages).toEqual([]);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('treats malformed responses as unavailable', async () => {
    mockGet.mockResolvedValue({ baseUrl: 'x' }); // packages missing

    const first = await fetchOnlinePackageRecommendations();
    const second = await fetchOnlinePackageRecommendations();

    expect(first.packages).toEqual([]);
    expect(second.packages).toEqual([]);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it("clears sticky-unavailable when window emits 'online'", async () => {
    mockGet.mockRejectedValueOnce(new Error('boom'));

    await fetchOnlinePackageRecommendations(); // sticky-unavailable now
    expect(mockGet).toHaveBeenCalledTimes(1);

    // Calling again does NOT re-fetch.
    await fetchOnlinePackageRecommendations();
    expect(mockGet).toHaveBeenCalledTimes(1);

    // Simulate connectivity returning.
    mockGet.mockResolvedValueOnce(samplePayload);
    window.dispatchEvent(new Event('online'));

    const result = await fetchOnlinePackageRecommendations();

    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(result.packages[0]?.id).toBe('prom-101');
  });

  it('does not flip unavailable when offline (recovery is still possible)', async () => {
    setOnline(false);
    await fetchOnlinePackageRecommendations();

    setOnline(true);
    mockGet.mockResolvedValue(samplePayload);
    const result = await fetchOnlinePackageRecommendations();

    expect(result.packages).toHaveLength(1);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});

describe('buildPackageFileUrl', () => {
  it('joins base, path, and filename with a single slash', () => {
    expect(buildPackageFileUrl('https://x.example/packages/', 'prom-101/v1', 'content.json')).toBe(
      'https://x.example/packages/prom-101/v1/content.json'
    );
  });

  it('normalizes a missing trailing slash on the base', () => {
    expect(buildPackageFileUrl('https://x.example/packages', 'prom-101/v1', 'manifest.json')).toBe(
      'https://x.example/packages/prom-101/v1/manifest.json'
    );
  });

  it('strips leading and trailing slashes from the entry path', () => {
    expect(buildPackageFileUrl('https://x.example/packages/', '/foo/', 'content.json')).toBe(
      'https://x.example/packages/foo/content.json'
    );
    expect(buildPackageFileUrl('https://x.example/packages/', '/foo/bar/', 'content.json')).toBe(
      'https://x.example/packages/foo/bar/content.json'
    );
  });

  it('never produces double slashes between path and filename', () => {
    expect(buildPackageFileUrl('https://x.example/packages/', 'foo', 'content.json')).not.toContain('//content.json');
  });

  it('fails closed on empty inputs', () => {
    expect(buildPackageFileUrl('', 'foo', 'content.json')).toBe('');
    expect(buildPackageFileUrl('https://x.example/packages/', '', 'content.json')).toBe('');
    expect(buildPackageFileUrl('https://x.example/packages/', 'foo', '')).toBe('');
  });

  it('fails closed when the base trims to empty (e.g. all-slashes input)', () => {
    // Regression: previously `buildCdnUrl` truthy-checked the raw baseUrl,
    // letting `'///'` through and producing a broken relative URL like
    // `/foo/manifest.json`.
    expect(buildPackageFileUrl('///', 'foo', 'manifest.json')).toBe('');
    expect(buildPackageFileUrl('/', 'foo', 'manifest.json')).toBe('');
  });

  it('fails closed when the entry path is only slashes', () => {
    // Regression: previously `buildFileUrl` skipped the path check entirely,
    // producing `https://.../packages//content.json`.
    expect(buildPackageFileUrl('https://x.example/packages/', '///', 'content.json')).toBe('');
  });
});
