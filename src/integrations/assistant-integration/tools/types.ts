/**
 * Shared types for Assistant integration tools
 *
 * These types define the artifacts and options used by custom tools
 * that extend the inline assistant's capabilities.
 */

import type { DataSourceInstanceSettings } from '@grafana/data';

/**
 * Simplified datasource info for artifacts
 */
export interface DatasourceInfo {
  uid: string;
  name: string;
  type: string;
}

/**
 * Prometheus/Loki specific metadata
 */
export interface MetricsMetadata {
  labels: Record<string, string[]>;
  metrics: string[];
}

/**
 * Tempo specific metadata
 */
export interface TracingMetadata {
  services: string[];
  operations: string[];
  tags: string[];
}

/**
 * Pyroscope specific metadata
 */
export interface ProfilingMetadata {
  profileTypes: string[];
  labels: Record<string, string[]>;
}

/**
 * Combined metadata type for all datasource types
 */
export interface DatasourceMetadata {
  // Prometheus/Loki
  labels?: Record<string, string[]>;
  metrics?: string[];
  // Tempo
  services?: string[];
  operations?: string[];
  tags?: string[];
  // Pyroscope
  profileTypes?: string[];
}

/**
 * Artifact returned by the unified datasource metadata tool
 */
export interface DatasourceMetadataArtifact {
  datasource: DatasourceInfo;
  metadata: DatasourceMetadata;
  /** Human-readable description of what was fetched */
  summary: string;
}

/**
 * Artifact returned by the Grafana context tool
 */
export interface GrafanaContextArtifact {
  // Current location
  currentPath: string;
  currentUrl: string;
  searchParams: Record<string, string>;

  // Environment
  grafanaVersion: string;
  platform: 'cloud' | 'oss';
  theme: 'dark' | 'light';

  // Available resources
  datasources: DatasourceInfo[];

  // Current context (if applicable)
  dashboard?: {
    uid: string;
    title: string;
    folder?: string;
  };
  activeDatasourceType?: string;
  activeVisualizationType?: string;

  // User context
  userRole: string;
}

/**
 * Supported datasource types for metadata fetching
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
