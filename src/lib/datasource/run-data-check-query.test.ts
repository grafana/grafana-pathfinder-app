/**
 * Tests for the data-check query executor.
 */

import { createDataFrame, LoadingState, type DataQueryRequest } from '@grafana/data';
import { Observable, of, throwError } from 'rxjs';
import { runDataCheckQuery, DATA_CHECK_QUERY_LIMITS } from './run-data-check-query';

const mockQuery = jest.fn();
const mockGetDataSourceApi = jest.fn();

jest.mock('./datasource-registry', () => ({
  getDataSourceApi: (ref: unknown) => mockGetDataSourceApi(ref),
}));

jest.mock('../logging', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), exception: jest.fn() },
}));

function respondWith(response: Record<string, unknown>) {
  mockQuery.mockReturnValue(of({ data: [], ...response }));
}

function frameWithRows(rowCount: number) {
  return createDataFrame({
    refId: 'A',
    fields: [{ name: 'Value', values: Array.from({ length: rowCount }, (_, i) => i) }],
  });
}

function sentRequest(call = 0): DataQueryRequest {
  return mockQuery.mock.calls[call][0];
}

const flushMicrotasks = async () => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

const baseRequest = {
  datasourceUid: 'ds-uid',
  datasourceType: 'prometheus' as const,
  query: 'up',
};

beforeEach(() => {
  mockQuery.mockReset();
  mockGetDataSourceApi.mockReset();
  mockGetDataSourceApi.mockResolvedValue({ query: mockQuery });
});

describe('runDataCheckQuery', () => {
  it('reports data when a frame has rows', async () => {
    respondWith({ data: [frameWithRows(3)] });

    const result = await runDataCheckQuery(baseRequest);

    expect(result).toEqual({ ok: true, hasData: true, seriesCount: 1, rowCount: 3 });
  });

  it('reports no data for an empty frame list', async () => {
    respondWith({ data: [] });

    const result = await runDataCheckQuery(baseRequest);

    expect(result).toEqual({ ok: true, hasData: false, seriesCount: 0, rowCount: 0 });
  });

  it('reports no data for a schema-only frame', async () => {
    // Grafana returns a frame with a schema and no values when a query matched
    // nothing — counting frames rather than rows would call this a hit.
    respondWith({ data: [frameWithRows(0)] });

    const result = await runDataCheckQuery(baseRequest);

    expect(result).toEqual({ ok: true, hasData: false, seriesCount: 0, rowCount: 0 });
  });

  it('counts rows from field values when a data source returns a frame without a length', async () => {
    respondWith({ data: [{ fields: [{ name: 'Value', values: [1, 2] }] }] });

    const result = await runDataCheckQuery(baseRequest);

    expect(result).toEqual({ ok: true, hasData: true, seriesCount: 1, rowCount: 2 });
  });

  it('sums rows across multiple frames', async () => {
    respondWith({ data: [frameWithRows(2), frameWithRows(5)] });

    const result = await runDataCheckQuery(baseRequest);

    expect(result).toEqual({ ok: true, hasData: true, seriesCount: 2, rowCount: 7 });
  });

  it('surfaces the data source error rather than reporting no data', async () => {
    respondWith({
      data: [frameWithRows(0)],
      error: { refId: 'A', message: 'parse error: unexpected identifier', status: 400 },
      state: LoadingState.Error,
    });

    const result = await runDataCheckQuery(baseRequest);

    expect(result).toEqual({ ok: false, error: 'parse error: unexpected identifier', failureKind: 'query' });
  });

  it('reads the first entry of an errors-only response', async () => {
    respondWith({ errors: [{ refId: 'A', message: 'bad matcher' }], state: LoadingState.Error });

    const result = await runDataCheckQuery(baseRequest);

    expect(result).toEqual({ ok: false, error: 'bad matcher', failureKind: 'query' });
  });

  it('never reads an error state as no data, even without an error object', async () => {
    respondWith({ data: [], state: LoadingState.Error });

    const result = await runDataCheckQuery(baseRequest);

    expect(result).toEqual({ ok: false, error: 'Query failed.', failureKind: 'query' });
  });

  it('rejects an empty query without resolving the data source', async () => {
    const result = await runDataCheckQuery({ ...baseRequest, query: '   ' });

    expect(result).toEqual({ ok: false, error: 'No query to run.', failureKind: 'query' });
    expect(mockGetDataSourceApi).not.toHaveBeenCalled();
  });

  it('surfaces a backend message from a failed request', async () => {
    mockQuery.mockReturnValue(throwError(() => ({ status: 400, data: { message: 'bad request' } })));

    const result = await runDataCheckQuery(baseRequest);

    expect(result).toEqual({ ok: false, error: 'bad request', failureKind: 'query' });
  });

  it('surfaces a backend message a data source folded into its response', async () => {
    respondWith({
      error: { status: 400, data: { message: 'bad request' }, message: 'bad request' },
      state: LoadingState.Error,
    });

    const result = await runDataCheckQuery(baseRequest);

    expect(result).toEqual({ ok: false, error: 'bad request', failureKind: 'query' });
  });

  it.each([
    [
      'thrown',
      () => mockQuery.mockReturnValue(throwError(() => ({ status: 500, statusText: 'Internal Server Error' }))),
    ],
    [
      'folded into the response',
      () =>
        respondWith({
          error: {
            status: 500,
            statusText: 'Internal Server Error',
            message: 'Query error: 500 Internal Server Error',
          },
          state: LoadingState.Error,
        }),
    ],
  ])('falls back to the status code when a %s error carries no message', async (_label, arrange) => {
    arrange();

    const result = await runDataCheckQuery(baseRequest);

    expect(result).toEqual({
      ok: false,
      error: 'Query failed (HTTP 500 Internal Server Error).',
      failureKind: 'query',
    });
  });

  it('reports a data source it cannot resolve as a failed query', async () => {
    mockGetDataSourceApi.mockRejectedValue(new Error('Datasource ds-uid was not found'));

    const result = await runDataCheckQuery(baseRequest);

    expect(result).toEqual({ ok: false, error: 'Datasource ds-uid was not found', failureKind: 'query' });
  });

  it('accepts a data source whose query resolves a promise rather than an observable', async () => {
    mockQuery.mockResolvedValue({ data: [frameWithRows(1)] });

    const result = await runDataCheckQuery(baseRequest);

    expect(result).toEqual({ ok: true, hasData: true, seriesCount: 1, rowCount: 1 });
  });

  describe('request shape', () => {
    it('queries through the runtime-owned data source instance', async () => {
      respondWith({ data: [] });

      await runDataCheckQuery(baseRequest);

      expect(mockGetDataSourceApi).toHaveBeenCalledWith('ds-uid');
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('applies the default time range and caps result size', async () => {
      respondWith({ data: [] });

      await runDataCheckQuery(baseRequest);

      const request = sentRequest();
      expect(request.range.raw).toEqual({
        from: DATA_CHECK_QUERY_LIMITS.defaultFrom,
        to: DATA_CHECK_QUERY_LIMITS.defaultTo,
      });
      expect(request.range.to.valueOf() - request.range.from.valueOf()).toBeCloseTo(60 * 60 * 1000, -4);
      expect(request.maxDataPoints).toBe(DATA_CHECK_QUERY_LIMITS.maxDataPoints);
      expect(request.targets[0]).toMatchObject({ maxDataPoints: DATA_CHECK_QUERY_LIMITS.maxDataPoints });
    });

    // Asserting against the constant only proves it is wired, never that it is
    // still small. `CONCERN_DETAILS.md` records relaxing these as a fracture, so the
    // numbers themselves are the contract and a one-line edit has to fail here.
    it('pins the caps to their agreed values, not merely to the constant', () => {
      expect(DATA_CHECK_QUERY_LIMITS.maxDataPoints).toBe(100);
      expect(DATA_CHECK_QUERY_LIMITS.timeoutMs).toBe(15_000);
      expect(DATA_CHECK_QUERY_LIMITS.defaultFrom).toBe('now-1h');
      expect(DATA_CHECK_QUERY_LIMITS.defaultTo).toBe('now');
    });

    it('honours an author-supplied time range', async () => {
      respondWith({ data: [] });

      await runDataCheckQuery({ ...baseRequest, from: 'now-7d', to: 'now-1d' });

      const { range } = sentRequest();
      expect(range.raw).toEqual({ from: 'now-7d', to: 'now-1d' });
      expect(range.to.valueOf() - range.from.valueOf()).toBeCloseTo(6 * 24 * 60 * 60 * 1000, -6);
    });

    it('accepts an epoch-millisecond time range', async () => {
      respondWith({ data: [] });

      await runDataCheckQuery({ ...baseRequest, from: '1700000000000', to: '1700003600000' });

      const { range } = sentRequest();
      expect(range.from.valueOf()).toBe(1700000000000);
      expect(range.to.valueOf()).toBe(1700003600000);
    });

    it('refuses a time range it cannot parse without running the query', async () => {
      const result = await runDataCheckQuery({ ...baseRequest, from: 'yesterday-ish' });

      expect(result).toEqual({ ok: false, error: 'Invalid time range: yesterday-ish to now.', failureKind: 'query' });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('targets the requested data source', async () => {
      respondWith({ data: [] });

      await runDataCheckQuery(baseRequest);

      expect(sentRequest().targets[0]).toMatchObject({ refId: 'A', datasource: { uid: 'ds-uid', type: 'prometheus' } });
    });

    it('sends a self-contained request with no dashboard variables to interpolate', async () => {
      respondWith({ data: [] });

      await runDataCheckQuery(baseRequest);

      expect(sentRequest()).toMatchObject({ app: 'pathfinder', timezone: 'browser', scopedVars: {} });
    });

    it('gives each query its own request id', async () => {
      respondWith({ data: [] });

      await runDataCheckQuery(baseRequest);
      await runDataCheckQuery(baseRequest);

      const [first, second] = mockQuery.mock.calls.map((call) => call[0].requestId);
      expect(first).not.toBe(second);
      expect(first).toContain('pathfinder-data-check-ds-uid');
    });
  });

  describe('cancellation', () => {
    it('cancels the in-flight query when the caller signal fires', async () => {
      const teardown = jest.fn();
      mockQuery.mockReturnValue(new Observable(() => teardown));
      const controller = new AbortController();

      const pending = runDataCheckQuery({ ...baseRequest, signal: controller.signal });
      await flushMicrotasks();
      controller.abort();
      const result = await pending;

      expect(teardown).toHaveBeenCalled();
      expect(result).toEqual({ ok: false, error: 'Query was cancelled.', failureKind: 'query' });
    });

    it('does not start a query when the caller signal already fired', async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await runDataCheckQuery({ ...baseRequest, signal: controller.signal });

      expect(mockGetDataSourceApi).not.toHaveBeenCalled();
      expect(result).toMatchObject({ ok: false, failureKind: 'query' });
    });

    it('reports a timeout and cancels the query when it outlives the cap', async () => {
      jest.useFakeTimers();
      const teardown = jest.fn();
      mockQuery.mockReturnValue(new Observable(() => teardown));

      const pending = runDataCheckQuery(baseRequest);
      await flushMicrotasks();
      jest.advanceTimersByTime(DATA_CHECK_QUERY_LIMITS.timeoutMs);
      jest.useRealTimers();

      await expect(pending).resolves.toEqual({
        ok: false,
        error: `Query timed out after ${DATA_CHECK_QUERY_LIMITS.timeoutMs / 1000}s.`,
        failureKind: 'timeout',
      });
      expect(teardown).toHaveBeenCalled();
    });

    it('times out a data source that never finishes loading', async () => {
      jest.useFakeTimers();
      mockGetDataSourceApi.mockReturnValue(new Promise(() => {}));

      const pending = runDataCheckQuery(baseRequest);
      jest.advanceTimersByTime(DATA_CHECK_QUERY_LIMITS.timeoutMs);
      jest.useRealTimers();

      await expect(pending).resolves.toMatchObject({ ok: false, failureKind: 'timeout' });
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe('per-type query models', () => {
    it.each([
      ['prometheus', 'up', { expr: 'up', instant: true }],
      ['loki', '{job="varlogs"}', { expr: '{job="varlogs"}', queryType: 'range', maxLines: 100 }],
      ['tempo', '{ name = "GET" }', { query: '{ name = "GET" }', queryType: 'traceql', limit: 100 }],
    ])('builds the %s model', async (type, query, expected) => {
      respondWith({ data: [] });

      await runDataCheckQuery({ ...baseRequest, datasourceType: type as any, query });

      expect(sentRequest().targets[0]).toMatchObject(expected);
    });

    it('splits the pyroscope profile type from its label selector', async () => {
      respondWith({ data: [] });

      await runDataCheckQuery({
        ...baseRequest,
        datasourceType: 'pyroscope',
        query: 'process_cpu:cpu:nanoseconds|{service="api"}',
      });

      expect(sentRequest().targets[0]).toMatchObject({
        queryType: 'profile',
        profileTypeId: 'process_cpu:cpu:nanoseconds',
        labelSelector: '{service="api"}',
      });
    });

    it('defaults the pyroscope label selector when none is given', async () => {
      respondWith({ data: [] });

      await runDataCheckQuery({ ...baseRequest, datasourceType: 'pyroscope', query: 'process_cpu:cpu:nanoseconds' });

      expect(sentRequest().targets[0]).toMatchObject({ labelSelector: '{}' });
    });
  });
});
