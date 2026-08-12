/**
 * Tests for the data-check query executor.
 */

import { Observable, of, throwError } from 'rxjs';
import { runDataCheckQuery, DATA_CHECK_QUERY_LIMITS } from './run-data-check-query';

const mockFetch = jest.fn();

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({ fetch: mockFetch }),
}));

jest.mock('../logging', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), exception: jest.fn() },
}));

function respondWith(results: unknown) {
  mockFetch.mockReturnValue(of({ data: { results } }));
}

/** One frame carrying `rowCount` rows in a single column. */
function frameWithRows(rowCount: number) {
  return { schema: { fields: [{ name: 'Value' }] }, data: { values: [Array.from({ length: rowCount }, (_, i) => i)] } };
}

const baseRequest = {
  datasourceUid: 'ds-uid',
  datasourceType: 'prometheus' as const,
  query: 'up',
};

beforeEach(() => {
  mockFetch.mockReset();
});

describe('runDataCheckQuery', () => {
  it('reports data when a frame has rows', async () => {
    respondWith({ A: { frames: [frameWithRows(3)] } });

    const result = await runDataCheckQuery(baseRequest);

    expect(result).toEqual({ ok: true, hasData: true, seriesCount: 1, rowCount: 3 });
  });

  it('reports no data for an empty frame list', async () => {
    respondWith({ A: { frames: [] } });

    const result = await runDataCheckQuery(baseRequest);

    expect(result).toEqual({ ok: true, hasData: false, seriesCount: 0, rowCount: 0 });
  });

  it('reports no data for a schema-only frame', async () => {
    // Grafana returns a frame with a schema and no values when a query matched
    // nothing — counting frames rather than rows would call this a hit.
    respondWith({ A: { frames: [{ schema: { fields: [{ name: 'Value' }] }, data: { values: [[]] } }] } });

    const result = await runDataCheckQuery(baseRequest);

    expect(result).toEqual({ ok: true, hasData: false, seriesCount: 0, rowCount: 0 });
  });

  it('sums rows across multiple frames', async () => {
    respondWith({ A: { frames: [frameWithRows(2), frameWithRows(5)] } });

    const result = await runDataCheckQuery(baseRequest);

    expect(result).toEqual({ ok: true, hasData: true, seriesCount: 2, rowCount: 7 });
  });

  it('surfaces the data source error rather than reporting no data', async () => {
    respondWith({ A: { error: 'parse error: unexpected identifier' } });

    const result = await runDataCheckQuery(baseRequest);

    expect(result).toEqual({ ok: false, error: 'parse error: unexpected identifier' });
  });

  it('rejects an empty query without calling the backend', async () => {
    const result = await runDataCheckQuery({ ...baseRequest, query: '   ' });

    expect(result).toEqual({ ok: false, error: 'No query to run.' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('surfaces a backend message from a failed request', async () => {
    mockFetch.mockReturnValue(throwError(() => ({ status: 400, data: { message: 'bad request' } })));

    const result = await runDataCheckQuery(baseRequest);

    expect(result).toEqual({ ok: false, error: 'bad request' });
  });

  it('falls back to the status code when the error carries no message', async () => {
    mockFetch.mockReturnValue(throwError(() => ({ status: 500, statusText: 'Internal Server Error' })));

    const result = await runDataCheckQuery(baseRequest);

    expect(result).toEqual({ ok: false, error: 'Query failed (HTTP 500 Internal Server Error).' });
  });

  describe('request shape', () => {
    it('suppresses the global error toast so failures stay in the step', async () => {
      respondWith({ A: { frames: [] } });

      await runDataCheckQuery(baseRequest);

      expect(mockFetch.mock.calls[0][0]).toMatchObject({ url: '/api/ds/query', method: 'POST', showErrorAlert: false });
    });

    it('applies the default time range and caps result size', async () => {
      respondWith({ A: { frames: [] } });

      await runDataCheckQuery(baseRequest);

      const body = mockFetch.mock.calls[0][0].data;
      expect(body.from).toBe(DATA_CHECK_QUERY_LIMITS.defaultFrom);
      expect(body.to).toBe(DATA_CHECK_QUERY_LIMITS.defaultTo);
      expect(body.queries[0].maxDataPoints).toBe(DATA_CHECK_QUERY_LIMITS.maxDataPoints);
    });

    it('honours an author-supplied time range', async () => {
      respondWith({ A: { frames: [] } });

      await runDataCheckQuery({ ...baseRequest, from: 'now-7d', to: 'now-1d' });

      const body = mockFetch.mock.calls[0][0].data;
      expect(body).toMatchObject({ from: 'now-7d', to: 'now-1d' });
    });

    it('targets the requested data source', async () => {
      respondWith({ A: { frames: [] } });

      await runDataCheckQuery(baseRequest);

      expect(mockFetch.mock.calls[0][0].data.queries[0].datasource).toEqual({ uid: 'ds-uid', type: 'prometheus' });
    });

    it('hands the backend a signal so the timeout can cancel the request', async () => {
      respondWith({ A: { frames: [] } });

      await runDataCheckQuery(baseRequest);

      expect(mockFetch.mock.calls[0][0].abortSignal).toBeInstanceOf(AbortSignal);
    });

    it('gives each query its own request id', async () => {
      respondWith({ A: { frames: [] } });

      await runDataCheckQuery(baseRequest);
      await runDataCheckQuery(baseRequest);

      const [first, second] = mockFetch.mock.calls.map((call) => call[0].requestId);
      expect(first).not.toBe(second);
      expect(first).toContain('pathfinder-data-check-ds-uid');
    });
  });

  describe('cancellation', () => {
    it('aborts an in-flight request when the caller signal fires', async () => {
      let capturedSignal: AbortSignal | undefined;
      mockFetch.mockImplementation(
        (request) =>
          new Observable((subscriber) => {
            capturedSignal = request.abortSignal;
            request.abortSignal.addEventListener('abort', () => subscriber.error(new Error('aborted')));
          })
      );
      const controller = new AbortController();

      const pending = runDataCheckQuery({ ...baseRequest, signal: controller.signal });
      controller.abort();
      await pending;

      expect(capturedSignal?.aborted).toBe(true);
    });

    it('starts aborted when the caller signal already fired', async () => {
      let abortedAtRequest: boolean | undefined;
      mockFetch.mockImplementation((request) => {
        abortedAtRequest = request.abortSignal.aborted;
        return of({ data: { results: { A: { frames: [] } } } });
      });
      const controller = new AbortController();
      controller.abort();

      await runDataCheckQuery({ ...baseRequest, signal: controller.signal });

      expect(abortedAtRequest).toBe(true);
    });

    it('reports a timeout when the request outlives the cap', async () => {
      jest.useFakeTimers();
      mockFetch.mockImplementation(
        (request) =>
          new Observable((subscriber) => {
            request.abortSignal.addEventListener('abort', () => subscriber.error(new Error('aborted')));
          })
      );

      const pending = runDataCheckQuery(baseRequest);
      jest.advanceTimersByTime(DATA_CHECK_QUERY_LIMITS.timeoutMs);
      jest.useRealTimers();

      await expect(pending).resolves.toEqual({
        ok: false,
        error: `Query timed out after ${DATA_CHECK_QUERY_LIMITS.timeoutMs / 1000}s.`,
      });
    });
  });

  describe('per-type query models', () => {
    it.each([
      ['prometheus', 'up', { expr: 'up', instant: true }],
      ['loki', '{job="varlogs"}', { expr: '{job="varlogs"}', queryType: 'range' }],
      ['tempo', '{ name = "GET" }', { query: '{ name = "GET" }', queryType: 'traceql' }],
    ])('builds the %s model', async (type, query, expected) => {
      respondWith({ A: { frames: [] } });

      await runDataCheckQuery({ ...baseRequest, datasourceType: type as any, query });

      expect(mockFetch.mock.calls[0][0].data.queries[0]).toMatchObject(expected);
    });

    it('splits the pyroscope profile type from its label selector', async () => {
      respondWith({ A: { frames: [] } });

      await runDataCheckQuery({
        ...baseRequest,
        datasourceType: 'pyroscope',
        query: 'process_cpu:cpu:nanoseconds|{service="api"}',
      });

      expect(mockFetch.mock.calls[0][0].data.queries[0]).toMatchObject({
        queryType: 'profile',
        profileTypeId: 'process_cpu:cpu:nanoseconds',
        labelSelector: '{service="api"}',
      });
    });

    it('defaults the pyroscope label selector when none is given', async () => {
      respondWith({ A: { frames: [] } });

      await runDataCheckQuery({ ...baseRequest, datasourceType: 'pyroscope', query: 'process_cpu:cpu:nanoseconds' });

      expect(mockFetch.mock.calls[0][0].data.queries[0]).toMatchObject({ labelSelector: '{}' });
    });
  });
});
