// Loader for `backend-guide:` content URLs — custom interactive guides served
// by the Pathfinder backend's Kubernetes-style resource API, scoped to the
// current Grafana namespace.
import { ContentFetchResult } from '../../types/content.types';
import { config, getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';
import { itemUrl } from '../../utils/interactive-guides-api';
import { validateGuide } from '../../validation';

export interface BackendGuideResource {
  metadata?: {
    name?: string;
  };
  spec?: {
    id?: string;
    title?: string;
    schemaVersion?: string;
    blocks?: unknown[];
  };
}

/**
 * Validates an already-fetched guide resource and shapes it into content.
 *
 * Split out so a caller that has already GET'd the resource (the app-platform
 * resolver's publish-status probe) can build content from it instead of
 * issuing the identical request a second time.
 */
export function buildBackendGuideContent(
  guideResource: BackendGuideResource | undefined,
  url: string,
  resourceName: string
): ContentFetchResult {
  if (!guideResource?.spec?.blocks || !guideResource.spec.title) {
    return {
      content: null,
      error: `Custom guide is missing required fields: ${resourceName}`,
      errorType: 'other',
    };
  }

  const guide = {
    id: guideResource.spec.id || guideResource.metadata?.name || resourceName,
    title: guideResource.spec.title,
    schemaVersion: guideResource.spec.schemaVersion || '1.0',
    blocks: guideResource.spec.blocks,
  };

  const validationResult = validateGuide(guide);
  if (!validationResult.isValid) {
    const errorMessage = validationResult.errors[0]?.message || 'Schema validation failed';
    return {
      content: null,
      error: `Invalid custom guide: ${errorMessage}`,
      errorType: 'other',
    };
  }

  return {
    content: {
      content: JSON.stringify(guide),
      metadata: {
        title: guide.title,
      },
      type: 'interactive',
      url,
      lastFetched: new Date().toISOString(),
    },
  };
}

// Serves drafts as well as published guides, deliberately: this is the loader
// behind `?doc=api:<id>` share links and auto-dock tab restore, and gating
// publish status here would break "copy workshop link" and a live workshop
// whose author flips a guide to draft mid-session. The publish gate lives at
// fetchPackageById instead (see #1561).
export async function fetchBackendInteractive(url: string): Promise<ContentFetchResult> {
  const resourceName = url.replace('backend-guide:', '').trim();
  const namespace = config.namespace;

  if (!resourceName) {
    return { content: null, error: 'Invalid backend guide resource name', errorType: 'other' };
  }

  if (!namespace) {
    return { content: null, error: 'No namespace available to load custom guide', errorType: 'other' };
  }

  try {
    // itemUrl encodes resourceName to prevent path traversal (F3).
    const response = await lastValueFrom(
      getBackendSrv().fetch<BackendGuideResource>({
        url: itemUrl(namespace, resourceName),
        method: 'GET',
        // Optional rollout endpoint: don't show a global toast when unavailable.
        showErrorAlert: false,
      })
    );
    return buildBackendGuideContent(response.data, url, resourceName);
  } catch (error) {
    return {
      content: null,
      error: `Failed to load custom guide: ${resourceName}`,
      errorType: 'other',
      statusCode: (error as { status?: number })?.status,
    };
  }
}
