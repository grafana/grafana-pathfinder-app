/**
 * Fetches GuideCompletion CRD resources from the backend API.
 * Returns an empty array when the backend is unavailable.
 */

import { config, getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';
import { isBackendApiAvailable } from '../utils/fetchBackendGuides';
import type { GuideCompletionList, GuideCompletionResource } from '../types/guide-completion.types';

/** HTTP status codes that indicate the API is not yet rolled out */
const UNAVAILABLE_STATUSES = new Set([400, 403, 404, 405, 501, 503]);

export async function fetchGuideCompletions(): Promise<GuideCompletionResource[]> {
  if (!isBackendApiAvailable()) {
    return [];
  }

  const namespace = config.namespace;
  if (!namespace) {
    return [];
  }

  try {
    const url = `/apis/pathfinderbackend.ext.grafana.com/v1alpha1/namespaces/${namespace}/guidecompletions`;

    const response = await lastValueFrom(
      getBackendSrv().fetch<GuideCompletionList>({
        url,
        method: 'GET',
        showErrorAlert: false,
        headers: { 'Cache-Control': 'no-cache' },
      })
    );

    return response.data?.items ?? [];
  } catch (err) {
    const status =
      (err as { status?: number; statusCode?: number; data?: { statusCode?: number } })?.status ??
      (err as { statusCode?: number })?.statusCode ??
      (err as { data?: { statusCode?: number } })?.data?.statusCode ??
      (err as { data?: { code?: number } })?.data?.code;

    if (status && UNAVAILABLE_STATUSES.has(status)) {
      return [];
    }

    console.warn('Failed to fetch guide completions:', err);
    return [];
  }
}
