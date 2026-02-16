/**
 * useNextLearningAction Hook
 *
 * Provides a compact summary of the user's learning profile for display
 * in the UserProfileBar. Wraps useLearningPaths() and computes the next
 * recommended action (guide to open) plus summary statistics.
 */

import { useMemo } from 'react';

import { useLearningPaths } from './learning-paths.hook';
import type { LearningPath, PathGuide, GuideMetadataEntry } from '../types/learning-paths.types';

import pathsData from './paths.json';

// ============================================================================
// TYPES
// ============================================================================

export interface NextLearningAction {
  guideId: string;
  guideTitle: string;
  guideUrl: string;
  pathTitle: string;
  pathProgress: number;
}

export interface LearningProfileSummary {
  badgesEarned: number;
  badgesTotal: number;
  guidesCompleted: number;
  streakDays: number;
  isActiveToday: boolean;
  nextAction: NextLearningAction | null;
  isLoading: boolean;
}

// ============================================================================
// PURE COMPUTATION
// ============================================================================

interface ComputeNextActionDeps {
  paths: LearningPath[];
  getPathProgress: (pathId: string) => number;
  getPathGuides: (pathId: string) => PathGuide[];
  isPathCompleted: (pathId: string) => boolean;
}

/**
 * Computes the next learning action from available paths.
 *
 * Priority: in-progress paths first (highest progress), then not-started,
 * skips completed paths entirely.
 */
export function computeNextAction(deps: ComputeNextActionDeps): NextLearningAction | null {
  const { paths, getPathProgress, getPathGuides, isPathCompleted } = deps;

  // Sort paths: in-progress first (highest progress), then not-started, skip completed
  const sorted = [...paths].sort((a, b) => {
    const aProgress = getPathProgress(a.id);
    const bProgress = getPathProgress(b.id);
    const aCompleted = isPathCompleted(a.id);
    const bCompleted = isPathCompleted(b.id);

    if (aCompleted !== bCompleted) {
      return aCompleted ? 1 : -1;
    }

    const aInProgress = aProgress > 0 && !aCompleted;
    const bInProgress = bProgress > 0 && !bCompleted;
    if (aInProgress !== bInProgress) {
      return aInProgress ? -1 : 1;
    }

    if (aInProgress && bInProgress) {
      return bProgress - aProgress;
    }

    return 0;
  });

  // Find the first non-completed path
  const targetPath = sorted.find((p) => !isPathCompleted(p.id));
  if (!targetPath) {
    return null;
  }

  // Find the current guide in that path
  const guides = getPathGuides(targetPath.id);
  const currentGuide = guides.find((g) => g.isCurrent);
  if (!currentGuide) {
    return null;
  }

  // Look up guide metadata for URL
  const metadata = (pathsData.guideMetadata as Record<string, GuideMetadataEntry>)[currentGuide.id];
  const guideUrl = metadata?.url ?? `bundled:${currentGuide.id}`;

  return {
    guideId: currentGuide.id,
    guideTitle: currentGuide.title,
    guideUrl,
    pathTitle: targetPath.title,
    pathProgress: getPathProgress(targetPath.id),
  };
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook that provides a compact learning profile summary.
 * Designed for the UserProfileBar component.
 */
export function useNextLearningAction(): LearningProfileSummary {
  const { paths, badgesWithStatus, progress, getPathGuides, getPathProgress, isPathCompleted, streakInfo, isLoading } =
    useLearningPaths();

  const nextAction = useMemo(
    () => computeNextAction({ paths, getPathProgress, getPathGuides, isPathCompleted }),
    [paths, getPathProgress, getPathGuides, isPathCompleted]
  );

  const badgesEarned = useMemo(
    () => badgesWithStatus.filter((b) => !!b.earnedAt && !b.isLegacy).length,
    [badgesWithStatus]
  );

  const badgesTotal = useMemo(() => badgesWithStatus.filter((b) => !b.isLegacy).length, [badgesWithStatus]);

  return {
    badgesEarned,
    badgesTotal,
    guidesCompleted: progress.completedGuides.length,
    streakDays: streakInfo.days,
    isActiveToday: streakInfo.isActiveToday,
    nextAction,
    isLoading,
  };
}
