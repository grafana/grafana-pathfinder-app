import { getBackendSrv } from '@grafana/runtime';
import type { DataSource, Plugin, DashboardSearchResult } from '../types/context.types';
import { logger } from './logging';

export async function fetchDataSources(options: { throwOnError?: boolean } = {}): Promise<DataSource[]> {
  try {
    const dataSources = await getBackendSrv().get('/api/datasources');
    return dataSources || [];
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
