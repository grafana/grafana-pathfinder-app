/**
 * Pyroscope Metadata Utilities
 *
 * Fetches profile types and labels from Pyroscope datasources.
 */

import { getBackendSrv } from '@grafana/runtime';
import type { DataSourceApi } from '@grafana/data';
import type { ProfilingMetadata } from '../types';

/**
 * Pyroscope datasource interface
 */
interface PyroscopeDatasource extends DataSourceApi {
  uid: string;
}

/**
 * Check if a datasource is Pyroscope
 */
export const isPyroscopeDataSource = (ds: DataSourceApi): ds is PyroscopeDatasource => {
  return ds.type === 'pyroscope' || ds.type === 'grafana-pyroscope-datasource';
};

/**
 * Maximum number of items to return per category
 */
const MAX_ITEMS = 30;

/**
 * Priority labels to fetch values for
 */
const PRIORITY_LABELS = ['service_name', 'namespace', 'pod', 'container', 'env', 'app'];

/**
 * Fetch available profile types from Pyroscope
 */
const fetchProfileTypes = async (ds: PyroscopeDatasource): Promise<string[]> => {
  try {
    const response = await getBackendSrv().get(`/api/datasources/uid/${ds.uid}/resources/profileTypes`);

    if (response && Array.isArray(response)) {
      // Profile types are usually objects with id and label
      return response
        .map((pt: { id?: string; label?: string; name?: string }) => pt.id || pt.label || pt.name || '')
        .filter(Boolean)
        .slice(0, MAX_ITEMS);
    }

    return [];
  } catch (error) {
    console.warn('[pathfinder]', '[PyroscopeUtils] Failed to fetch profile types:', error);
    return [];
  }
};

/**
 * Fetch available labels from Pyroscope
 */
const fetchLabels = async (ds: PyroscopeDatasource): Promise<string[]> => {
  try {
    const response = await getBackendSrv().get(`/api/datasources/uid/${ds.uid}/resources/labelNames`);

    if (response && Array.isArray(response)) {
      // Filter out private labels (starting with __)
      return response.filter((label: string) => !label.startsWith('__')).slice(0, MAX_ITEMS);
    }

    return [];
  } catch (error) {
    console.warn('[pathfinder]', '[PyroscopeUtils] Failed to fetch labels:', error);
    return [];
  }
};

/**
 * Fetch values for a specific label
 */
const fetchLabelValues = async (ds: PyroscopeDatasource, labelName: string): Promise<string[]> => {
  try {
    const response = await getBackendSrv().get(`/api/datasources/uid/${ds.uid}/resources/labelValues`, {
      label: labelName,
    });

    if (response && Array.isArray(response)) {
      return response.slice(0, MAX_ITEMS);
    }

    return [];
  } catch (error) {
    console.warn('[pathfinder]', `[PyroscopeUtils] Failed to fetch values for label ${labelName}:`, error);
    return [];
  }
};

/**
 * Fetch metadata from a Pyroscope datasource
 *
 * @param ds - The Pyroscope datasource instance
 * @returns Metadata including profile types and labels
 */
export const fetchPyroscopeMetadata = async (ds: DataSourceApi): Promise<ProfilingMetadata> => {
  if (!isPyroscopeDataSource(ds)) {
    throw new Error(`Datasource ${ds.name} is not a Pyroscope datasource`);
  }

  // Fetch profile types and labels in parallel
  const [profileTypes, allLabels] = await Promise.all([fetchProfileTypes(ds), fetchLabels(ds)]);

  // Sort labels: priority labels first, then alphabetically
  const sortedLabels = [
    ...PRIORITY_LABELS.filter((l) => allLabels.includes(l)),
    ...allLabels.filter((l) => !PRIORITY_LABELS.includes(l)).sort(),
  ].slice(0, 10); // Limit to 10 labels

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

  return { profileTypes, labels };
};
