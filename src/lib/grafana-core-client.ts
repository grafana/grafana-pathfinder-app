import { getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';

import { PLUGIN_BACKEND_URL } from '../constants';

/**
 * Per-user reads of Grafana core resources through the plugin backend, which
 * calls the namespace-scoped App Platform API on the caller's behalf. Every
 * read resolves to `undefined` when the proxy cannot answer, so the caller can
 * fall back to the single-tenant endpoint. A stack with no on-behalf-of
 * credential (self-hosted Grafana) answers `proxy-unavailable` on every route,
 * so after the first such answer this session stops asking.
 *
 * @coupling API: GET /grafana/* served by pkg/plugin/grafana_core_reads.go
 */

export interface CoreUser {
  role?: string;
  grafanaAdmin?: boolean;
}

export interface CoreDashboardSummary {
  uid: string;
  title?: string;
  tags: string[];
  folderUid?: string;
  folderTitle?: string;
}

export interface CoreDashboardHit {
  uid: string;
  title: string;
  folderUid?: string;
  tags: string[];
}

let proxyUnavailable = false;

export function resetCoreProxyAvailabilityForTests(): void {
  proxyUnavailable = false;
}

async function proxyGet<T>(route: string, params?: Record<string, string>): Promise<T | undefined> {
  if (proxyUnavailable) {
    return undefined;
  }
  try {
    const response = await lastValueFrom(
      getBackendSrv().fetch<T>({
        url: `${PLUGIN_BACKEND_URL}/grafana/${route}`,
        method: 'GET',
        params,
        showErrorAlert: false,
        showSuccessAlert: false,
      })
    );
    return response.data;
  } catch (err) {
    const reason = (err as { data?: { diagnostics?: { reason?: unknown } } } | null)?.data?.diagnostics?.reason;
    if (reason === 'proxy-unavailable') {
      proxyUnavailable = true;
    }
    return undefined;
  }
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export async function fetchCoreUser(): Promise<CoreUser | undefined> {
  const body = await proxyGet<Record<string, unknown>>('user');
  if (!body || typeof body !== 'object') {
    return undefined;
  }
  const spec = (body.spec && typeof body.spec === 'object' ? body.spec : body) as Record<string, unknown>;
  const role = stringOrUndefined(spec.role);
  if (!role) {
    return undefined;
  }
  return { role, grafanaAdmin: spec.grafanaAdmin === true };
}

export async function fetchCoreDashboard(uid: string): Promise<CoreDashboardSummary | undefined> {
  const body = await proxyGet<Record<string, unknown>>('dashboard', { uid });
  const responseUid = stringOrUndefined(body?.uid);
  if (!body || !responseUid) {
    return undefined;
  }
  return {
    uid: responseUid,
    title: stringOrUndefined(body.title),
    tags: stringArray(body.tags),
    folderUid: stringOrUndefined(body.folderUid),
    folderTitle: stringOrUndefined(body.folderTitle),
  };
}

export async function searchCoreDashboards(query: string): Promise<CoreDashboardHit[] | undefined> {
  const body = await proxyGet<{ hits?: unknown }>('dashboard-search', { query });
  if (!body || !Array.isArray(body.hits)) {
    return undefined;
  }
  return body.hits.flatMap((hit) => {
    const raw = (hit ?? {}) as Record<string, unknown>;
    const uid = stringOrUndefined(raw.uid);
    if (!uid) {
      return [];
    }
    return [
      {
        uid,
        title: stringOrUndefined(raw.title) ?? '',
        folderUid: stringOrUndefined(raw.folderUid),
        tags: stringArray(raw.tags),
      },
    ];
  });
}
