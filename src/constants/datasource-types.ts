/**
 * Data source type normalization shared by the assistant tools (tier 3) and
 * the data-check query executor (tier 1). Lives at tier 0 so both can reach it.
 */

import type { DataSourceInstanceSettings } from '@grafana/data';

/**
 * Supported datasource types for metadata fetching and data checks
 */
export type SupportedDatasourceType = 'prometheus' | 'loki' | 'tempo' | 'pyroscope';

/**
 * Map of datasource plugin IDs to their normalized type
 */
export const DATASOURCE_TYPE_MAP: Record<string, SupportedDatasourceType> = {
  // Prometheus variants
  prometheus: 'prometheus',
  'grafana-amazonprometheus-datasource': 'prometheus',
  'grafana-prometheusmetrics-datasource': 'prometheus',
  // Loki
  loki: 'loki',
  // Tempo
  tempo: 'tempo',
  // Pyroscope
  pyroscope: 'pyroscope',
  'grafana-pyroscope-datasource': 'pyroscope',
};

/**
 * Check if a datasource type is supported for metadata fetching
 */
export const isSupportedDatasourceType = (type: string): boolean => {
  return type in DATASOURCE_TYPE_MAP;
};

/**
 * Get the normalized datasource type
 */
export const getNormalizedDatasourceType = (type: string): SupportedDatasourceType | null => {
  return DATASOURCE_TYPE_MAP[type] || null;
};

/**
 * Filter datasources to only supported types
 */
export const filterSupportedDatasources = (datasources: DataSourceInstanceSettings[]): DataSourceInstanceSettings[] => {
  return datasources.filter((ds) => isSupportedDatasourceType(ds.type));
};
