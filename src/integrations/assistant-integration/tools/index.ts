/**
 * Assistant Integration Tools
 *
 * Custom tools that extend the inline assistant's capabilities
 * for fetching datasource metadata and Grafana context.
 *
 * @example
 * ```tsx
 * import { createDatasourceMetadataTool, createGrafanaContextTool } from './tools';
 *
 * const gen = useInlineAssistant();
 *
 * gen.generate({
 *   prompt: 'Customize this query using real data from my environment',
 *   tools: [
 *     createDatasourceMetadataTool((artifact) => console.log('[pathfinder]', artifact)),
 *     createGrafanaContextTool(),
 *   ],
 * });
 * ```
 */

// Types
export type {
  DatasourceInfo,
  MetricsMetadata,
  TracingMetadata,
  ProfilingMetadata,
  DatasourceMetadata,
  DatasourceMetadataArtifact,
  GrafanaContextArtifact,
  SupportedDatasourceType,
} from './types';

export {
  DATASOURCE_TYPE_MAP,
  isSupportedDatasourceType,
  getNormalizedDatasourceType,
  filterSupportedDatasources,
} from './types';

// Tools (will be added as they are implemented)
export { createDatasourceMetadataTool, datasourceMetadataTool } from './datasource-metadata.tool';
export { createGrafanaContextTool, grafanaContextTool } from './grafana-context.tool';

// Datasource utils (for advanced use cases)
export { fetchPrometheusMetadata } from './utils/prometheus.utils';
export { fetchLokiMetadata } from './utils/loki.utils';
export { fetchTempoMetadata } from './utils/tempo.utils';
export { fetchPyroscopeMetadata } from './utils/pyroscope.utils';
