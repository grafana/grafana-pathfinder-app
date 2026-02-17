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

import { learningProgressStorage } from '../lib/user-storage';
import { BADGES } from './badges';
import { getStreakInfo } from './streak-tracker';

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
    if (edition === 'cloud') {
      return true; // Cloud sees everything (superset of OSS)
    }
    return path.targetPlatform === 'oss'; // OSS only sees OSS paths
  });
}

/**
 * Gets guide metadata from paths.json
 */
function getGuideMetadata(guideId: string): GuideMetadataEntry {
  const metadata = (pathsData.guideMetadata as Record<string, GuideMetadataEntry>)[guideId];
  return metadata || { title: guideId, estimatedMinutes: 5 };
}

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

  // Filter paths by platform (needed for badge checking)
  const paths = useMemo(() => {
    return filterPathsByPlatform(pathsData.paths as LearningPath[]);
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
