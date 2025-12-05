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

  // Fetch metrics (via __name__ label)
  const metrics = await fetchLabelValues(ds, timeRange, '__name__', MAX_METRICS);

  return { labels, metrics };
};
