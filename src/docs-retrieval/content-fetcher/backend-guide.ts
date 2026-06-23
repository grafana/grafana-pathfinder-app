// Loader for `backend-guide:` content URLs — custom interactive guides served
// by the Pathfinder backend's Kubernetes-style resource API, scoped to the
// current Grafana namespace.
import { ContentFetchResult } from '../../types/content.types';
import { config, getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';
import { validateGuide } from '../../validation';

interface BackendGuideResource {
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
    // SECURITY: Encode resourceName to prevent path traversal (F3)
    const endpoint = `/apis/pathfinderbackend.ext.grafana.com/v1alpha1/namespaces/${namespace}/interactiveguides/${encodeURIComponent(resourceName)}`;
    const response = await lastValueFrom(
      getBackendSrv().fetch<BackendGuideResource>({
        url: endpoint,
        method: 'GET',
        // Optional rollout endpoint: don't show a global toast when unavailable.
        showErrorAlert: false,
      })
    );
    const guideResource = response.data;

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
  } catch (error) {
    return {
      content: null,
      error: `Failed to load custom guide: ${resourceName}`,
      errorType: 'other',
      statusCode: (error as { status?: number })?.status,
    };
  }
}
