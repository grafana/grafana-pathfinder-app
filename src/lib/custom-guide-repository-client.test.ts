jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(),
}));

let mockAvailable = true;
jest.mock('../utils/fetchBackendGuides', () => ({
  isBackendApiAvailable: () => mockAvailable,
}));

jest.mock('./telemetry/facade', () => ({
  recordCustomGuideCatalogueUnavailable: jest.fn(),
}));

jest.mock('./logging', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), exception: jest.fn() },
}));

import { getBackendSrv } from '@grafana/runtime';
import { fetchCustomGuideRepository, invalidateCustomGuideRepositoryCache } from './custom-guide-repository-client';
import { logger } from './logging';
import { recordCustomGuideCatalogueUnavailable } from './telemetry/facade';

const mockGet = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockAvailable = true;
  invalidateCustomGuideRepositoryCache();
  (getBackendSrv as jest.Mock).mockReturnValue({ get: mockGet });
});

describe('fetchCustomGuideRepository', () => {
  it('returns the guides array on success', async () => {
    mockGet.mockResolvedValue({
      capability: { available: true },
      guides: [
        { id: 'fe-alerting-path', title: 'Alerting enablement', status: 'published', manifest: { type: 'path' } },
      ],
      asOf: '2026-07-23T00:00:00Z',
    });

    const result = await fetchCustomGuideRepository('stacks-123');

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('fe-alerting-path');
    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/custom-guide-repository'), undefined, undefined, {
      showErrorAlert: false,
      showSuccessAlert: false,
    });
  });

  it("stamps repository: 'app-platform' on each manifest even when the response omits it", async () => {
    mockGet.mockResolvedValue({
      capability: { available: true },
      // The CR manifest leaves repository omitempty; one entry even carries the
      // stale CDN default. Both must come back tagged app-platform so the launch
      // packageInfo does not fabricate a public websiteUrl / mislabel completion.
      guides: [
        { id: 'fe-alerting-path', title: 'Alerting', status: 'published', manifest: { type: 'path' } },
        {
          id: 'fe-guide',
          title: 'Guide',
          status: 'published',
          manifest: { type: 'guide', repository: 'interactive-tutorials' },
        },
      ],
    });

    const result = await fetchCustomGuideRepository('stacks-123');

    expect(result[0]!.manifest?.repository).toBe('app-platform');
    expect(result[1]!.manifest?.repository).toBe('app-platform');
  });

  it('normalizes before caching, so a cached read is stamped too', async () => {
    mockGet.mockResolvedValue({
      capability: { available: true },
      guides: [{ id: 'fe-alerting-path', status: 'published', manifest: { type: 'path' } }],
    });

    await fetchCustomGuideRepository('stacks-123');
    const cached = await fetchCustomGuideRepository('stacks-123');

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(cached[0]!.manifest?.repository).toBe('app-platform');
  });

  it('returns an empty array when the proxy reports itself unavailable', async () => {
    mockGet.mockResolvedValue({
      capability: { available: false, reason: 'backend-unavailable' },
      guides: [],
    });

    const result = await fetchCustomGuideRepository('stacks-123');

    expect(result).toEqual([]);
    expect(recordCustomGuideCatalogueUnavailable).toHaveBeenCalledWith('backend-unavailable');
  });

  it('returns an empty array when the backend API is unavailable, without fetching', async () => {
    mockAvailable = false;

    const result = await fetchCustomGuideRepository('stacks-123');

    expect(result).toEqual([]);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('returns an empty array when no namespace is provided', async () => {
    const result = await fetchCustomGuideRepository('');

    expect(result).toEqual([]);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('returns an empty array when the response is malformed', async () => {
    mockGet.mockResolvedValue({ capability: { available: true } });

    const result = await fetchCustomGuideRepository('stacks-123');

    expect(result).toEqual([]);
  });

  it('records an http-<status> reason when the request rejects with a status', async () => {
    mockGet.mockRejectedValue({ status: 503, statusText: 'Service Unavailable', message: 'upstream drain failed' });

    const result = await fetchCustomGuideRepository('stacks-123');

    expect(result).toEqual([]);
    expect(recordCustomGuideCatalogueUnavailable).toHaveBeenCalledWith('http-503');
    expect(logger.warn).toHaveBeenCalledWith('[custom-guides] catalogue fetch failed', {
      reason: 'http-503',
      message: 'upstream drain failed',
    });
  });

  it('reads the status off the nested statusCode shapes too', async () => {
    mockGet.mockRejectedValue({ data: { statusCode: 502 } });

    await fetchCustomGuideRepository('stacks-123');

    expect(recordCustomGuideCatalogueUnavailable).toHaveBeenCalledWith('http-502');
  });

  it('records transport-error when the rejection carries no status', async () => {
    mockGet.mockRejectedValue(new Error('network error'));

    const result = await fetchCustomGuideRepository('stacks-123');

    expect(result).toEqual([]);
    expect(recordCustomGuideCatalogueUnavailable).toHaveBeenCalledWith('transport-error');
    expect(logger.warn).toHaveBeenCalledWith('[custom-guides] catalogue fetch failed', {
      reason: 'transport-error',
      message: 'network error',
    });
  });

  it('caches a successful result within the TTL and de-duplicates concurrent calls', async () => {
    mockGet.mockResolvedValue({ capability: { available: true }, guides: [{ id: 'g1', status: 'published' }] });

    const [a, b] = await Promise.all([
      fetchCustomGuideRepository('stacks-123'),
      fetchCustomGuideRepository('stacks-123'),
    ]);
    const third = await fetchCustomGuideRepository('stacks-123');

    expect(a).toEqual(b);
    expect(third).toEqual(a);
    expect(mockGet).toHaveBeenCalledTimes(1); // one shared drain for all three

    invalidateCustomGuideRepositoryCache();
    await fetchCustomGuideRepository('stacks-123');
    expect(mockGet).toHaveBeenCalledTimes(2); // re-lists after invalidate
  });

  it('does not cache failures (a transient error does not stick for the TTL)', async () => {
    mockGet.mockRejectedValueOnce(new Error('network error'));
    mockGet.mockResolvedValueOnce({ capability: { available: true }, guides: [{ id: 'g1', status: 'published' }] });

    expect(await fetchCustomGuideRepository('stacks-123')).toEqual([]);
    const retry = await fetchCustomGuideRepository('stacks-123');

    expect(retry.map((g) => g.id)).toEqual(['g1']);
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(recordCustomGuideCatalogueUnavailable).toHaveBeenCalledTimes(1);
    expect(recordCustomGuideCatalogueUnavailable).toHaveBeenCalledWith('transport-error');
  });
});
