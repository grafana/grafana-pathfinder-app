/**
 * Badge Earning Logic
 *
 * Badge definitions are no longer hardcoded here — they come from the
 * platform index served by the interactive-learning CDN (see
 * `paths-data.ts`) with a bundled fallback (`bundled-courses.ts`).
 *
 * Lookup helpers (`getBadgeById`, `getBadgesByTriggerType`,
 * `getTotalBadgeCount`) read from the module-scoped cache in
 * `paths-data.ts`. Award helpers take an explicit badges list so callers
 * with a snapshot (the hook, user-storage) can pass it directly.
 */

import type { Badge, BadgeTrigger, LearningProgress, LearningPath } from '../types/learning-paths.types';

import { getPathsData } from './paths-data';

/**
 * Checks if a specific badge should be awarded based on current progress
 */
export function shouldAwardBadge(badge: Badge, progress: LearningProgress, paths: LearningPath[]): boolean {
  if (progress.earnedBadges.some((b) => b.id === badge.id)) {
    return false;
  }
  return checkTrigger(badge.trigger, progress, paths);
}

function checkTrigger(trigger: BadgeTrigger, progress: LearningProgress, paths: LearningPath[]): boolean {
  switch (trigger.type) {
    case 'guide-completed':
      if (trigger.guideId) {
        return progress.completedGuides.includes(trigger.guideId);
      }
      return progress.completedGuides.length > 0;

    case 'path-completed':
      return isPathCompleted(trigger.pathId, progress, paths);

    case 'streak':
      return progress.streakDays >= trigger.days;

    default:
      return false;
  }
}

function isPathCompleted(pathId: string, progress: LearningProgress, paths: LearningPath[]): boolean {
  const path = paths.find((p) => p.id === pathId);
  if (!path || path.guides.length === 0) {
    // URL-based paths have empty static guides (fetched dynamically). [].every()
    // is vacuously true; badge awarding for URL-based paths is handled by
    // markMilestoneDone in user-storage instead.
    return false;
  }
  return path.guides.every((guideId) => progress.completedGuides.includes(guideId));
}

/**
 * Returns the IDs of every badge in `badges` that should be awarded given
 * current `progress` and `paths`. Caller supplies the badges list.
 */
export function getBadgesToAward(progress: LearningProgress, paths: LearningPath[], badges: Badge[]): string[] {
  return badges.filter((badge) => shouldAwardBadge(badge, progress, paths)).map((badge) => badge.id);
}

/**
 * Looks up a badge in the current cache (CDN or fallback).
 */
export function getBadgeById(badgeId: string): Badge | undefined {
  return getPathsData().badges.find((b) => b.id === badgeId);
}

export function getBadgesByTriggerType(type: BadgeTrigger['type']): Badge[] {
  return getPathsData().badges.filter((b) => b.trigger.type === type);
}

export function getEarnedBadgeCount(progress: LearningProgress): number {
  return progress.earnedBadges.length;
}

export function getTotalBadgeCount(): number {
  return getPathsData().badges.length;
}

/**
 * Sorts badges with earned first, then by unlock order
 */
export function sortBadgesForDisplay(badges: Badge[], earnedBadgeIds: string[]): Badge[] {
  return [...badges].sort((a, b) => {
    const aEarned = earnedBadgeIds.includes(a.id);
    const bEarned = earnedBadgeIds.includes(b.id);

    if (aEarned && !bEarned) {
      return -1;
    }
    if (!aEarned && bEarned) {
      return 1;
    }
    return 0;
  });
}
