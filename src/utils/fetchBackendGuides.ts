/**
 * Shared utility for fetching backend guides
 */

import { getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';

interface BackendGuidesList {
  items?: any[];
}

/** HTTP status codes that indicate the optional backend API is not yet rolled out */
const UNAVAILABLE_STATUSES = new Set([400, 403, 404, 405, 501, 503]);

/**
 * Fetch guides from the backend API
 * Returns empty array if endpoint is unavailable or on error
 */
export async function fetchBackendGuides(namespace: string): Promise<any[]> {
  try {
    const url = `/apis/pathfinderbackend.ext.grafana.com/v1alpha1/namespaces/${namespace}/interactiveguides`;

    const response = await lastValueFrom(
      getBackendSrv().fetch<BackendGuidesList>({
        url,
        method: 'GET',
        showErrorAlert: false,
      })
    );

    return response.data?.items || [];
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
