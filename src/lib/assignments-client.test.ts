jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(),
}));

jest.mock('./telemetry/facade', () => ({
  recordAssignmentsUnavailable: jest.fn(),
}));

jest.mock('./logging', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), exception: jest.fn() },
}));

jest.mock('../utils/interactive-guides-api', () => ({
  isBackendApiAvailable: jest.fn(),
}));

import { getBackendSrv } from '@grafana/runtime';
import { fetchMyAssignments } from './assignments-client';
import { logger } from './logging';
import { recordAssignmentsUnavailable } from './telemetry/facade';
import { isBackendApiAvailable } from '../utils/interactive-guides-api';

const mockGet = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (getBackendSrv as jest.Mock).mockReturnValue({ get: mockGet });
  (isBackendApiAvailable as jest.Mock).mockReturnValue(true);
});

describe('fetchMyAssignments', () => {
  it('returns the assignments array on success', async () => {
    mockGet.mockResolvedValue({
      capability: { available: true },
      assignments: [{ targetType: 'path', targetId: 'fundamentals', satisfied: false, lifecycle: 'active' }],
      asOf: '2026-07-23T00:00:00Z',
    });

    const result = await fetchMyAssignments('stacks-123');

    expect(result).toHaveLength(1);
    expect(result[0]!.targetId).toBe('fundamentals');
    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/assignments/my'), undefined, undefined, {
      showErrorAlert: false,
      showSuccessAlert: false,
    });
  });

  it('returns an empty array when the proxy reports itself unavailable', async () => {
    mockGet.mockResolvedValue({
      capability: { available: false, reason: 'obo-unavailable' },
      assignments: [],
    });

    const result = await fetchMyAssignments('stacks-123');

    expect(result).toEqual([]);
    expect(recordAssignmentsUnavailable).toHaveBeenCalledWith('obo-unavailable');
  });

  it('does not request when the aggregation toggle is off', async () => {
    (isBackendApiAvailable as jest.Mock).mockReturnValue(false);

    const result = await fetchMyAssignments('stacks-123');

    expect(result).toEqual([]);
    expect(mockGet).not.toHaveBeenCalled();
    expect(recordAssignmentsUnavailable).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('trusts a server-reported feature-toggle-disabled capability', async () => {
    mockGet.mockResolvedValue({
      capability: { available: false, reason: 'feature-toggle-disabled' },
      assignments: [],
    });

    const result = await fetchMyAssignments('stacks-123');

    expect(result).toEqual([]);
    expect(recordAssignmentsUnavailable).toHaveBeenCalledWith('feature-toggle-disabled');
  });

  it('returns an empty array when no namespace is provided', async () => {
    const result = await fetchMyAssignments('');

    expect(result).toEqual([]);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('returns an empty array when the response is malformed', async () => {
    mockGet.mockResolvedValue({ capability: { available: true } });

    const result = await fetchMyAssignments('stacks-123');

    expect(result).toEqual([]);
  });

  // An omitted or null `assignments` on an available capability is an
  // ordinary empty list, not drift — Go's json.Marshal of a nil slice emits
  // `null`, so the proxy sends exactly this for a caller with no assignments.
  it.each([
    { shape: 'omitted', response: { capability: { available: true } } },
    { shape: 'null', response: { capability: { available: true }, assignments: null } },
  ])('stays silent when assignments is $shape', async ({ response }) => {
    mockGet.mockResolvedValue(response);

    const result = await fetchMyAssignments('stacks-123');

    expect(result).toEqual([]);
    expect(recordAssignmentsUnavailable).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  // A present-but-non-array `assignments` cannot be a list under any
  // encoding, so it is schema drift and must be countable.
  it.each([
    { shape: 'an object', assignments: { fundamentals: {} } },
    { shape: 'a string', assignments: 'fundamentals' },
    { shape: 'a number', assignments: 3 },
    { shape: 'a boolean', assignments: true },
  ])('reports malformed-response when assignments is $shape', async ({ assignments }) => {
    mockGet.mockResolvedValue({ capability: { available: true }, assignments });

    const result = await fetchMyAssignments('stacks-123');

    expect(result).toEqual([]);
    expect(recordAssignmentsUnavailable).toHaveBeenCalledWith('malformed-response');
    expect(logger.warn).toHaveBeenCalledWith('[assignments] malformed response', { reason: 'malformed-response' });
  });

  it('does not stick a malformed response across calls', async () => {
    mockGet.mockResolvedValueOnce({ capability: { available: true }, assignments: { nope: true } });

    await expect(fetchMyAssignments('stacks-123')).resolves.toEqual([]);

    mockGet.mockResolvedValueOnce({
      capability: { available: true },
      assignments: [{ targetType: 'path', targetId: 'fundamentals', satisfied: false, lifecycle: 'active' }],
    });

    const recovered = await fetchMyAssignments('stacks-123');

    expect(recovered).toHaveLength(1);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('refetches a legitimately empty list', async () => {
    mockGet.mockResolvedValue({ capability: { available: true }, assignments: [] });

    await fetchMyAssignments('stacks-123');
    await fetchMyAssignments('stacks-123');

    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it.each([
    { shape: 'a top-level status', err: { status: 503, statusText: 'Service Unavailable' }, reason: 'http-503' },
    { shape: 'a top-level statusCode', err: { statusCode: 418 }, reason: 'http-418' },
    { shape: 'a nested data.statusCode', err: { data: { statusCode: 502 } }, reason: 'http-502' },
    { shape: 'no status at all', err: new Error('network error'), reason: 'transport-error' },
  ])('records $reason for $shape', async ({ err, reason }) => {
    mockGet.mockRejectedValue(err);

    const result = await fetchMyAssignments('stacks-123');

    expect(result).toEqual([]);
    expect(recordAssignmentsUnavailable).toHaveBeenCalledWith(reason);
    expect(logger.warn).toHaveBeenCalledWith('[assignments] fetch failed', { reason });
  });

  // logging.ts sanitizes the log context but does not strip it, so anything
  // put there reaches Faro — an error message would be user-derived free text,
  // which docs/developer/TELEMETRY.md forbids.
  it('never forwards the error message into the bridged log context', async () => {
    const sentinel = 'c0ffee-user-derived-detail';
    mockGet.mockRejectedValue({ status: 503, message: `upstream drain failed for ${sentinel}` });

    await fetchMyAssignments('stacks-123');

    expect(logger.warn).toHaveBeenCalledWith('[assignments] fetch failed', { reason: 'http-503' });
    expect(JSON.stringify((logger.warn as jest.Mock).mock.calls)).not.toContain(sentinel);
  });

  it('still resolves to an empty array when the telemetry facade throws', async () => {
    mockGet.mockRejectedValue(new Error('network error'));
    (recordAssignmentsUnavailable as jest.Mock).mockImplementationOnce(() => {
      throw new Error('observability blew up');
    });

    await expect(fetchMyAssignments('stacks-123')).resolves.toEqual([]);
  });

  it('de-duplicates concurrent calls and refetches once each has settled', async () => {
    mockGet.mockResolvedValue({
      capability: { available: true },
      assignments: [{ targetType: 'path', targetId: 'p1', satisfied: false, lifecycle: 'active' }],
    });

    const [a, b] = await Promise.all([fetchMyAssignments('stacks-123'), fetchMyAssignments('stacks-123')]);
    const third = await fetchMyAssignments('stacks-123');

    expect(a).toEqual(b);
    expect(third).toEqual(a);
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('does not stick a failure across calls', async () => {
    mockGet.mockRejectedValueOnce(new Error('network error'));
    mockGet.mockResolvedValueOnce({
      capability: { available: true },
      assignments: [{ targetType: 'path', targetId: 'p1', satisfied: false, lifecycle: 'active' }],
    });

    expect(await fetchMyAssignments('stacks-123')).toEqual([]);
    const retry = await fetchMyAssignments('stacks-123');

    expect(retry.map((a) => a.targetId)).toEqual(['p1']);
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(recordAssignmentsUnavailable).toHaveBeenCalledTimes(1);
    expect(recordAssignmentsUnavailable).toHaveBeenCalledWith('transport-error');
  });
});
