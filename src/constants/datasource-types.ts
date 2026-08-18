/**
 * Lives at tier 0 so both the assistant tools (tier 3) and the data-check query
 * executor (tier 1) can reach it.
 */

import type { DataSourceInstanceSettings } from '@grafana/data';

export type SupportedDatasourceType = 'prometheus' | 'loki' | 'tempo' | 'pyroscope';

export const DATASOURCE_TYPE_MAP: Record<string, SupportedDatasourceType> = {
  prometheus: 'prometheus',
  'grafana-amazonprometheus-datasource': 'prometheus',
  'grafana-prometheusmetrics-datasource': 'prometheus',
  loki: 'loki',
  tempo: 'tempo',
  pyroscope: 'pyroscope',
  'grafana-pyroscope-datasource': 'pyroscope',
};

export const isSupportedDatasourceType = (type: string): boolean => {
  return type in DATASOURCE_TYPE_MAP;
};

export const getNormalizedDatasourceType = (type: string): SupportedDatasourceType | null => {
  return DATASOURCE_TYPE_MAP[type] || null;
};

export const filterSupportedDatasources = (datasources: DataSourceInstanceSettings[]): DataSourceInstanceSettings[] => {
  return datasources.filter((ds) => isSupportedDatasourceType(ds.type));
};
