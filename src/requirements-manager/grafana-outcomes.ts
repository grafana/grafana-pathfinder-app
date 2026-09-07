import { logger } from '../lib/logging';
import { getBackendSrv } from '@grafana/runtime';
import { firstValueFrom, fromEvent, takeUntil, timeout } from 'rxjs';
import type { GuideOutcome } from '../types/outcome.types';
import type { CheckResultError } from '../types/requirements.types';

export interface OutcomeResource {
  uid: string;
  label: string;
}

export async function listOutcomeResources(
  outcome: GuideOutcome,
  signal: AbortSignal,
  query = ''
): Promise<OutcomeResource[]> {
  const url = new URL(
    outcome.kind === 'datasource-health' ? '/api/datasources' : '/api/search',
    window.location.origin
  );
  if (outcome.kind === 'dashboard-saved') {
    url.searchParams.set('type', 'dash-db');
    url.searchParams.set('limit', '100');
    url.searchParams.set('query', query);
  }
  if (signal.aborted) {
    return [];
  }
  const response = await firstValueFrom(
    getBackendSrv()
      .fetch<Array<{ uid: string; name?: string; title?: string; type?: string }>>({
        url: `${url.pathname}${url.search}`,
        method: 'GET',
        showErrorAlert: false,
      })
      .pipe(timeout(10000), takeUntil(fromEvent(signal, 'abort')))
  );
  return response.data
    .filter(
      (item) =>
        typeof item.uid === 'string' &&
        (outcome.kind !== 'datasource-health' || !outcome.datasourceType || item.type === outcome.datasourceType)
    )
    .map((item) => ({ uid: item.uid, label: item.name || item.title || item.uid }));
}

export async function verifyGrafanaOutcome(
  outcome: GuideOutcome,
  resourceUid: string,
  signal: AbortSignal
): Promise<CheckResultError> {
  const requirement = `${outcome.kind}:${resourceUid}`;
  if (!resourceUid || resourceUid.length > 128) {
    return { requirement, pass: false, verdict: 'invalid' };
  }
  if (signal.aborted) {
    return { requirement, pass: false, verdict: 'unavailable' };
  }
  const path =
    outcome.kind === 'datasource-health'
      ? `/api/datasources/uid/${encodeURIComponent(resourceUid)}/health`
      : `/api/dashboards/uid/${encodeURIComponent(resourceUid)}`;
  try {
    const response = await firstValueFrom(
      getBackendSrv()
        .fetch<{ status?: string; dashboard?: { uid?: string } }>({
          url: path,
          method: 'GET',
          showErrorAlert: false,
        })
        .pipe(timeout(10000), takeUntil(fromEvent(signal, 'abort')))
    );
    const pass =
      outcome.kind === 'datasource-health'
        ? response.data.status === 'OK'
        : response.data.dashboard?.uid === resourceUid;
    return { requirement, pass, verdict: pass ? 'satisfied' : 'unsatisfied' };
  } catch (error) {
    const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
    const unmet = status === 404 || (outcome.kind === 'datasource-health' && status === 400);
    if (!unmet) {
      logger.warn('Outcome verification unavailable', {
        kind: outcome.kind,
        status: typeof status === 'number' ? status : undefined,
      });
    }
    return { requirement, pass: false, verdict: unmet ? 'unsatisfied' : 'unavailable' };
  }
}
