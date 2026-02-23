/**
 * Hook for managing guide persistence to backend
 */

import { useState, useCallback, useEffect } from 'react';
import { getBackendSrv, config } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';
import type { JsonGuide } from '../types';

interface BackendGuide {
  metadata: {
    name: string;
    namespace: string;
    creationTimestamp?: string;
    uid?: string;
  };
  spec: {
    id: string;
    title: string;
    schemaVersion?: string;
    blocks: any[];
  };
}

interface BackendGuidesList {
  items: BackendGuide[];
}

export interface UseBackendGuidesReturn {
  guides: BackendGuide[];
  isLoading: boolean;
  error: string | null;
  refreshGuides: () => Promise<BackendGuide[]>;
  saveGuide: (guide: JsonGuide, existingResourceName?: string, existingMetadata?: any) => Promise<void>;
  deleteGuide: (resourceName: string) => Promise<void>;
  isSaving: boolean;
}

/** HTTP status codes that indicate the optional backend API is not yet rolled out */
const UNAVAILABLE_STATUSES = new Set([400, 403, 404, 405, 501, 503]);

/**
 * Hook to manage guides from the Pathfinder backend
 */
export function useBackendGuides(): UseBackendGuidesReturn {
  const [guides, setGuides] = useState<BackendGuide[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const namespace = config.namespace;

  /**
   * Fetch all guides from backend
   */
  const refreshGuides = useCallback(async (): Promise<BackendGuide[]> => {
    if (!namespace) {
      setError('No namespace available');
      return [];
    }

    setIsLoading(true);
    setError(null);

    try {
      const url = `/apis/pathfinderbackend.ext.grafana.com/v1alpha1/namespaces/${namespace}/interactiveguides`;

      const response = await lastValueFrom(
        getBackendSrv().fetch<BackendGuidesList>({
          url,
          method: 'GET',
          // Optional rollout endpoint: keep missing API silent.
          showErrorAlert: false,
        })
      );

      const fetchedGuides = response.data?.items || [];
      setGuides(fetchedGuides);
      return fetchedGuides;
    } catch (err) {
      const status =
        (err as { status?: number; statusCode?: number; data?: { statusCode?: number } })?.status ??
        (err as { statusCode?: number })?.statusCode ??
        (err as { data?: { statusCode?: number } })?.data?.statusCode;
      if (status && UNAVAILABLE_STATUSES.has(status)) {
        setError(null);
        return [];
      }
      console.error('[useBackendGuides] Failed to fetch guides:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch guides');
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [namespace]);

  /**
   * Save guide to backend (create new or update existing)
   */
  const saveGuide = useCallback(
    async (guide: JsonGuide, existingResourceName?: string, existingMetadata?: any) => {
      if (!namespace) {
        throw new Error('No namespace available');
      }

      setIsSaving(true);
      try {
        // Generate a resource name from the guide ID or title
        const resourceName =
          existingResourceName ||
          (guide.id || guide.title)
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');

        // Build metadata - preserve existing metadata for updates
        const metadata: any = {
          name: resourceName,
          namespace: namespace,
        };

        // For updates, include resourceVersion from existing metadata
        if (existingResourceName && existingMetadata) {
          metadata.resourceVersion = existingMetadata.resourceVersion;
        }

        // Wrap guide in Kubernetes resource format
        const k8sResource = {
          apiVersion: 'pathfinderbackend.ext.grafana.com/v1alpha1',
          kind: 'InteractiveGuide',
          metadata,
          spec: {
            id: guide.id,
            title: guide.title,
            schemaVersion: guide.schemaVersion || '1.0',
            blocks: guide.blocks,
          },
        };

        const baseUrl = `/apis/pathfinderbackend.ext.grafana.com/v1alpha1/namespaces/${namespace}/interactiveguides`;

        if (existingResourceName) {
          // Update existing guide (PUT)
          const url = `${baseUrl}/${existingResourceName}`;
          await lastValueFrom(
            getBackendSrv().fetch({
              url,
              method: 'PUT',
              data: k8sResource,
              showErrorAlert: false,
            })
          );
        } else {
          // Create new guide (POST)
          await lastValueFrom(
            getBackendSrv().fetch({
              url: baseUrl,
              method: 'POST',
              data: k8sResource,
              showErrorAlert: false,
            })
          );
        }

        // Refresh the list after saving
        await refreshGuides();
      } finally {
        setIsSaving(false);
      }
    },
    [namespace, refreshGuides]
  );

  /**
   * Delete guide from backend
   */
  const deleteGuide = useCallback(
    async (resourceName: string) => {
      if (!namespace) {
        throw new Error('No namespace available');
      }

      try {
        const url = `/apis/pathfinderbackend.ext.grafana.com/v1alpha1/namespaces/${namespace}/interactiveguides/${resourceName}`;

        await lastValueFrom(
          getBackendSrv().fetch({
            url,
            method: 'DELETE',
            showErrorAlert: false,
          })
        );

        // Refresh the list after deleting
        await refreshGuides();
      } catch (err) {
        console.error('[useBackendGuides] Failed to delete guide:', err);
        throw err;
      }
    },
    [namespace, refreshGuides]
  );

  // Load guides on mount
  useEffect(() => {
    refreshGuides();
  }, [refreshGuides]);

  return {
    guides,
    isLoading,
    error,
    refreshGuides,
    saveGuide,
    deleteGuide,
    isSaving,
  };
}
