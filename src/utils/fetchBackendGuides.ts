/**
 * Shared utility for fetching backend guides from the App Platform (GAP) group.
 */

import { getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';

import { collectionUrl, isBackendApiAvailable } from './interactive-guides-api';

// Re-exported so existing importers (e.g. BlockEditor) keep a stable path.
export { isBackendApiAvailable };

interface BackendGuidesList {
  items?: any[];
}

/** HTTP status codes that indicate the optional backend API is not yet rolled out. */
const UNAVAILABLE_STATUSES = new Set([400, 403, 404, 405, 501, 503]);

/**
 * Fetch guides from the backend API. Returns an empty array if the endpoint is
 * unavailable or on error. When publishedOnly is true, only guides with
 * spec.status === 'published' are returned; guides with missing/undefined
 * status are treated as draft and excluded.
 */
export async function fetchBackendGuides(namespace: string, publishedOnly?: boolean): Promise<any[]> {
  if (!isBackendApiAvailable() || !namespace) {
    return [];
  }

  try {
    const response = await lastValueFrom(
      getBackendSrv().fetch<BackendGuidesList>({
        url: collectionUrl(namespace),
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

    // Endpoint may not be rolled out yet - treat as unavailable.
    if (status && UNAVAILABLE_STATUSES.has(status)) {
      return [];
    }

    // Re-throw for caller to handle.
    throw err;
  }
}
