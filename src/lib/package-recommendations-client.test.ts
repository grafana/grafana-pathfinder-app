jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(),
}));

import { getBackendSrv } from '@grafana/runtime';

import {
  __resetPackageRecommendationsClientForTests,
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
