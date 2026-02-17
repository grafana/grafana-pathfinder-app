/**
 * Learning Paths Hook
 *
 * Main hook for managing learning paths, badges, and progress state.
 * Provides a unified API for components to interact with the learning system.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';

import type {
  LearningPath,
  LearningProgress,
  PathGuide,
  EarnedBadge,
  UseLearningPathsReturn,
  StreakInfo,
  GuideMetadataEntry,
} from '../types/learning-paths.types';

import {
  learningProgressStorage,
  interactiveStepStorage,
  interactiveCompletionStorage,
  journeyCompletionStorage,
  milestoneCompletionStorage,
} from '../lib/user-storage';
import { BADGES } from './badges';
import { getStreakInfo } from './streak-tracker';
import { getPathsData } from './paths-data';
import { fetchPathGuides, type FetchedPathGuides } from './fetch-path-guides';

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
  const [isDynamicLoading, setIsDynamicLoading] = useState(false);

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

    const mounted = { current: true };
    setIsDynamicLoading(true);

    void (async () => {
      const results: Record<string, FetchedPathGuides> = {};

      await Promise.all(
        urlPaths.map(async (path) => {
          const data = await fetchPathGuides(path.url!);
          if (data) {
            results[path.id] = data;
          }
        })
      );

      if (mounted.current) {
        setDynamicGuideData(results);
        setIsDynamicLoading(false);
      }
    })();

    return () => {
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build effective paths: merge dynamic guides into URL-based paths
  const paths = useMemo((): LearningPath[] => {
    return rawPaths.map((path) => {
      const dynamic = dynamicGuideData[path.id];
      if (path.url && dynamic) {
        return { ...path, guides: dynamic.guides };
      }
      return path;
    });
  }, [rawPaths, dynamicGuideData]);

  /**
   * Gets guide metadata, checking dynamic data first then static
   */
  const resolveGuideMetadata = useCallback(
    (guideId: string): GuideMetadataEntry => {
      // Check dynamic metadata from all fetched URL-based paths
      for (const data of Object.values(dynamicGuideData)) {
        if (data.guideMetadata[guideId]) {
          return data.guideMetadata[guideId];
        }
      }
      // Fall back to static metadata from paths.json / paths-cloud.json
      const { guideMetadata } = getPathsData();
      return guideMetadata[guideId] || { title: guideId, estimatedMinutes: 5 };
    },
    [dynamicGuideData]
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
      console.warn('Failed to load learning progress:', error);
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

    window.addEventListener('learning-progress-updated', handleProgressUpdate);

    return () => {
      mounted.current = false;
      window.removeEventListener('learning-progress-updated', handleProgressUpdate);
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

        const metadata = resolveGuideMetadata(guideId);

        return {
          id: guideId,
          title: metadata.title,
          completed,
          isCurrent,
        };
      });
    },
    [paths, progress.completedGuides, resolveGuideMetadata]
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

  // Mark a guide as completed
  // Badge awarding is handled in user-storage.ts, state is updated via event listener
  const markGuideCompleted = useCallback(
    async (guideId: string): Promise<void> => {
      // Skip if already completed
      if (progress.completedGuides.includes(guideId)) {
        return;
      }

      // Delegate to storage - it handles badge awarding and dispatches events
      await learningProgressStorage.markGuideCompleted(guideId);
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
        // URL-based path: clear milestone tracking and journey completion
        await milestoneCompletionStorage.clear(path.url);
        await journeyCompletionStorage.clear(path.url);

        // Remove milestone slugs from completedGuides (path.guides contains fetched slugs)
        if (path.guides.length > 0) {
          await learningProgressStorage.removeCompletedGuides(path.guides);
        }

        // Clear interactive steps for milestone URLs (iterate over completed milestones)
        // Since we don't have the full milestone URLs stored, clear by prefix pattern
        // The content keys for milestones start with the path URL
        const completions = await interactiveCompletionStorage.getAll();
        const journeyCompletions = await journeyCompletionStorage.getAll();

        for (const key of Object.keys(completions)) {
          if (key.startsWith(path.url.replace(/\/+$/, ''))) {
            await interactiveCompletionStorage.clear(key);
            await interactiveStepStorage.clearAllForContent(key);
          }
        }
        for (const key of Object.keys(journeyCompletions)) {
          if (key.startsWith(path.url.replace(/\/+$/, ''))) {
            await journeyCompletionStorage.clear(key);
          }
        }
      } else {
        // Static bundled path: clear each guide's progress
        for (const guideId of path.guides) {
          const contentKey = `bundled:${guideId}`;
          await interactiveStepStorage.clearAllForContent(contentKey);
          await interactiveCompletionStorage.clear(contentKey);
          await journeyCompletionStorage.clear(contentKey);
        }

        // Remove guide IDs from completedGuides
        await learningProgressStorage.removeCompletedGuides(path.guides);
      }

      // Dispatch event to notify UI components to refresh
      window.dispatchEvent(
        new CustomEvent('interactive-progress-cleared', {
          detail: { contentKey: '*', pathId },
        })
      );

      // Reload progress to update UI
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
