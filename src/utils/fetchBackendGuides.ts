import { getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';

import { PLUGIN_BACKEND_URL } from '../constants';
import { isBackendApiAvailable } from './interactive-guides-api';

// Re-exported so existing importers (e.g. BlockEditor) keep a stable path.
export { isBackendApiAvailable };

interface BackendGuidesList {
  items?: any[];
}

/** HTTP status codes that indicate the optional backend API is not yet rolled out. */
const UNAVAILABLE_STATUSES = new Set([400, 403, 404, 405, 501, 503]);

/**
 * Optional endpoints return an empty list; other errors reach the editor.
 */
export async function fetchBackendGuides(namespace: string, publishedOnly?: boolean): Promise<any[]> {
  if (!isBackendApiAvailable() || !namespace) {
    return [];
  }

  try {
    const response = await lastValueFrom(
      getBackendSrv().fetch<BackendGuidesList>({
        url: `${PLUGIN_BACKEND_URL}/custom-guides`,
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

    if (status && UNAVAILABLE_STATUSES.has(status)) {
      return [];
    }

    throw err;
  }
}
