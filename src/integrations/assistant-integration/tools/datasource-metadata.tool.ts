/**
 * Unified Datasource Metadata Tool
 *
 * A custom tool for the inline assistant that fetches metadata from
 * supported datasource types (Prometheus, Loki, Tempo, Pyroscope).
 *
 * Auto-detects the datasource type and returns appropriate metadata.
 */

import {
  createTool,
  type InlineToolRunnable,
  type ToolInvokeOptions,
  type ToolOutput,
  type JSONSchema,
} from '@grafana/assistant';
import { getDataSourceSrv } from '@grafana/runtime';
import type { DataSourceInstanceSettings } from '@grafana/data';

import {
  type DatasourceMetadataArtifact,
  type DatasourceMetadata,
  getNormalizedDatasourceType,
  filterSupportedDatasources,
} from './types';
import { fetchPrometheusMetadata } from './utils/prometheus.utils';
import { fetchLokiMetadata } from './utils/loki.utils';
import { fetchTempoMetadata } from './utils/tempo.utils';
import { fetchPyroscopeMetadata } from './utils/pyroscope.utils';

/**
 * Tool input schema
 */
interface ToolInput {
  datasourceUid?: string;
  datasourceType?: string;
}

const toolInputSchema: JSONSchema = {
  type: 'object',
  properties: {
    datasourceUid: {
      type: 'string',
      description: 'Optional UID of a specific datasource to query. If not provided, uses first matching datasource.',
    },
    datasourceType: {
      type: 'string',
      description:
        'Optional datasource type to filter by (prometheus, loki, tempo, pyroscope). If not provided, uses first supported datasource.',
      enum: ['prometheus', 'loki', 'tempo', 'pyroscope'],
    },
  },
  additionalProperties: false,
};

/**
 * Validate tool input
 */
const validateInput = (input: unknown): ToolInput => {
  if (typeof input !== 'object' || input === null) {
    return {};
  }
  const obj = input as Record<string, unknown>;
  return {
    datasourceUid: typeof obj.datasourceUid === 'string' ? obj.datasourceUid : undefined,
    datasourceType: typeof obj.datasourceType === 'string' ? obj.datasourceType : undefined,
  };
};

/**
 * Find the best matching datasource based on input parameters
 */
const findDatasource = (
  datasources: DataSourceInstanceSettings[],
  input: ToolInput
): DataSourceInstanceSettings | null => {
  // If specific UID provided, find that datasource
  if (input.datasourceUid) {
    return datasources.find((ds) => ds.uid === input.datasourceUid) || null;
  }

  // Filter to supported datasources
  const supported = filterSupportedDatasources(datasources);

  if (supported.length === 0) {
    return null;
  }

  // If type filter provided, find first matching type
  if (input.datasourceType) {
    const normalizedInput = input.datasourceType.toLowerCase();
    return (
      supported.find((ds) => {
        const normalizedType = getNormalizedDatasourceType(ds.type);
        return normalizedType === normalizedInput;
      }) || null
    );
  }

  // Return first supported datasource
  return supported[0];
};

/**
 * Fetch metadata based on datasource type
 * Note: We use 'any' cast for the datasource because @grafana/runtime returns a type
 * that's incompatible with @grafana/data's DataSourceApi due to nested type differences.
 * This is a known issue with Grafana's package structure.
 */
const fetchMetadataForDatasource = async (
  dsSettings: DataSourceInstanceSettings
): Promise<{ metadata: DatasourceMetadata; summary: string }> => {
  const ds = (await getDataSourceSrv().get(dsSettings.uid)) as any;
  const normalizedType = getNormalizedDatasourceType(dsSettings.type);

  switch (normalizedType) {
    case 'prometheus': {
      const data = await fetchPrometheusMetadata(ds);
      const labelCount = Object.keys(data.labels).length;
      const metricsCount = data.metrics.length;
      return {
        metadata: { labels: data.labels, metrics: data.metrics },
        summary: `Found ${labelCount} labels and ${metricsCount} metrics`,
      };
    }

    case 'loki': {
      const data = await fetchLokiMetadata(ds);
      const labelCount = Object.keys(data.labels).length;
      return {
        metadata: { labels: data.labels },
        summary: `Found ${labelCount} labels for log streams`,
      };
    }

    case 'tempo': {
      const data = await fetchTempoMetadata(ds);
      return {
        metadata: {
          services: data.services,
          operations: data.operations,
          tags: data.tags,
        },
        summary: `Found ${data.services.length} services, ${data.operations.length} operations, and ${data.tags.length} tags`,
      };
    }

    case 'pyroscope': {
      const data = await fetchPyroscopeMetadata(ds);
      const labelCount = Object.keys(data.labels).length;
      return {
        metadata: {
          profileTypes: data.profileTypes,
          labels: data.labels,
        },
        summary: `Found ${data.profileTypes.length} profile types and ${labelCount} labels`,
      };
    }

    default:
      throw new Error(`Unsupported datasource type: ${dsSettings.type}`);
  }
};

/**
 * Format metadata for human-readable output
 */
const formatMetadataForDisplay = (
  dsSettings: DataSourceInstanceSettings,
  metadata: DatasourceMetadata,
  summary: string
): string => {
  const normalizedType = getNormalizedDatasourceType(dsSettings.type);
  const lines: string[] = [];

  lines.push(`Datasource: ${dsSettings.name} (${normalizedType})`);
  lines.push(`${summary}\n`);

  // Format based on type
  if (metadata.labels && Object.keys(metadata.labels).length > 0) {
    lines.push('Labels:');
    for (const [label, values] of Object.entries(metadata.labels)) {
      const valueStr = values.slice(0, 5).join(', ') + (values.length > 5 ? '...' : '');
      lines.push(`  - ${label}: ${valueStr}`);
    }
  }

  if (metadata.metrics && metadata.metrics.length > 0) {
    lines.push('\nMetrics (sample):');
    lines.push(`  ${metadata.metrics.slice(0, 10).join(', ')}${metadata.metrics.length > 10 ? '...' : ''}`);
  }

  if (metadata.services && metadata.services.length > 0) {
    lines.push('\nServices:');
    lines.push(`  ${metadata.services.slice(0, 10).join(', ')}${metadata.services.length > 10 ? '...' : ''}`);
  }

  if (metadata.operations && metadata.operations.length > 0) {
    lines.push('\nOperations:');
    lines.push(`  ${metadata.operations.slice(0, 10).join(', ')}${metadata.operations.length > 10 ? '...' : ''}`);
  }

  if (metadata.tags && metadata.tags.length > 0) {
    lines.push('\nTags:');
    lines.push(`  ${metadata.tags.slice(0, 15).join(', ')}${metadata.tags.length > 15 ? '...' : ''}`);
  }

  if (metadata.profileTypes && metadata.profileTypes.length > 0) {
    lines.push('\nProfile Types:');
    lines.push(`  ${metadata.profileTypes.slice(0, 10).join(', ')}${metadata.profileTypes.length > 10 ? '...' : ''}`);
  }

  return lines.join('\n');
};

/**
 * Creates a datasource metadata tool that fetches metadata from supported datasources.
 *
 * @param onArtifact - Optional callback to receive the structured artifact data
 * @returns An InlineToolRunnable that can be passed to useInlineAssistant
 *
 * @example
 * ```tsx
 * const [metadata, setMetadata] = useState<DatasourceMetadataArtifact | null>(null);
 * const gen = useInlineAssistant();
 *
 * gen.generate({
 *   prompt: 'Generate a query using real data from my datasources',
 *   tools: [createDatasourceMetadataTool((data) => setMetadata(data))],
 * });
 * ```
 */
export const createDatasourceMetadataTool = (
  onArtifact?: (artifact: DatasourceMetadataArtifact) => void
): InlineToolRunnable => {
  return createTool(
    async (input: ToolInput, _options: ToolInvokeOptions): Promise<ToolOutput> => {
      // Get all datasources
      const allDatasources = getDataSourceSrv().getList();

      // Find the target datasource
      const dsSettings = findDatasource(allDatasources, input);

      if (!dsSettings) {
        const supported = filterSupportedDatasources(allDatasources);
        if (supported.length === 0) {
          return 'No supported datasources found. Supported types: Prometheus, Loki, Tempo, Pyroscope.';
        }
        if (input.datasourceType) {
          return `No ${input.datasourceType} datasource found. Available types: ${supported.map((ds) => ds.type).join(', ')}`;
        }
        return 'Could not find the specified datasource.';
      }

      try {
        // Fetch metadata
        const { metadata, summary } = await fetchMetadataForDatasource(dsSettings);

        // Build artifact
        const artifact: DatasourceMetadataArtifact = {
          datasource: {
            uid: dsSettings.uid,
            name: dsSettings.name,
            type: dsSettings.type,
          },
          metadata,
          summary,
        };

        // Call callback if provided
        if (onArtifact) {
          onArtifact(artifact);
        }

        // Format for display
        const displayText = formatMetadataForDisplay(dsSettings, metadata, summary);

        return [displayText, artifact];
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        return `Failed to fetch metadata from ${dsSettings.name}: ${errorMessage}`;
      }
    },
    {
      name: 'fetch_datasource_metadata',
      description:
        "Fetches metadata (labels, metrics, services, tags, profile types) from Grafana datasources. Supports Prometheus, Loki, Tempo, and Pyroscope. Use this tool to discover what data is available in the user's environment for building queries or customizing configurations.",
      inputSchema: toolInputSchema,
      validate: validateInput,
      responseFormat: 'content_and_artifact',
    }
  );
};

/**
 * Pre-built tool instance for simple use cases
 */
export const datasourceMetadataTool = createDatasourceMetadataTool();
