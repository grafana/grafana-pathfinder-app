/**
 * Shared utility for fetching backend guides
 */

import { config, getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';

interface BackendGuidesList {
  items?: any[];
}

/**
 * Returns true when the Pathfinder backend API is available in this Grafana instance.
 * Reads the boot-time feature toggle set by the aggregation layer.
 */
export function isBackendApiAvailable(): boolean {
  const featureToggles = config.featureToggles as Record<string, boolean> | undefined;
  return featureToggles?.['aggregation.pathfinderbackend-ext-grafana-com.enabled'] === true;
}

/** HTTP status codes that indicate the optional backend API is not yet rolled out */
const UNAVAILABLE_STATUSES = new Set([400, 403, 404, 405, 501, 503]);

/**
 * Fetch guides from the backend API
 * Returns empty array if endpoint is unavailable or on error.
 * When publishedOnly is true, only guides with spec.status === 'published' are returned;
 * guides with missing/undefined status are treated as draft and excluded.
 */
export async function fetchBackendGuides(namespace: string, publishedOnly?: boolean): Promise<any[]> {
  if (!isBackendApiAvailable()) {
    return [];
  }

  try {
    const url = `/apis/pathfinderbackend.ext.grafana.com/v1alpha1/namespaces/${namespace}/interactiveguides`;

    const response = await lastValueFrom(
      getBackendSrv().fetch<BackendGuidesList>({
        url,
        method: 'GET',
        showErrorAlert: false,
      })
    );

    const items = response.data?.items || [];

    if (publishedOnly) {
      return items.filter((item: any) => item.spec?.status === 'published');
    }

    return items;
  } catch (err) {
    const status =
      (err as { status?: number; statusCode?: number; data?: { statusCode?: number } })?.status ??
      (err as { statusCode?: number })?.statusCode ??
      (err as { data?: { statusCode?: number } })?.data?.statusCode;

    // Endpoint may not be rolled out yet - treat as unavailable
    if (status && UNAVAILABLE_STATUSES.has(status)) {
      return [];
    }

    // Re-throw for caller to handle
    throw err;
  }
}
