/**
 * Learning Paths Hook
 *
 * Main hook for managing learning paths, badges, and progress state.
 * Provides a unified API for components to interact with the learning system.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { config } from '@grafana/runtime';

import type {
  LearningPath,
  LearningProgress,
  PathGuide,
  EarnedBadge,
  UseLearningPathsReturn,
  StreakInfo,
  GuideMetadataEntry,
} from '../types/learning-paths.types';

import { StorageEvents } from '../lib/event-names';
import { logger } from '../lib/logging';
import {
  learningProgressStorage,
  interactiveStepStorage,
  interactiveCompletionStorage,
  journeyCompletionStorage,
  milestoneCompletionStorage,
} from '../lib/user-storage';
import { evictContentCache } from '../global-state/completion-store';
import { BADGES } from './badges';
import { getStreakInfo } from './streak-tracker';
import { getPathsData } from './paths-data';
import { fetchPathGuides, type FetchedPathGuides } from './fetch-path-guides';
import { fetchAppPlatformLearningPaths, type AppPlatformPathsResult } from './app-platform-paths';
import { markGuideCompleted as coordinatorMarkGuideCompleted } from './badge-coordinator';

const EMPTY_APP_PLATFORM_RESULT: AppPlatformPathsResult = { paths: [], guideMetadata: {} };

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_PROGRESS: LearningProgress = {
  completedGuides: [],
  earnedBadges: [],
  streakDays: 0,
  lastActivityDate: '',
  pendingCelebrations: [],
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Formats a legacy badge ID into a readable title
 * Converts kebab-case to Title Case (e.g., "test-badge" -> "Test Badge")
 */
function formatLegacyBadgeTitle(badgeId: string): string {
  return badgeId
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Calculates path completion percentage
 */
function calculatePathProgress(path: LearningPath, completedGuides: string[]): number {
  if (path.guides.length === 0) {
    return 0;
  }

  const completedCount = path.guides.filter((g) => completedGuides.includes(g)).length;
  return Math.round((completedCount / path.guides.length) * 100);
}

// ============================================================================
// MAIN HOOK
// ============================================================================

/**
 * Hook for managing learning paths, badges, and progress
 *
 * @returns Learning paths state and actions
 */
export function useLearningPaths(): UseLearningPathsReturn {
  const [progress, setProgress] = useState<LearningProgress>(DEFAULT_PROGRESS);
  const [isLoading, setIsLoading] = useState(true);

  // Dynamic guide data fetched from index.json for URL-based paths
  const [dynamicGuideData, setDynamicGuideData] = useState<Record<string, FetchedPathGuides>>({});
  const [isDynamicLoading, setIsDynamicLoading] = useState<boolean>(() => getPathsData().paths.some((p) => p.url));

  // App Platform paths/journeys ingested at runtime from the custom-guide
  // catalogue (RFC CUSTOM-GUIDE-PACKAGES.md §6.11) — a separate source from
  // the bundled paths.json scaffold and the CDN index.json dynamic fetch
  // above, merged into `paths` the same way.
  const [appPlatformData, setAppPlatformData] = useState<AppPlatformPathsResult>(EMPTY_APP_PLATFORM_RESULT);

  // Get raw paths for the current platform (OSS or Cloud)
  const rawPaths = useMemo(() => {
    return getPathsData().paths;
  }, []);

  // Fetch dynamic guides for URL-based paths on mount
  useEffect(() => {
    const urlPaths = rawPaths.filter((p) => p.url);
    if (urlPaths.length === 0) {
      return;
    }

    const abortController = new AbortController();

    void (async () => {
      const results: Record<string, FetchedPathGuides> = {};

      await Promise.all(
        urlPaths.map(async (path) => {
          const data = await fetchPathGuides(path.url!, abortController.signal);
          if (data) {
            results[path.id] = data;
          }
        })
      );

      if (!abortController.signal.aborted) {
        setDynamicGuideData(results);
        setIsDynamicLoading(false);
      }
    })();

    return () => {
      abortController.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch App Platform paths/journeys on mount. Independent of the
  // path.url-based effect above — this reads the namespace's own custom-guide
  // catalogue rather than a per-path remote index.json.
  useEffect(() => {
    const namespace = config.namespace;
    if (!namespace) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const result = await fetchAppPlatformLearningPaths(namespace);
      if (!cancelled) {
        setAppPlatformData(result);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Build effective paths: merge dynamic guides into URL-based paths, then
  // append App Platform paths (bundled-first — matches the composite
  // resolver's precedence convention, RFC §6.6).
  const paths = useMemo((): LearningPath[] => {
    const merged = rawPaths.map((path) => {
      const dynamic = dynamicGuideData[path.id];
      if (path.url && dynamic) {
        return { ...path, guides: dynamic.guides };
      }
      return path;
    });
    return [...merged, ...appPlatformData.paths];
  }, [rawPaths, dynamicGuideData, appPlatformData]);

  /**
   * Gets guide metadata, scoped to a specific path when provided.
   *
   * URL-based paths can share guide slugs (e.g. two paths each have an
   * "intro" guide). When `pathId` is supplied, only that path's dynamic
   * metadata is consulted, preventing cross-path collisions. When `pathId`
   * is omitted (callers without path context), all dynamic metadata is
   * scanned for backwards compatibility.
   *
   * Falls back to App Platform catalogue metadata, then to static metadata
   * from paths.json / paths-cloud.json.
   */
  const resolveGuideMetadata = useCallback(
    (guideId: string, pathId?: string): GuideMetadataEntry => {
      if (pathId) {
        const scoped = dynamicGuideData[pathId]?.guideMetadata[guideId];
        if (scoped) {
          return scoped;
        }
      } else {
        for (const data of Object.values(dynamicGuideData)) {
          if (data.guideMetadata[guideId]) {
            return data.guideMetadata[guideId];
          }
        }
      }
      if (appPlatformData.guideMetadata[guideId]) {
        return appPlatformData.guideMetadata[guideId];
      }
      const { guideMetadata } = getPathsData();
      return guideMetadata[guideId] || { title: guideId, estimatedMinutes: 5 };
    },
    [dynamicGuideData, appPlatformData]
  );

  // Load progress from storage
  // Badge awarding is now handled in user-storage.ts when guides complete
  const loadProgress = useCallback(async (mounted: { current: boolean }) => {
    try {
      const stored = await learningProgressStorage.get();

      if (mounted.current) {
        setProgress(stored);
        setIsLoading(false);
      }
    } catch (error) {
      logger.warn('Failed to load learning progress', { error });
      if (mounted.current) {
        setIsLoading(false);
      }
    }
  }, []);

  // Load progress on mount - use IIFE to handle async properly
  useEffect(() => {
    const mounted = { current: true };
    // Load immediately on mount
    void (async () => {
      await loadProgress(mounted);
    })();
    return () => {
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for progress updates from other parts of the app (e.g., guide completion)
  // Badge awarding is now handled in user-storage.ts, so we just need to sync state
  useEffect(() => {
    const mounted = { current: true };

    const handleProgressUpdate = (event: Event) => {
      const detail = (event as CustomEvent).detail;

      if (!mounted.current) {
        return;
      }

      // If event includes progress data, use it directly
      if (detail?.progress) {
        setProgress(detail.progress as LearningProgress);
      } else {
        // Fallback: re-load progress from storage
        loadProgress(mounted);
      }
    };

    window.addEventListener(StorageEvents.LearningProgressUpdated, handleProgressUpdate);

    return () => {
      mounted.current = false;
      window.removeEventListener(StorageEvents.LearningProgressUpdated, handleProgressUpdate);
    };
  }, [loadProgress]);

  // Get badges with earned status (including legacy badges from previous versions)
  const badgesWithStatus = useMemo((): EarnedBadge[] => {
    // Start with all currently defined badges
    const definedBadges = BADGES.map((badge) => {
      const earned = progress.earnedBadges.find((b) => b.id === badge.id);
      const isNew = progress.pendingCelebrations.includes(badge.id);

      return {
        ...badge,
        earnedAt: earned?.earnedAt,
        isNew,
        isLegacy: false,
      };
    });

    // Add any earned badges that are no longer defined (legacy/removed)
    // This ensures users don't lose badges they earned in previous versions
    const legacyBadges: EarnedBadge[] = progress.earnedBadges
      .filter((earned) => !BADGES.find((b) => b.id === earned.id))
      .map((earned) => ({
        id: earned.id,
        title: formatLegacyBadgeTitle(earned.id),
        description: 'This badge was earned in a previous version',
        icon: 'history',
        trigger: { type: 'guide-completed' as const },
        earnedAt: earned.earnedAt,
        isNew: false,
        isLegacy: true,
      }));

    return [...definedBadges, ...legacyBadges];
  }, [progress.earnedBadges, progress.pendingCelebrations]);

  // Calculate streak info
  const streakInfo = useMemo((): StreakInfo => {
    return getStreakInfo(progress.streakDays, progress.lastActivityDate);
  }, [progress.streakDays, progress.lastActivityDate]);

  // Get guides for a specific path with completion status
  const getPathGuides = useCallback(
    (pathId: string): PathGuide[] => {
      const path = paths.find((p) => p.id === pathId);
      if (!path) {
        return [];
      }

      let foundCurrent = false;

      return path.guides.map((guideId) => {
        const completed = progress.completedGuides.includes(guideId);
        const isCurrent = !completed && !foundCurrent;

        if (isCurrent) {
          foundCurrent = true;
        }

        // Scope metadata to this path so two paths sharing a guide slug do
        // not bleed URLs/titles across each other.
        const metadata = resolveGuideMetadata(guideId, pathId);

        return {
          id: guideId,
          title: metadata.title,
          completed,
          isCurrent,
          url: metadata.url,
        };
      });
    },
    [paths, progress.completedGuides, resolveGuideMetadata]
  );

  // Path-scoped per-guide URL lookup. Used by handlers that receive
  // (guideId, pathId) and need to navigate to the correct module.
  const getGuideUrlForPath = useCallback(
    (guideId: string, pathId: string): string | undefined => {
      return resolveGuideMetadata(guideId, pathId).url;
    },
    [resolveGuideMetadata]
  );

  // Get completion percentage for a path
  const getPathProgress = useCallback(
    (pathId: string): number => {
      const path = paths.find((p) => p.id === pathId);
      if (!path) {
        return 0;
      }
      return calculatePathProgress(path, progress.completedGuides);
    },
    [paths, progress.completedGuides]
  );

  // Check if a path is completed
  const isPathCompleted = useCallback(
    (pathId: string): boolean => {
      return getPathProgress(pathId) === 100;
    },
    [getPathProgress]
  );

  // Mark a guide as completed.
  // Badge awarding + analytics + the LearningProgressUpdated dispatch are
  // owned by the Tier 2 coordinator; storage just persists.
  const markGuideCompleted = useCallback(
    async (guideId: string): Promise<void> => {
      // Skip if already completed
      if (progress.completedGuides.includes(guideId)) {
        return;
      }
      await coordinatorMarkGuideCompleted(guideId);
    },
    [progress.completedGuides]
  );

  // Dismiss a pending celebration
  const dismissCelebration = useCallback(
    async (badgeId: string): Promise<void> => {
      const updatedCelebrations = progress.pendingCelebrations.filter((id) => id !== badgeId);

      const updatedProgress = {
        ...progress,
        pendingCelebrations: updatedCelebrations,
      };

      setProgress(updatedProgress);
      await learningProgressStorage.dismissCelebration(badgeId);
    },
    [progress]
  );

  // Reset a path's progress (clears guides and interactive steps, keeps badges)
  const resetPath = useCallback(
    async (pathId: string): Promise<void> => {
      const path = paths.find((p) => p.id === pathId);
      if (!path) {
        return;
      }

      if (path.url) {
        await milestoneCompletionStorage.clear(path.url);

        if (path.guides.length > 0) {
          await learningProgressStorage.removeCompletedGuides(path.guides);
        }

        const [completions, journeyCompletions] = await Promise.all([
          interactiveCompletionStorage.getAll(),
          journeyCompletionStorage.getAll(),
        ]);

        // Milestone content keys aren't stored anywhere, so recover them by prefix.
        const normalizedUrl = path.url.replace(/\/+$/, '');
        const milestoneKeys = Object.keys(completions).filter((key) => key.startsWith(normalizedUrl));
        const journeyKeys = [path.url, ...Object.keys(journeyCompletions).filter((k) => k.startsWith(normalizedUrl))];

        await Promise.all(milestoneKeys.map((key) => interactiveStepStorage.clearAllForContent(key)));
        await interactiveCompletionStorage.clearMany(milestoneKeys);
        await journeyCompletionStorage.clearMany(journeyKeys);

        milestoneKeys.forEach((key) => evictContentCache(key));
      } else {
        // No base URL: either a static bundled path (`bundled:<id>`) or an App
        // Platform path whose members are `backend-guide:<id>`. We can't tell
        // them apart from `path.guides` alone, so clear both content schemes.
        const pathKeys = [`bundled:${path.id}`, `backend-guide:${path.id}`];
        const contentKeys = [
          ...pathKeys,
          ...path.guides.flatMap((guideId) => [`bundled:${guideId}`, `backend-guide:${guideId}`]),
        ];

        for (const pathKey of pathKeys) {
          await milestoneCompletionStorage.clear(pathKey);
        }

        await Promise.all(contentKeys.map((key) => interactiveStepStorage.clearAllForContent(key)));
        // Batched, not one clear per key: each helper read-modify-writes a single shared record.
        await interactiveCompletionStorage.clearMany(contentKeys);
        await journeyCompletionStorage.clearMany(contentKeys);

        contentKeys.forEach((key) => evictContentCache(key));

        await learningProgressStorage.removeCompletedGuides(path.guides);
      }

      window.dispatchEvent(
        new CustomEvent(StorageEvents.InteractiveProgressCleared, {
          detail: { contentKey: '*', pathId },
        })
      );

      await loadProgress({ current: true });
    },
    [paths, loadProgress]
  );

  return {
    paths,
    allBadges: BADGES,
    badgesWithStatus,
    progress,
    getPathGuides,
    getPathProgress,
    isPathCompleted,
    getGuideUrlForPath,
    markGuideCompleted,
    resetPath,
    dismissCelebration,
    streakInfo,
    isLoading,
    isDynamicLoading,
  };
}

// ============================================================================
// UTILITY HOOK FOR GUIDE COMPLETION
// ============================================================================

/**
 * Hook that provides a function to mark the current guide as completed
 * Used by the guide rendering components
 */
export function useGuideCompletion() {
  const { markGuideCompleted } = useLearningPaths();

  return {
    markGuideCompleted,
  };
}
