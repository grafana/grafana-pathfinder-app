// Loader for `backend-guide:` content URLs — custom interactive guides served
// by the Pathfinder backend's Kubernetes-style resource API, scoped to the
// current Grafana namespace.
import { ContentFetchResult } from '../../types/content.types';
import { config } from '@grafana/runtime';
import { itemUrl, readItemWithFallback } from '../../utils/interactive-guides-api';
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
    // itemUrl encodes resourceName to prevent path traversal (F3). Reads the new
    // App Platform group first, falling back to the legacy group during migration.
    const result = await readItemWithFallback<BackendGuideResource>((apiVersion) =>
      itemUrl(apiVersion, namespace, resourceName)
    );

    if (!result.ok) {
      return { content: null, error: `Failed to load custom guide: ${resourceName}`, errorType: 'other' };
    }

    const guideResource = result.data;

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
