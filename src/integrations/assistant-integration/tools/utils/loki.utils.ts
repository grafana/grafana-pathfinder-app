/**
 * Loki Metadata Utilities
 *
 * Fetches labels from Loki datasources.
 * Loki uses a similar label-based system to Prometheus.
 */

import type { DataSourceApi } from '@grafana/data';
import type { MetricsMetadata } from '../types';

/**
 * Loki datasource with language provider
 */
interface LokiLanguageProvider {
  getLabelKeys?(): Promise<string[]>;
  fetchLabelValues?(labelName: string): Promise<string[]>;
  fetchLabels?(): Promise<string[]>;
  getLabelValues?(labelName: string): Promise<string[]>;
}

interface LokiDatasource extends DataSourceApi {
  languageProvider: LokiLanguageProvider;
}

/**
 * Check if a datasource has a Loki-compatible language provider
 */
export const hasLokiLanguageProvider = (ds: DataSourceApi): ds is LokiDatasource => {
  const lds = ds as LokiDatasource;
  return lds.languageProvider !== undefined;
};

/**
 * Priority labels to fetch values for (common useful labels)
 */
const PRIORITY_LABELS = ['app', 'namespace', 'pod', 'container', 'job', 'instance', 'level', 'env', 'service'];

/**
 * Maximum number of label values to fetch per label
 */
const MAX_LABEL_VALUES = 20;

/**
 * Fetch label names from Loki
 */
const fetchLabelNames = async (ds: LokiDatasource): Promise<string[]> => {
  try {
    const lp = ds.languageProvider;

    // Try different methods as the API varies between Grafana versions
    if (typeof lp.getLabelKeys === 'function') {
      return await lp.getLabelKeys();
    }

    if (typeof lp.fetchLabels === 'function') {
      return await lp.fetchLabels();
    }

    console.warn('[pathfinder]', '[LokiUtils] No suitable method found to fetch label names');
    return [];
  } catch (error) {
    console.warn('[pathfinder]', '[LokiUtils] Failed to fetch label names:', error);
    return [];
  }
};

/**
 * Fetch values for a specific label
 */
const fetchLabelValues = async (ds: LokiDatasource, labelName: string, limit = MAX_LABEL_VALUES): Promise<string[]> => {
  try {
    const lp = ds.languageProvider;

    // Try different methods as the API varies between Grafana versions
    if (typeof lp.fetchLabelValues === 'function') {
      const values = await lp.fetchLabelValues(labelName);
      return Array.isArray(values) ? values.slice(0, limit) : [];
    }

    if (typeof lp.getLabelValues === 'function') {
      const values = await lp.getLabelValues(labelName);
      return Array.isArray(values) ? values.slice(0, limit) : [];
    }

    console.warn('[pathfinder]', '[LokiUtils] No suitable method found to fetch label values');
    return [];
  } catch (error) {
    console.warn('[pathfinder]', `[LokiUtils] Failed to fetch values for label ${labelName}:`, error);
    return [];
  }
};

/**
 * Fetch metadata from a Loki datasource
 *
 * @param ds - The Loki datasource instance
 * @returns Metadata including labels and their values
 */
export const fetchLokiMetadata = async (ds: DataSourceApi): Promise<MetricsMetadata> => {
  if (!hasLokiLanguageProvider(ds)) {
    throw new Error(`Datasource ${ds.name} does not have a Loki-compatible language provider`);
  }

  // Fetch all label names
  const allLabels = await fetchLabelNames(ds);

  if (allLabels.length === 0) {
    return { labels: {}, metrics: [] };
  }

  // Filter out internal labels
  const filteredLabels = allLabels.filter((label) => !label.startsWith('__'));

  // Sort labels: priority labels first, then alphabetically
  const sortedLabels = [
    ...PRIORITY_LABELS.filter((l) => filteredLabels.includes(l)),
    ...filteredLabels.filter((l) => !PRIORITY_LABELS.includes(l)).sort(),
  ].slice(0, 15); // Limit to 15 labels

  // Fetch values for each selected label in parallel
  const labelEntries = await Promise.all(
    sortedLabels.map(async (label) => {
      const values = await fetchLabelValues(ds, label);
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

  // Loki doesn't have metrics like Prometheus, return empty array
  return { labels, metrics: [] };
};
