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

  // The proxy serializes the stored type verbatim with no validation and no
  // omitempty, so the wire can carry "" or anything else. Drop it at the
  // boundary rather than let CustomGuideManifest.type overclaim.
  it.each(['', 'PATH', 'milestone', 'journey ', 'path\x00'])(
    'drops the unrecognized manifest type %p',
    async (wireType) => {
      mockGet.mockResolvedValue({
        capability: { available: true },
        guides: [{ id: 'fe-guide', status: 'published', manifest: { type: wireType, description: 'kept' } }],
      });

      const result = await fetchCustomGuideRepository('stacks-123');

      expect(result[0]!.manifest?.type).toBeUndefined();
      expect(result[0]!.manifest?.description).toBe('kept');
    }
  );

  it.each(['guide', 'path', 'journey'])('keeps the recognized manifest type %p', async (wireType) => {
    mockGet.mockResolvedValue({
      capability: { available: true },
      guides: [{ id: 'fe-guide', status: 'published', manifest: { type: wireType } }],
    });

    const result = await fetchCustomGuideRepository('stacks-123');

    expect(result[0]!.manifest?.type).toBe(wireType);
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

  // The reason lands on a Faro event attribute and in the bridged log context,
  // so every rejection shape must collapse to a token from the closed set.
  it.each([
    { shape: 'a top-level status', err: { status: 503, statusText: 'Service Unavailable' }, reason: 'http-503' },
    { shape: 'a top-level statusCode', err: { statusCode: 418 }, reason: 'http-418' },
    { shape: 'a nested data.statusCode', err: { data: { statusCode: 502 } }, reason: 'http-502' },
    {
      shape: 'status ahead of both statusCode shapes',
      err: { status: 503, statusCode: 404, data: { statusCode: 500 } },
      reason: 'http-503',
    },
    {
      shape: 'statusCode ahead of data.statusCode',
      err: { statusCode: 404, data: { statusCode: 500 } },
      reason: 'http-404',
    },
    { shape: 'one below the low bound', err: { status: 99 }, reason: 'transport-error' },
    { shape: 'the low bound', err: { status: 100 }, reason: 'http-100' },
    { shape: 'the high bound', err: { status: 599 }, reason: 'http-599' },
    { shape: 'one above the high bound', err: { status: 600 }, reason: 'transport-error' },
    { shape: 'a wildly out-of-range status', err: { status: 99999 }, reason: 'transport-error' },
    { shape: 'a negative status', err: { status: -503 }, reason: 'transport-error' },
    { shape: 'a string status', err: { status: '503' }, reason: 'transport-error' },
    { shape: 'a non-integer status', err: { data: { statusCode: 503.0000001 } }, reason: 'transport-error' },
    { shape: 'no status at all', err: new Error('network error'), reason: 'transport-error' },
  ])('records $reason for $shape', async ({ err, reason }) => {
    mockGet.mockRejectedValue(err);

    const result = await fetchCustomGuideRepository('stacks-123');

    expect(result).toEqual([]);
    expect(recordCustomGuideCatalogueUnavailable).toHaveBeenCalledWith(reason);
    expect(logger.warn).toHaveBeenCalledWith('[custom-guides] catalogue fetch failed', { reason });
  });

  // logging.ts sanitizes the log context but does not strip it, so anything put
  // there reaches Faro — an error message would be a user-derived free-text
  // attribute, which docs/developer/TELEMETRY.md forbids.
  it('never forwards the error message into the bridged log context', async () => {
    const sentinel = 'c0ffee-user-derived-detail';
    mockGet.mockRejectedValue({ status: 503, message: `upstream drain failed for ${sentinel}` });

    await fetchCustomGuideRepository('stacks-123');

    expect(logger.warn).toHaveBeenCalledWith('[custom-guides] catalogue fetch failed', { reason: 'http-503' });
    expect(JSON.stringify((logger.warn as jest.Mock).mock.calls)).not.toContain(sentinel);
  });

  // Both callers document that this never rejects — a throwing sink must not break that.
  it.each([
    { sink: 'the logger', mock: () => logger.warn as jest.Mock },
    { sink: 'the telemetry facade', mock: () => recordCustomGuideCatalogueUnavailable as jest.Mock },
  ])('still resolves to an empty array when $sink throws', async ({ mock }) => {
    mockGet.mockRejectedValue(new Error('network error'));
    mock().mockImplementationOnce(() => {
      throw new Error('observability blew up');
    });

    await expect(fetchCustomGuideRepository('stacks-123')).resolves.toEqual([]);
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
