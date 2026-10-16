import type { DataSourceInstanceSettings } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import * as runtimeUnstable from '@grafana/runtime/unstable';
import type { DataSource, DashboardInfo, DashboardSearchResult } from '../types/context.types';
import { getDataSourceSettings, listDataSources } from './datasource/datasource-registry';
import { fetchCoreDashboard, searchCoreDashboards } from './grafana-core-client';
import { logger } from './logging';
import { currentPlatform } from './platform';

function toDataSource(settings: DataSourceInstanceSettings): DataSource {
  return {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- context matching still resolves legacy numeric edit URLs
    id: settings.id,
    uid: settings.uid,
    name: settings.name,
    type: settings.type,
    url: settings.url,
    isDefault: settings.isDefault,
    access: settings.access,
  };
}

export async function fetchDataSources(options: { throwOnError?: boolean } = {}): Promise<DataSource[]> {
  try {
    const items = await listDataSources({ all: true, filter: (item) => !item.meta?.builtIn });
    const settings = await Promise.all(items.map((item) => getDataSourceSettings(item.uid)));
    return settings.flatMap((ds) => (ds ? [toDataSource(ds)] : []));
  } catch (error) {
    if (options.throwOnError) {
      throw error;
    }
    logger.warn('Failed to fetch data sources', { error });
    return [];
  }
}

export interface PluginPresence {
  installed: boolean;
  enabled: boolean;
}

function isNotFound(error: unknown): boolean {
  const err = error as { status?: number; cause?: { status?: number } } | null;
  return err?.status === 404 || err?.cause?.status === 404;
}

async function readPluginSettings(pluginId: string): Promise<{ enabled?: boolean }> {
  if (typeof runtimeUnstable.getPluginSettings === 'function') {
    return runtimeUnstable.getPluginSettings(pluginId, false);
  }
  if (currentPlatform() === 'cloud') {
    throw new Error('Plugin settings are unavailable');
  }
  return getBackendSrv().get(`/api/plugins/${encodeURIComponent(pluginId)}/settings`, undefined, undefined, {
    showErrorAlert: false,
  });
}

/** Rejects only when presence cannot be determined; an unknown plugin resolves as not installed. */
export async function fetchPluginPresence(pluginId: string): Promise<PluginPresence> {
  try {
    const settings = await readPluginSettings(pluginId);
    return { installed: true, enabled: settings?.enabled !== false };
  } catch (error) {
    if (isNotFound(error)) {
      return { installed: false, enabled: false };
    }
    throw error;
  }
}

export interface DashboardTitleMatch {
  uid: string;
  title: string;
}

export async function fetchDashboardsByName(
  name: string,
  options: { throwOnError?: boolean } = {}
): Promise<DashboardTitleMatch[]> {
  try {
    const proxied = await searchCoreDashboards(name);
    if (proxied) {
      return proxied;
    }
    if (currentPlatform() === 'cloud') {
      throw new Error('Dashboard search is unavailable');
    }
    const dashboards: DashboardSearchResult[] | undefined = await getBackendSrv().get('/api/search', {
      type: 'dash-db',
      limit: 100,
      deleted: false,
      query: name,
    });
    return dashboards || [];
  } catch (error) {
    if (options.throwOnError) {
      throw error;
    }
    logger.warn('Failed to fetch dashboards', { error });
    return [];
  }
}

interface LegacyDashboardResponse {
  dashboard?: { uid?: string; title?: string; tags?: string[] };
  meta?: { folderUid?: string; folderTitle?: string };
}

export async function fetchDashboardSummary(uid: string): Promise<DashboardInfo | null> {
  try {
    const proxied = await fetchCoreDashboard(uid);
    if (proxied) {
      return proxied;
    }
    if (currentPlatform() === 'cloud') {
      return null;
    }
    const legacy: LegacyDashboardResponse | undefined = await getBackendSrv().get(
      `/api/dashboards/uid/${encodeURIComponent(uid)}`
    );
    return {
      uid: legacy?.dashboard?.uid,
      title: legacy?.dashboard?.title,
      tags: legacy?.dashboard?.tags,
      folderUid: legacy?.meta?.folderUid,
      folderTitle: legacy?.meta?.folderTitle,
    };
  } catch (error) {
    logger.warn('Failed to fetch dashboard info', { error });
    return null;
  }
}
