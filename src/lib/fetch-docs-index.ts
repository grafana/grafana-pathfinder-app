/**
 * Fetch docs index.json via the plugin backend proxy.
 *
 * grafana.com serves index.json (Hugo page listings) without CORS headers,
 * so browser fetch() from the plugin origin is blocked. This utility routes
 * the request through the plugin's Go backend which fetches server-side.
 */

import { getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';
import { PLUGIN_BACKEND_URL } from '../constants';

/**
 * Fetches a grafana.com docs index.json via the backend proxy.
 * Returns the parsed JSON array, or null on failure.
 */
export async function fetchDocsIndexJson(indexJsonUrl: string, signal?: AbortSignal): Promise<unknown[] | null> {
  const proxyUrl = `${PLUGIN_BACKEND_URL}/docs-proxy?url=${encodeURIComponent(indexJsonUrl)}`;

  try {
    const response = await lastValueFrom(
      getBackendSrv().fetch<unknown[]>({
        url: proxyUrl,
        method: 'GET',
        showErrorAlert: false,
      })
    );

    if (!Array.isArray(response.data)) {
      return null;
    }

    return response.data;
  } catch (error) {
    if (signal?.aborted) {
      return null;
    }
    console.warn(`[fetchDocsIndexJson] Failed to fetch ${indexJsonUrl} via backend proxy:`, error);
    return null;
  }
}
