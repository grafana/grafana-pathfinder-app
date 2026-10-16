import { getBackendSrv } from '@grafana/runtime';
import type { DataSource, Plugin, DashboardSearchResult } from '../types/context.types';
import { logger } from './logging';

export const DATA_SOURCES_FRESH_MS = 2000;
let dataSourcesRequest: { promise: Promise<DataSource[]>; settledAt?: number } | undefined;

export function resetDataSourcesCacheForTests(): void {
  dataSourcesRequest = undefined;
}

function requestDataSources(): Promise<DataSource[]> {
  const current = dataSourcesRequest;
  if (current && (current.settledAt === undefined || Date.now() - current.settledAt < DATA_SOURCES_FRESH_MS)) {
    return current.promise;
  }
  const request: { promise: Promise<DataSource[]>; settledAt?: number } = {
    promise: Promise.resolve(getBackendSrv().get('/api/datasources')).then((dataSources) => dataSources || []),
  };
  const settle = () => {
    request.settledAt = Date.now();
  };
  request.promise.then(settle, settle);
  dataSourcesRequest = request;
  return request.promise;
}

export async function fetchDataSources(options: { throwOnError?: boolean } = {}): Promise<DataSource[]> {
  try {
    return await requestDataSources();
  } catch (error) {
    if (options.throwOnError) {
      throw error;
    }
    logger.warn('Failed to fetch data sources', { error });
    return [];
  }
}

export async function fetchPlugins(options: { throwOnError?: boolean } = {}): Promise<Plugin[]> {
  try {
    const plugins = await getBackendSrv().get('/api/plugins');
    return plugins || [];
  } catch (error) {
    if (options.throwOnError) {
      throw error;
    }
    logger.warn('Failed to fetch plugins', { error });
    return [];
  }
}

export async function fetchDashboardsByName(
  name: string,
  options: { throwOnError?: boolean } = {}
): Promise<DashboardSearchResult[]> {
  try {
    const dashboards = await getBackendSrv().get('/api/search', {
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
