/**
 * Hook for managing guide persistence to backend
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { getBackendSrv, config } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';
import type { JsonGuide } from '../types';
import { fetchBackendGuides } from '../../../utils/fetchBackendGuides';

interface BackendGuide {
  metadata: {
    name: string;
    namespace: string;
    creationTimestamp?: string;
    uid?: string;
    resourceVersion?: string;
  };
  spec: {
    id: string;
    title: string;
    schemaVersion?: string;
    blocks: any[];
    status?: 'draft' | 'published';
  };
}

export interface UseBackendGuidesReturn {
  guides: BackendGuide[];
  isLoading: boolean;
  error: string | null;
  refreshGuides: () => Promise<BackendGuide[]>;
  saveGuide: (
    guide: JsonGuide,
    existingResourceName?: string,
    existingMetadata?: any,
    status?: 'draft' | 'published'
  ) => Promise<void>;
  publishGuide: (resourceName: string, currentMetadata: any) => Promise<void>;
  unpublishGuide: (resourceName: string, currentMetadata: any) => Promise<void>;
  deleteGuide: (resourceName: string) => Promise<void>;
  isSaving: boolean;
}

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
  const isMountedRef = useRef(true);
  const refreshGuides = useCallback(async (): Promise<BackendGuide[]> => {
    if (!namespace) {
      if (isMountedRef.current) {
        setError('No namespace available');
      }
      return [];
    }

    if (isMountedRef.current) {
      setIsLoading(true);
      setError(null);
    }

    try {
      const fetchedGuides = await fetchBackendGuides(namespace);
      if (isMountedRef.current) {
        setGuides(fetchedGuides);
      }
      return fetchedGuides;
    } catch (err) {
      console.error('[useBackendGuides] Failed to fetch guides:', err);
      if (isMountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to fetch guides');
      }
      return [];
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [namespace]);

  /**
   * Save guide to backend (create new or update existing).
   * Defaults to 'draft' status — saving never auto-publishes.
   */
  const saveGuide = useCallback(
    async (
      guide: JsonGuide,
      existingResourceName?: string,
      existingMetadata?: any,
      status: 'draft' | 'published' = 'draft'
    ) => {
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

        // Validate resource name is not empty
        if (!resourceName || resourceName.length === 0) {
          throw new Error('Guide title or ID must contain at least one alphanumeric character');
        }

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
            status,
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
   * Publish an existing guide — sets spec.status to 'published' without changing content.
   */
  const publishGuide = useCallback(
    async (resourceName: string, currentMetadata: any) => {
      if (!namespace) {
        throw new Error('No namespace available');
      }

      const existing = guides.find((g) => g.metadata.name === resourceName);
      if (!existing) {
        throw new Error(`Guide "${resourceName}" not found in local list`);
      }

      const metadata: any = {
        name: resourceName,
        namespace,
        resourceVersion: currentMetadata.resourceVersion,
      };

      const k8sResource = {
        apiVersion: 'pathfinderbackend.ext.grafana.com/v1alpha1',
        kind: 'InteractiveGuide',
        metadata,
        spec: {
          ...existing.spec,
          status: 'published' as const,
        },
      };

      const url = `/apis/pathfinderbackend.ext.grafana.com/v1alpha1/namespaces/${namespace}/interactiveguides/${resourceName}`;
      await lastValueFrom(
        getBackendSrv().fetch({
          url,
          method: 'PUT',
          data: k8sResource,
          showErrorAlert: false,
        })
      );

      await refreshGuides();
    },
    [namespace, guides, refreshGuides]
  );

  /**
   * Unpublish a guide — sets spec.status to 'draft', removing it from the docs panel.
   */
  const unpublishGuide = useCallback(
    async (resourceName: string, currentMetadata: any) => {
      if (!namespace) {
        throw new Error('No namespace available');
      }

      const existing = guides.find((g) => g.metadata.name === resourceName);
      if (!existing) {
        throw new Error(`Guide "${resourceName}" not found in local list`);
      }

      const metadata: any = {
        name: resourceName,
        namespace,
        resourceVersion: currentMetadata.resourceVersion,
      };

      const k8sResource = {
        apiVersion: 'pathfinderbackend.ext.grafana.com/v1alpha1',
        kind: 'InteractiveGuide',
        metadata,
        spec: {
          ...existing.spec,
          status: 'draft' as const,
        },
      };

      const url = `/apis/pathfinderbackend.ext.grafana.com/v1alpha1/namespaces/${namespace}/interactiveguides/${resourceName}`;
      await lastValueFrom(
        getBackendSrv().fetch({
          url,
          method: 'PUT',
          data: k8sResource,
          showErrorAlert: false,
        })
      );

      await refreshGuides();
    },
    [namespace, guides, refreshGuides]
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

  // Load guides on mount only
  const hasInitiallyLoaded = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    if (!hasInitiallyLoaded.current) {
      hasInitiallyLoaded.current = true;
      refreshGuides();
    }
    return () => {
      isMountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    guides,
    isLoading,
    error,
    refreshGuides,
    saveGuide,
    publishGuide,
    unpublishGuide,
    deleteGuide,
    isSaving,
  };
}
