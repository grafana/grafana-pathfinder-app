/**
 * Query execution for data-check steps.
 *
 * The only place in the plugin that runs a data source query. Both check paths
 * go through it — the author's query on the `query` path, and the assistant's
 * composed queries on the `ai` path — so the cost caps below are enforced once.
 */

import { getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';
import type { SupportedDatasourceType } from '../../constants/datasource-types';
import { logger } from '../logging';

/** Caps applied to every data-check query regardless of caller. */
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

export type DataCheckQueryResult =
  { ok: true; hasData: boolean; seriesCount: number; rowCount: number } | { ok: false; error: string };

/** Shape of the `/api/ds/query` response we actually read. */
interface DsQueryFrame {
  schema?: { fields?: Array<{ name?: string }> };
  data?: { values?: unknown[][] };
}
interface DsQueryResponse {
  results?: Record<string, { frames?: DsQueryFrame[]; error?: string; status?: number }>;
}

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
      return { expr: query, queryType: 'range' };
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
function countRows(frames: DsQueryFrame[]): { seriesCount: number; rowCount: number } {
  let rowCount = 0;
  let seriesCount = 0;
  for (const frame of frames) {
    const columns = frame.data?.values ?? [];
    const rows = columns.reduce((max, column) => Math.max(max, column?.length ?? 0), 0);
    if (rows > 0) {
      seriesCount += 1;
      rowCount += rows;
    }
  }
  return { seriesCount, rowCount };
}

function describeError(err: unknown): string {
  const fetchErr = err as { status?: number; statusText?: string; data?: { message?: string; error?: string } };
  const backendMessage = fetchErr?.data?.message ?? fetchErr?.data?.error;
  if (backendMessage) {
    return backendMessage;
  }
  if (fetchErr?.status) {
    return `Query failed (HTTP ${fetchErr.status}${fetchErr.statusText ? ` ${fetchErr.statusText}` : ''}).`;
  }
  return err instanceof Error ? err.message : 'Query failed.';
}

/**
 * `BackendSrv` cancels an in-flight request whose id a later one reuses, so a
 * per-datasource id would let two concurrent checks abort each other.
 */
let requestSequence = 0;

/**
 * Run one query and report whether it returned any data.
 *
 * `showErrorAlert: false` keeps a failed check in the step rather than firing
 * Grafana's global error toast.
 */
export async function runDataCheckQuery(request: DataCheckQueryRequest): Promise<DataCheckQueryResult> {
  const { datasourceUid, datasourceType, query, from, to, signal } = request;

  if (!query.trim()) {
    return { ok: false, error: 'No query to run.' };
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

  try {
    const response = await lastValueFrom(
      getBackendSrv().fetch<DsQueryResponse>({
        url: '/api/ds/query',
        method: 'POST',
        showErrorAlert: false,
        abortSignal: timeoutController.signal,
        requestId: `pathfinder-data-check-${datasourceUid}-${requestSequence}`,
        data: {
          from: from || DATA_CHECK_QUERY_LIMITS.defaultFrom,
          to: to || DATA_CHECK_QUERY_LIMITS.defaultTo,
          queries: [
            {
              refId: 'A',
              datasource: { uid: datasourceUid, type: datasourceType },
              maxDataPoints: DATA_CHECK_QUERY_LIMITS.maxDataPoints,
              intervalMs: 60_000,
              ...buildQueryModel(datasourceType, query),
            },
          ],
        },
      })
    );

    const result = response.data?.results?.A;
    if (result?.error) {
      return { ok: false, error: result.error };
    }

    const { seriesCount, rowCount } = countRows(result?.frames ?? []);
    return { ok: true, hasData: rowCount > 0, seriesCount, rowCount };
  } catch (err) {
    if (timeoutController.signal.aborted && !signal?.aborted) {
      return { ok: false, error: `Query timed out after ${DATA_CHECK_QUERY_LIMITS.timeoutMs / 1000}s.` };
    }
    logger.debug('[runDataCheckQuery] query failed', { datasourceType, error: err });
    return { ok: false, error: describeError(err) };
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onCallerAbort);
  }
}
