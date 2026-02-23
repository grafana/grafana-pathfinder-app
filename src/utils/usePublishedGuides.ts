import { useCallback, useEffect, useState } from 'react';
import { config, getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';

export interface PublishedGuide {
  metadata: {
    name: string;
    namespace: string;
  };
  spec: {
    id: string;
    title: string;
    schemaVersion?: string;
    blocks?: unknown[];
  };
}

interface BackendGuidesList {
  items?: PublishedGuide[];
}

interface UsePublishedGuidesResult {
  guides: PublishedGuide[];
  isLoading: boolean;
  error: string | null;
  refreshGuides: () => Promise<void>;
}

export function usePublishedGuides(): UsePublishedGuidesResult {
  const [guides, setGuides] = useState<PublishedGuide[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const namespace = config.namespace;

  const refreshGuides = useCallback(async () => {
    if (!namespace) {
      setGuides([]);
      setError('No namespace available');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const url = `/apis/pathfinderbackend.ext.grafana.com/v1alpha1/namespaces/${namespace}/interactiveguides`;
      const response = await lastValueFrom(
        getBackendSrv().fetch<BackendGuidesList>({
          url,
          method: 'GET',
          // Optional endpoint: avoid user-facing 404/rollout toasts.
          showErrorAlert: false,
        })
      );
      setGuides(response.data?.items ?? []);
    } catch (err) {
      setGuides([]);
      const status =
        (err as { status?: number; statusCode?: number; data?: { statusCode?: number } })?.status ??
        (err as { statusCode?: number })?.statusCode ??
        (err as { data?: { statusCode?: number } })?.data?.statusCode;
      const unavailableStatuses = new Set([400, 403, 404, 405, 501, 503]);

      // Endpoint may not be rolled out yet in some environments.
      // Treat those availability errors as "feature disabled" and fail silently.
      if (status && unavailableStatuses.has(status)) {
        setError(null);
        return;
      }

      setError(err instanceof Error ? err.message : 'Failed to fetch custom guides');
    } finally {
      setIsLoading(false);
    }
  }, [namespace]);

  useEffect(() => {
    refreshGuides();
  }, [refreshGuides]);

  return {
    guides,
    isLoading,
    error,
    refreshGuides,
  };
}
