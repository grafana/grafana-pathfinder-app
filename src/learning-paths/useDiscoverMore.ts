/**
 * Discover More Hook
 *
 * Surfaces novel, external learning paths in the My Learning page. Unlike the
 * context recommender — which targets the user's current path and can return
 * nothing on the home surface — this pulls the full upstream package index
 * (`repository.json`, proxied by the backend), keeps only `path`-typed entries
 * (whole learning paths, not individual guides), and picks a handful, so there
 * is always a new path to explore.
 */

import { useState, useEffect } from 'react';

import {
  fetchOnlinePackageRecommendations,
  buildPackageFileUrl,
  type OnlinePackageEntry,
} from '../lib/package-recommendations-client';
import type { DiscoverMoreItem } from '../types/learning-paths.types';
import { logger } from '../lib/logging';

import { parseDiscoverMoreManifest } from './launch-package-info';

const DEFAULT_DISCOVER_COUNT = 5;

export type { DiscoverMoreItem } from '../types/learning-paths.types';

export interface UseDiscoverMoreOptions {
  /** Titles already surfaced elsewhere (My Courses / Completed) to skip. */
  excludeTitles?: Set<string>;
  /** How many items to surface. */
  count?: number;
}

export interface UseDiscoverMoreReturn {
  items: DiscoverMoreItem[];
  isLoading: boolean;
}

function milestoneCountOf(entry: OnlinePackageEntry): number | undefined {
  const milestones = entry.manifest?.milestones;
  return Array.isArray(milestones) ? milestones.length : undefined;
}

function toDiscoverItem(entry: OnlinePackageEntry, baseUrl: string): DiscoverMoreItem | null {
  const contentUrl = buildPackageFileUrl(baseUrl, entry.path, 'content.json');
  if (!contentUrl) {
    return null;
  }
  return {
    id: entry.id,
    title: entry.title ?? entry.id,
    description: entry.description,
    contentUrl,
    milestoneCount: milestoneCountOf(entry),
    manifest: parseDiscoverMoreManifest(entry.manifest),
  };
}

/**
 * Fetches the upstream package index once and returns up to `count` items,
 * skipping any whose title is already shown elsewhere on the page. Fails soft:
 * the underlying client never throws and returns an empty index when offline
 * or unavailable, so callers render an empty state rather than an error.
 */
export function useDiscoverMore(options: UseDiscoverMoreOptions = {}): UseDiscoverMoreReturn {
  const { excludeTitles, count = DEFAULT_DISCOVER_COUNT } = options;
  const [items, setItems] = useState<DiscoverMoreItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const excludeKey = excludeTitles ? [...excludeTitles].sort().join('|') : '';

  useEffect(() => {
    let mounted = true;

    void (async () => {
      try {
        const { baseUrl, packages } = await fetchOnlinePackageRecommendations();
        const exclude = excludeTitles ?? new Set<string>();
        const mapped = packages
          // Only whole learning paths — the index also carries individual
          // guides (type 'guide'), which are not what Discover More surfaces.
          .filter((entry) => entry.type === 'path')
          .map((entry) => toDiscoverItem(entry, baseUrl))
          .filter((item): item is DiscoverMoreItem => item !== null && !exclude.has(item.title))
          .slice(0, count);

        if (mounted) {
          setItems(mapped);
        }
      } catch (error) {
        logger.warn('[DiscoverMore] Failed to load package index', { error });
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      mounted = false;
    };
    // excludeKey is a stable serialization of excludeTitles; count is primitive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excludeKey, count]);

  return { items, isLoading };
}
