/**
 * The only place in the plugin that runs a data source query, so the cost caps
 * below are enforced once.
 */

import {
  dateMath,
  dateTime,
  LoadingState,
  type DataQueryRequest,
  type DataQueryResponse,
  type DateTime,
  type TimeRange,
} from '@grafana/data';
import type { DataQuery } from '@grafana/schema';
import { defer, from as fromInput, fromEvent, lastValueFrom, switchMap, takeUntil } from 'rxjs';
import type { SupportedDatasourceType } from '../../constants/datasource-types';
import { logger } from '../logging';
import { getDataSourceApi } from './datasource-registry';

export const DATA_CHECK_QUERY_LIMITS = {
  maxDataPoints: 100,
  timeoutMs: 15_000,
  defaultFrom: 'now-1h',
  defaultTo: 'now',
} as const;

export interface DataCheckQueryRequest {
  datasourceUid: string;
  datasourceType: SupportedDatasourceType;
  query: string;
  from?: string;
  to?: string;
  signal?: AbortSignal;
}

/** `'timeout'` and `'query'` are separate so telemetry can tell "we gave up waiting" from "the backend said no". */
export type DataCheckFailureKind = 'timeout' | 'query';

export type DataCheckQueryResult =
  | { ok: true; hasData: boolean; seriesCount: number; rowCount: number }
  | { ok: false; error: string; failureKind: DataCheckFailureKind };

const QUERY_INTERVAL = { interval: '1m', intervalMs: 60_000 } as const;

/**
 * Per-type query model. Prometheus and Loki share `expr`; Tempo takes TraceQL
 * under `query`, and Pyroscope needs a profile type plus a label selector,
 * which authors write as `<profileTypeId>|<labelSelector>`.
 */
function buildQueryModel(type: SupportedDatasourceType, query: string): Record<string, unknown> {
  switch (type) {
    case 'prometheus':
      return { expr: query, instant: true, range: false };
    case 'loki':
      // The only type whose result the authored range alone would bound, and
      // that range is a default rather than a cap.
      return { expr: query, queryType: 'range', maxLines: DATA_CHECK_QUERY_LIMITS.maxDataPoints };
    case 'tempo':
      return { query, queryType: 'traceql', limit: DATA_CHECK_QUERY_LIMITS.maxDataPoints };
    case 'pyroscope': {
      const [profileTypeId = '', labelSelector = ''] = query.split('|');
      return {
        queryType: 'profile',
        profileTypeId: profileTypeId.trim(),
        labelSelector: labelSelector.trim() || '{}',
      };
    }
  }
}

/**
 * A frame counts as data only when it has at least one row. Grafana routinely
 * returns an empty frame (schema, no values) for a query that matched nothing,
 * so frame count alone would report every miss as a hit.
 */
function frameRowCount(frame: unknown): number {
  const shape = frame as { length?: unknown; fields?: Array<{ values?: { length?: number } }> } | null;
  if (typeof shape?.length === 'number') {
    return shape.length;
  }
  return (shape?.fields ?? []).reduce((max, field) => Math.max(max, field?.values?.length ?? 0), 0);
}

function countRows(frames: DataQueryResponse['data']): { seriesCount: number; rowCount: number } {
  let rowCount = 0;
  let seriesCount = 0;
  for (const frame of frames) {
    const rows = frameRowCount(frame);
    if (rows > 0) {
      seriesCount += 1;
      rowCount += rows;
    }
  }
  return { seriesCount, rowCount };
}

/** Reads both thrown fetch errors and the `DataQueryError` a data source folds a failed query into. */
function describeError(err: unknown): string {
  const queryErr = err as {
    status?: number;
    statusText?: string;
    refId?: string;
    message?: string;
    data?: { message?: string; error?: string };
  } | null;
  const backendMessage = queryErr?.data?.message ?? queryErr?.data?.error;
  if (backendMessage) {
    return backendMessage;
  }
  if (queryErr?.refId && queryErr.message) {
    return queryErr.message;
  }
  if (queryErr?.status) {
    return `Query failed (HTTP ${queryErr.status}${queryErr.statusText ? ` ${queryErr.statusText}` : ''}).`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return queryErr?.message || 'Query failed.';
}

function responseError(response: DataQueryResponse): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- toDataQueryResponse sets only `error` for a non-200 fetch
  const error = response.errors?.[0] ?? response.error;
  if (error) {
    return describeError(error);
  }
  return response.state === LoadingState.Error ? 'Query failed.' : undefined;
}

function parseTime(raw: string, roundUp: boolean): DateTime | undefined {
  const time = /^\d+$/.test(raw) ? dateTime(Number(raw)) : dateMath.toDateTime(raw, { roundUp });
  return time?.isValid() ? time : undefined;
}

function toTimeRange(from: string, to: string): TimeRange | undefined {
  const fromTime = parseTime(from, false);
  const toTime = parseTime(to, true);
  return fromTime && toTime ? { from: fromTime, to: toTime, raw: { from, to } } : undefined;
}

/**
 * `BackendSrv` cancels an in-flight request whose id a later one reuses, so a
 * per-datasource id would let two concurrent checks abort each other.
 */
let requestSequence = 0;

const CANCELLED = 'Query was cancelled.';

/** Grafana's `BackendSrv` keeps a failed data query off the global toast, so a failed check stays in the step. */
export async function runDataCheckQuery(request: DataCheckQueryRequest): Promise<DataCheckQueryResult> {
  const { datasourceUid, datasourceType, query, from, to, signal } = request;

  if (!query.trim()) {
    return { ok: false, error: 'No query to run.', failureKind: 'query' };
  }

  const rawFrom = from || DATA_CHECK_QUERY_LIMITS.defaultFrom;
  const rawTo = to || DATA_CHECK_QUERY_LIMITS.defaultTo;
  const range = toTimeRange(rawFrom, rawTo);
  if (!range) {
    return { ok: false, error: `Invalid time range: ${rawFrom} to ${rawTo}.`, failureKind: 'query' };
  }

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), DATA_CHECK_QUERY_LIMITS.timeoutMs);
  const onCallerAbort = () => timeoutController.abort();
  if (signal?.aborted) {
    onCallerAbort();
  } else {
    signal?.addEventListener('abort', onCallerAbort);
  }

  requestSequence += 1;

  const dsRequest: DataQueryRequest<DataQuery & Record<string, unknown>> = {
    requestId: `pathfinder-data-check-${datasourceUid}-${requestSequence}`,
    app: 'pathfinder',
    timezone: 'browser',
    range,
    rangeRaw: range.raw,
    ...QUERY_INTERVAL,
    maxDataPoints: DATA_CHECK_QUERY_LIMITS.maxDataPoints,
    scopedVars: {},
    startTime: Date.now(),
    targets: [
      {
        refId: 'A',
        datasource: { uid: datasourceUid, type: datasourceType },
        maxDataPoints: DATA_CHECK_QUERY_LIMITS.maxDataPoints,
        intervalMs: QUERY_INTERVAL.intervalMs,
        ...buildQueryModel(datasourceType, query),
      },
    ],
  };

  try {
    if (timeoutController.signal.aborted) {
      throw new Error(CANCELLED);
    }
    // Unsubscribing is what cancels the in-flight request, so the abort has to end the subscription.
    const response = await lastValueFrom(
      defer(() => getDataSourceApi(datasourceUid)).pipe(
        switchMap((ds) => fromInput(ds.query(dsRequest))),
        takeUntil(fromEvent(timeoutController.signal, 'abort'))
      ),
      { defaultValue: undefined }
    );
    if (timeoutController.signal.aborted) {
      throw new Error(CANCELLED);
    }

    const error = response ? responseError(response) : undefined;
    if (error) {
      return { ok: false, error, failureKind: 'query' };
    }

    const { seriesCount, rowCount } = countRows(response?.data ?? []);
    return { ok: true, hasData: rowCount > 0, seriesCount, rowCount };
  } catch (err) {
    if (timeoutController.signal.aborted && !signal?.aborted) {
      return {
        ok: false,
        error: `Query timed out after ${DATA_CHECK_QUERY_LIMITS.timeoutMs / 1000}s.`,
        failureKind: 'timeout',
      };
    }
    logger.debug('[runDataCheckQuery] query failed', { datasourceType, error: err });
    return { ok: false, error: describeError(err), failureKind: 'query' };
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onCallerAbort);
  }
}
