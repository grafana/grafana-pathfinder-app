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
} from '../types/learning-paths.types';

import { learningProgressStorage } from '../lib/user-storage';
import { BADGES, getBadgesToAward } from './badges';
import {
  calculateUpdatedStreak,
  getStreakInfo,
  getTodayDateString,
} from './streak-tracker';

// Import path definitions
import pathsData from './paths.json';

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
 * Filters paths based on current Grafana edition
 */
function filterPathsByPlatform(paths: LearningPath[]): LearningPath[] {
  const isCloud = config.bootData?.settings?.cloudMigrationIsTarget ?? false;
  const edition = isCloud ? 'cloud' : 'oss';

  return paths.filter((path) => {
    if (!path.targetPlatform) {
      return true; // No platform restriction
    }
    return path.targetPlatform === edition;
  });
}

/**
 * Gets guide metadata from paths.json
 */
function getGuideMetadata(guideId: string): { title: string; estimatedMinutes: number } {
  const metadata = (pathsData.guideMetadata as Record<string, { title: string; estimatedMinutes: number }>)[guideId];
  return metadata || { title: guideId, estimatedMinutes: 5 };
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

  // Filter paths by platform (needed for badge checking)
  const paths = useMemo(() => {
    return filterPathsByPlatform(pathsData.paths as LearningPath[]);
  }, []);

  // Load progress and check for badges - extracted for reuse
  const loadAndCheckProgress = useCallback(async (mounted: { current: boolean }) => {
    try {
      const stored = await learningProgressStorage.get();

      if (!mounted.current) {
        return;
      }

      // Check for any badges that should be awarded (e.g., from guide completion via storage)
      const badgesToAward = getBadgesToAward(stored, paths);
      let updatedProgress = stored;
      let needsUpdate = false;

      if (badgesToAward.length > 0) {
        // Award any pending badges
        for (const badgeId of badgesToAward) {
          const alreadyEarned = updatedProgress.earnedBadges.some((b) => b.id === badgeId);
          const alreadyPending = updatedProgress.pendingCelebrations.includes(badgeId);

          if (!alreadyEarned) {
            updatedProgress = {
              ...updatedProgress,
              earnedBadges: [
                ...updatedProgress.earnedBadges,
                { id: badgeId, earnedAt: Date.now() },
              ],
              // Only add to pending if not already there
              pendingCelebrations: alreadyPending
                ? updatedProgress.pendingCelebrations
                : [...updatedProgress.pendingCelebrations, badgeId],
            };
            needsUpdate = true;
          }
        }

        // Persist the updated progress with newly awarded badges
        if (needsUpdate) {
          await learningProgressStorage.update(updatedProgress);
        }
      }

      if (mounted.current) {
        setProgress(updatedProgress);
        setIsLoading(false);
      }
    } catch (error) {
      console.warn('Failed to load learning progress:', error);
      if (mounted.current) {
        setIsLoading(false);
      }
    }
  }, [paths]);

  // Load progress on mount - use IIFE to handle async properly
  useEffect(() => {
    const mounted = { current: true };
    // Load immediately on mount
    void (async () => {
      await loadAndCheckProgress(mounted);
    })();
    return () => {
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for progress updates from other parts of the app (e.g., guide completion)
  useEffect(() => {
    const mounted = { current: true };

    const handleProgressUpdate = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      // If event includes progress data, use it directly for faster update
      if (detail?.progress && mounted.current) {
        setProgress(detail.progress);
      } else {
        // Fallback: re-load progress from storage
        loadAndCheckProgress(mounted);
      }
    };

    window.addEventListener('learning-progress-updated', handleProgressUpdate);

    return () => {
      mounted.current = false;
      window.removeEventListener('learning-progress-updated', handleProgressUpdate);
    };
  }, [loadAndCheckProgress]);

  // Get badges with earned status
  const badgesWithStatus = useMemo((): EarnedBadge[] => {
    return BADGES.map((badge) => {
      const earned = progress.earnedBadges.find((b) => b.id === badge.id);
      const isNew = progress.pendingCelebrations.includes(badge.id);

      return {
        ...badge,
        earnedAt: earned?.earnedAt,
        isNew,
      };
    });
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

        const metadata = getGuideMetadata(guideId);

        return {
          id: guideId,
          title: metadata.title,
          completed,
          isCurrent,
        };
      });
    },
    [paths, progress.completedGuides]
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

  // Mark a guide as completed and check for badges
  const markGuideCompleted = useCallback(
    async (guideId: string): Promise<void> => {
      // Skip if already completed
      if (progress.completedGuides.includes(guideId)) {
        return;
      }

      // Update completed guides
      const newCompletedGuides = [...progress.completedGuides, guideId];

      // Update streak
      const newStreak = calculateUpdatedStreak(progress.streakDays, progress.lastActivityDate);
      const today = getTodayDateString();

      // Create updated progress
      const updatedProgress: LearningProgress = {
        ...progress,
        completedGuides: newCompletedGuides,
        streakDays: newStreak,
        lastActivityDate: today,
      };

      // Check for new badges to award
      const badgesToAward = getBadgesToAward(updatedProgress, paths);

      // Award new badges
      for (const badgeId of badgesToAward) {
        const alreadyEarned = updatedProgress.earnedBadges.some((b) => b.id === badgeId);
        if (!alreadyEarned) {
          updatedProgress.earnedBadges.push({
            id: badgeId,
            earnedAt: Date.now(),
          });
          updatedProgress.pendingCelebrations.push(badgeId);
        }
      }

      // Update state and storage
      setProgress(updatedProgress);
      await learningProgressStorage.update(updatedProgress);
    },
    [progress, paths]
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

  return {
    paths,
    allBadges: BADGES,
    badgesWithStatus,
    progress,
    getPathGuides,
    getPathProgress,
    isPathCompleted,
    markGuideCompleted,
    dismissCelebration,
    streakInfo,
    isLoading,
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
