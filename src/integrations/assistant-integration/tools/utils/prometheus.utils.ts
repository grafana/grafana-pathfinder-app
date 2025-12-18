/**
 * Prometheus Metadata Utilities
 *
 * Fetches labels and metrics from Prometheus-compatible datasources
 * including Amazon Managed Prometheus.
 */

import { getDefaultTimeRange, type DataSourceApi, type TimeRange } from '@grafana/data';
import type { MetricsMetadata } from '../types';

/**
 * Prometheus datasource with language provider
 */
interface PrometheusLanguageProvider {
  queryLabelKeys(timeRange: TimeRange): Promise<string[]>;
  queryLabelValues(timeRange: TimeRange, labelName: string): Promise<string[]>;
}

interface PrometheusDatasource extends DataSourceApi {
  languageProvider: PrometheusLanguageProvider;
}

/**
 * Check if a datasource has a Prometheus-compatible language provider
 */
export const hasPrometheusLanguageProvider = (ds: DataSourceApi): ds is PrometheusDatasource => {
  const pds = ds as PrometheusDatasource;
  return (
    pds.languageProvider !== undefined &&
    typeof pds.languageProvider.queryLabelKeys === 'function' &&
    typeof pds.languageProvider.queryLabelValues === 'function'
  );
};

/**
 * Priority labels to fetch values for (common useful labels)
 */
const PRIORITY_LABELS = ['job', 'instance', 'namespace', 'pod', 'service', 'container', 'env', 'cluster', 'app'];

/**
 * Maximum number of label values to fetch per label
 */
const MAX_LABEL_VALUES = 20;

/**
 * Maximum number of metrics to return
 */
const MAX_METRICS = 30;

/**
 * Common metric suffixes that indicate standard Prometheus metrics
 * These are preferred over recording rules (which contain colons)
 */
const COMMON_METRIC_SUFFIXES = ['_total', '_count', '_sum', '_bucket', '_seconds', '_bytes', '_info', '_created'];

/**
 * Well-known base metrics that are commonly available
 */
const WELL_KNOWN_METRICS = [
  'up',
  'process_cpu_seconds_total',
  'process_resident_memory_bytes',
  'go_goroutines',
  'go_gc_duration_seconds',
  'prometheus_http_requests_total',
  'http_requests_total',
  'http_request_duration_seconds',
  'node_cpu_seconds_total',
  'container_cpu_usage_seconds_total',
];

/**
 * Sort metrics to prioritize common/standard metrics over recording rules
 * Recording rules contain colons (e.g., "job:http_requests:rate5m")
 */
const sortMetricsByPriority = (metrics: string[]): string[] => {
  return metrics.sort((a, b) => {
    // Well-known metrics first
    const aWellKnown = WELL_KNOWN_METRICS.includes(a);
    const bWellKnown = WELL_KNOWN_METRICS.includes(b);
    if (aWellKnown && !bWellKnown) {
      return -1;
    }
    if (bWellKnown && !aWellKnown) {
      return 1;
    }

    // Recording rules (with colons) go last
    const aHasColon = a.includes(':');
    const bHasColon = b.includes(':');
    if (!aHasColon && bHasColon) {
      return -1;
    }
    if (aHasColon && !bHasColon) {
      return 1;
    }

    // Metrics with common suffixes preferred
    const aHasCommonSuffix = COMMON_METRIC_SUFFIXES.some((s) => a.endsWith(s));
    const bHasCommonSuffix = COMMON_METRIC_SUFFIXES.some((s) => b.endsWith(s));
    if (aHasCommonSuffix && !bHasCommonSuffix) {
      return -1;
    }
    if (bHasCommonSuffix && !aHasCommonSuffix) {
      return 1;
    }

    // Shorter names typically more common
    if (a.length !== b.length) {
      return a.length - b.length;
    }

    // Alphabetical as tiebreaker
    return a.localeCompare(b);
  });
};

/**
 * Fetch label names from Prometheus
 */
const fetchLabelNames = async (ds: PrometheusDatasource, timeRange: TimeRange): Promise<string[]> => {
  try {
    const labels = await ds.languageProvider.queryLabelKeys(timeRange);
    // Filter out internal labels (starting with __)
    return labels.filter((label) => !label.startsWith('__'));
  } catch (error) {
    console.warn('[PrometheusUtils] Failed to fetch label names:', error);
    return [];
  }
};

/**
 * Fetch values for a specific label
 */
const fetchLabelValues = async (
  ds: PrometheusDatasource,
  timeRange: TimeRange,
  labelName: string,
  limit = MAX_LABEL_VALUES
): Promise<string[]> => {
  try {
    const values = await ds.languageProvider.queryLabelValues(timeRange, labelName);
    return Array.isArray(values) ? values.slice(0, limit) : [];
  } catch (error) {
    console.warn(`[PrometheusUtils] Failed to fetch values for label ${labelName}:`, error);
    return [];
  }
};

/**
 * Fetch metadata from a Prometheus datasource
 *
 * @param ds - The Prometheus datasource instance
 * @returns Metadata including labels and their values, plus available metrics
 */
export const fetchPrometheusMetadata = async (ds: DataSourceApi): Promise<MetricsMetadata> => {
  if (!hasPrometheusLanguageProvider(ds)) {
    throw new Error(`Datasource ${ds.name} does not have a Prometheus-compatible language provider`);
  }

  const timeRange = getDefaultTimeRange();

  // Fetch all label names
  const allLabels = await fetchLabelNames(ds, timeRange);

  if (allLabels.length === 0) {
    return { labels: {}, metrics: [] };
  }

  // Sort labels: priority labels first, then alphabetically
  const sortedLabels = [
    ...PRIORITY_LABELS.filter((l) => allLabels.includes(l)),
    ...allLabels.filter((l) => !PRIORITY_LABELS.includes(l)).sort(),
  ].slice(0, 15); // Limit to 15 labels

  // Fetch values for each selected label in parallel
  const labelEntries = await Promise.all(
    sortedLabels.map(async (label) => {
      const values = await fetchLabelValues(ds, timeRange, label);
      return [label, values] as const;
    })
  );

  // Build labels object, filtering out empty labels
  const labels: Record<string, string[]> = {};
  for (const [label, values] of labelEntries) {
    if (values.length > 0) {
      labels[label] = values;
    }
  }

  // Fetch metrics (via __name__ label) - get more than we need so we can sort
  const allMetrics = await fetchLabelValues(ds, timeRange, '__name__', MAX_METRICS * 3);

  // Sort by priority (standard metrics first, recording rules last)
  const sortedMetrics = sortMetricsByPriority(allMetrics).slice(0, MAX_METRICS);

  return { labels, metrics: sortedMetrics };
};
