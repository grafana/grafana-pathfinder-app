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
import { reportAppInteraction, UserInteraction } from '../lib/analytics';
import { FALLBACK_BADGES } from './bundled-courses';
import { getStreakInfo } from './streak-tracker';
import { getPathsData, initCoursesData } from './paths-data';

/**
 * A guide entry is a URL guide when it parses as an absolute http(s) URL.
 * Keep this conservative: just protocol-prefix check, no full URL parse.
 */
function isUrlGuide(entry: string): boolean {
  return entry.startsWith('http://') || entry.startsWith('https://');
}

/**
 * Derive a fallback display title for a URL guide from its path segments.
 * "https://grafana.com/docs/learning-paths/foo/bar/" -> "Bar".
 */
function deriveUrlGuideTitle(url: string): string {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1] ?? '';
    return last
      .split('-')
      .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ''))
      .join(' ');
  } catch {
    return url;
  }
}

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

  // CDN course-list loading state
  const [coursesLoaded, setCoursesLoaded] = useState(false);
  const [usingFallback, setUsingFallback] = useState(false);

  // Load CDN course list (or fall back to bundled) on mount
  useEffect(() => {
    let mounted = true;
    void (async () => {
      const { source } = await initCoursesData();
      if (!mounted) {
        return;
      }
      setUsingFallback(source === 'fallback');
      setCoursesLoaded(true);
      if (source === 'fallback') {
        reportAppInteraction(UserInteraction.CoursesFallbackUsed);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Paths for the current platform. Re-derives once the CDN fetch settles.
  const paths = useMemo((): LearningPath[] => {
    return getPathsData().paths;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coursesLoaded]);

  /**
   * Resolves display metadata for a guide entry.
   *
   * For URL entries, the entry string is the URL; title is taken from any
   * authored `guideMetadata[<url>]` and otherwise derived from the URL path.
   * For ID entries, falls back to `guideMetadata[<id>]` or a generic stub.
   */
  const resolveGuideMetadata = useCallback((guideId: string): GuideMetadataEntry => {
    const { guideMetadata } = getPathsData();
    const authored = guideMetadata[guideId];
    if (authored) {
      return authored;
    }
    if (isUrlGuide(guideId)) {
      return { title: deriveUrlGuideTitle(guideId), estimatedMinutes: 5, url: guideId };
    }
    return { title: guideId, estimatedMinutes: 5 };
  }, []);

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

  // Authoritative badge list: CDN-served when available, fallback otherwise.
  const allBadges = useMemo(() => {
    return coursesLoaded ? (getPathsData().badges ?? FALLBACK_BADGES) : FALLBACK_BADGES;
  }, [coursesLoaded]);

  // Get badges with earned status (including legacy badges from previous versions)
  const badgesWithStatus = useMemo((): EarnedBadge[] => {
    // Start with all currently defined badges
    const definedBadges = allBadges.map((badge) => {
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
      .filter((earned) => !allBadges.find((b) => b.id === earned.id))
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
  }, [allBadges, progress.earnedBadges, progress.pendingCelebrations]);

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
          url: metadata.url,
        };
      });
    },
    [paths, progress.completedGuides, resolveGuideMetadata]
  );

  // Per-guide URL lookup. Returns the URL for a URL-typed guide entry, or the
  // authored remote URL for an ID-typed entry (undefined for bundled IDs).
  // The `pathId` param is kept for API stability but no longer used now that
  // entries are globally unique within a path's guide list.
  const getGuideUrlForPath = useCallback(
    (guideId: string, _pathId: string): string | undefined => {
      return resolveGuideMetadata(guideId).url;
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

  // Reset a path's progress (clears guides and interactive steps, keeps badges).
  // For each entry, the content key is the URL itself (URL guide) or
  // `bundled:<id>` (package-ID guide).
  const resetPath = useCallback(
    async (pathId: string): Promise<void> => {
      const path = paths.find((p) => p.id === pathId);
      if (!path) {
        return;
      }

      const completedMilestoneSlugs = (
        await Promise.all(
          path.guides.map(async (guideId) => {
            if (!isUrlGuide(guideId)) {
              return [];
            }
            const completed = await milestoneCompletionStorage.getCompleted(guideId);
            return Array.from(completed);
          })
        )
      ).flat();

      await Promise.all(
        path.guides.map((guideId) => {
          const contentKey = isUrlGuide(guideId) ? guideId : `bundled:${guideId}`;
          return Promise.all([
            interactiveStepStorage.clearAllForContent(contentKey),
            interactiveCompletionStorage.clear(contentKey),
            journeyCompletionStorage.clear(contentKey),
            ...(isUrlGuide(guideId) ? [milestoneCompletionStorage.clear(guideId)] : []),
          ]);
        })
      );

      await learningProgressStorage.removeCompletedGuides([...path.guides, ...completedMilestoneSlugs]);

      window.dispatchEvent(
        new CustomEvent('interactive-progress-cleared', {
          detail: { contentKey: '*', pathId },
        })
      );

      await loadProgress({ current: true });
    },
    [paths, loadProgress]
  );

  return {
    paths,
    allBadges,
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
    isLoadingCourses: !coursesLoaded,
    usingFallback,
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
