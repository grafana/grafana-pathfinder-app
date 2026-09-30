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

  it.each([
    { shape: 'an object', assignments: { fundamentals: {} } },
    { shape: 'a string', assignments: 'fundamentals' },
    { shape: 'null', assignments: null },
  ])('reports malformed-response when assignments is $shape', async ({ assignments }) => {
    mockGet.mockResolvedValue({ capability: { available: true }, assignments });

    const result = await fetchMyAssignments('stacks-123');

    expect(result).toEqual([]);
    expect(recordAssignmentsUnavailable).toHaveBeenCalledWith('malformed-response');
    expect(logger.warn).toHaveBeenCalledWith('[assignments] malformed response', { reason: 'malformed-response' });
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

  it('de-duplicates in-flight calls but never caches a result', async () => {
    const entries = [{ targetType: 'path', targetId: 'p1', satisfied: false, lifecycle: 'active' }];
    mockGet.mockResolvedValue({ capability: { available: true }, assignments: entries });

    await Promise.all([fetchMyAssignments('stacks-123'), fetchMyAssignments('stacks-123')]);
    expect(mockGet).toHaveBeenCalledTimes(1);

    await expect(fetchMyAssignments('stacks-123')).resolves.toEqual(entries);
    expect(mockGet).toHaveBeenCalledTimes(2);

    mockGet.mockRejectedValueOnce(new Error('network error'));
    await expect(fetchMyAssignments('stacks-123')).resolves.toEqual([]);
    await expect(fetchMyAssignments('stacks-123')).resolves.toEqual(entries);
    expect(mockGet).toHaveBeenCalledTimes(4);
  });
});
