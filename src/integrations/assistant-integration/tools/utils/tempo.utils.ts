import { warn } from '../../../../lib/logger';
/**
 * Tempo Metadata Utilities
 *
 * Fetches services, operations, and tags from Tempo datasources.
 */

import { getBackendSrv } from '@grafana/runtime';
import type { DataSourceApi } from '@grafana/data';
import type { TracingMetadata } from '../types';

/**
 * Tempo datasource interface
 */
interface TempoDatasource extends DataSourceApi {
  uid: string;
}

/**
 * Check if a datasource is Tempo
 */
export const isTempoDataSource = (ds: DataSourceApi): ds is TempoDatasource => {
  return ds.type === 'tempo';
};

/**
 * Maximum number of items to return per category
 */
const MAX_ITEMS = 30;

/**
 * Fetch available tags from Tempo
 * Uses the Tempo API via Grafana's backend proxy
 */
const fetchTags = async (ds: TempoDatasource): Promise<string[]> => {
  try {
    const response = await getBackendSrv().get(`/api/datasources/uid/${ds.uid}/resources/api/v2/search/tags`);

    if (response && Array.isArray(response.scopes)) {
      // Extract tag names from all scopes
      const tags: string[] = [];
      for (const scope of response.scopes) {
        if (Array.isArray(scope.tags)) {
          for (const tag of scope.tags) {
            if (tag.name && !tags.includes(tag.name)) {
              tags.push(tag.name);
            }
          }
        }
      }
      return tags.slice(0, MAX_ITEMS);
    }

    // Fallback to v1 API format
    if (response && Array.isArray(response.tagNames)) {
      return response.tagNames.slice(0, MAX_ITEMS);
    }

    return [];
  } catch (err) {
    warn('[TempoUtils] Failed to fetch tags:', err);
    return [];
  }
};

/**
 * Fetch tag values (e.g., service names)
 */
const fetchTagValues = async (ds: TempoDatasource, tagName: string): Promise<string[]> => {
  try {
    const response = await getBackendSrv().get(
      `/api/datasources/uid/${ds.uid}/resources/api/v2/search/tag/${tagName}/values`
    );

    if (response && Array.isArray(response.tagValues)) {
      return response.tagValues.map((tv: { value: string }) => tv.value).slice(0, MAX_ITEMS);
    }

    return [];
  } catch (err) {
    warn(`[TempoUtils] Failed to fetch values for tag ${tagName}:`, err);
    return [];
  }
};

/**
 * Fetch metadata from a Tempo datasource
 *
 * @param ds - The Tempo datasource instance
 * @returns Metadata including services, operations, and tags
 */
export const fetchTempoMetadata = async (ds: DataSourceApi): Promise<TracingMetadata> => {
  if (!isTempoDataSource(ds)) {
    throw new Error(`Datasource ${ds.name} is not a Tempo datasource`);
  }

  // Fetch tags first
  const tags = await fetchTags(ds);

  // Try to fetch service names (common tag name)
  let services: string[] = [];
  const serviceTagNames = ['service.name', 'service', 'serviceName'];
  for (const tagName of serviceTagNames) {
    if (tags.includes(tagName)) {
      services = await fetchTagValues(ds, tagName);
      if (services.length > 0) {
        break;
      }
    }
  }

  // Try to fetch operation names
  let operations: string[] = [];
  const operationTagNames = ['name', 'operation', 'span.name', 'operationName'];
  for (const tagName of operationTagNames) {
    if (tags.includes(tagName)) {
      operations = await fetchTagValues(ds, tagName);
      if (operations.length > 0) {
        break;
      }
    }
  }

  return {
    services,
    operations,
    tags: tags.filter((t) => !serviceTagNames.includes(t) && !operationTagNames.includes(t)),
  };
};
