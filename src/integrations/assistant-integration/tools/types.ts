/**
 * Shared types for Assistant integration tools
 *
 * These types define the artifacts and options used by custom tools
 * that extend the inline assistant's capabilities.
 */

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
 * Re-exported from tier 0 so tier-1 consumers (the data-check query executor)
 * can reach them without importing this tier-3 module.
 */
export {
  DATASOURCE_TYPE_MAP,
  filterSupportedDatasources,
  getNormalizedDatasourceType,
  isSupportedDatasourceType,
  type SupportedDatasourceType,
} from '../../../constants/datasource-types';
