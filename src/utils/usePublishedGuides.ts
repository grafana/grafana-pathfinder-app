import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { config } from '@grafana/runtime';
import { fetchCustomGuideRepository, type CustomGuideRepositoryEntry } from '../lib/custom-guide-repository-client';

/** A single published custom guide or path/journey package from the catalogue. */
export type PublishedGuide = CustomGuideRepositoryEntry;

interface UsePublishedGuidesResult {
  /** Full flat list of published guides — used as-is when no path/journey manifests exist (§7.3). */
  guides: PublishedGuide[];
  /** Published `path`/`journey` packages, shown as cards ahead of loose guides. */
  paths: PublishedGuide[];
  /** Published `guide`-type (or manifest-less) entries not referenced as any path's milestone. */
  orphanGuides: PublishedGuide[];
  isLoading: boolean;
  hasLoaded: boolean;
  error: string | null;
  refreshGuides: () => Promise<void>;
}

function isPathManifest(guide: PublishedGuide): boolean {
  return guide.manifest?.type === 'path' || guide.manifest?.type === 'journey';
}

/** IDs referenced as a member of any published path/journey's milestones. */
function collectReferencedIds(paths: PublishedGuide[]): Set<string> {
  const ids = new Set<string>();
  for (const path of paths) {
    for (const milestoneId of path.manifest?.milestones ?? []) {
      ids.add(milestoneId);
    }
  }
  return ids;
}

export function usePublishedGuides(): UsePublishedGuidesResult {
  const [guides, setGuides] = useState<PublishedGuide[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const namespace = config.namespace;
  const isMountedRef = useRef(true);

  const refreshGuides = useCallback(async () => {
    if (!namespace) {
      if (isMountedRef.current) {
        setGuides([]);
        setError('No namespace available');
        setHasLoaded(true);
      }
      return;
    }

    if (isMountedRef.current) {
      setIsLoading(true);
      setHasLoaded(false);
      setError(null);
    }

    try {
      const fetchedGuides = await fetchCustomGuideRepository(namespace);
      const published = fetchedGuides.filter((guide) => guide.status === 'published');
      if (isMountedRef.current) {
        setGuides(published);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setGuides([]);
        setError(err instanceof Error ? err.message : 'Failed to fetch custom guides');
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
        setHasLoaded(true);
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

  const paths = useMemo(() => guides.filter(isPathManifest), [guides]);
  const orphanGuides = useMemo(() => {
    const referencedIds = collectReferencedIds(paths);
    return guides.filter((guide) => !isPathManifest(guide) && !referencedIds.has(guide.id));
  }, [guides, paths]);

  return {
    guides,
    paths,
    orphanGuides,
    isLoading,
    hasLoaded,
    error,
    refreshGuides,
  };
}
