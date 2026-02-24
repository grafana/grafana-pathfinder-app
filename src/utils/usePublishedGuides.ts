import { useCallback, useEffect, useState, useRef } from 'react';
import { config } from '@grafana/runtime';
import { fetchBackendGuides } from './fetchBackendGuides';

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
  const isMountedRef = useRef(true);

  const refreshGuides = useCallback(async () => {
    if (!namespace) {
      if (isMountedRef.current) {
        setGuides([]);
        setError('No namespace available');
      }
      return;
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
    } catch (err) {
      if (isMountedRef.current) {
        setGuides([]);
        setError(err instanceof Error ? err.message : 'Failed to fetch custom guides');
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [namespace]);

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
  };
}
