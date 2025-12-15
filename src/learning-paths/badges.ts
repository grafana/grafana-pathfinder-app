/**
 * Badge Definitions and Earning Logic
 *
 * Defines all available badges and the logic for checking
 * when they should be awarded.
 */

import type { Badge, BadgeTrigger, LearningProgress, LearningPath } from '../types/learning-paths.types';

// ============================================================================
// BADGE DEFINITIONS
// ============================================================================

/**
 * All available badges in the system
 */
export const BADGES: Badge[] = [
  {
    id: 'first-steps',
    title: 'First steps',
    description: 'Complete your first guide',
    icon: 'rocket',
    trigger: { type: 'guide-completed' },
  },
  {
    id: 'grafana-fundamentals',
    title: 'Grafana Fundamentals',
    description: 'Complete the "Getting started with Grafana" learning path',
    icon: 'grafana',
    trigger: { type: 'path-completed', pathId: 'getting-started' },
  },
  {
    id: 'observability-pioneer',
    title: 'Observability Pioneer',
    description: 'Complete the "Observability basics" learning path',
    icon: 'graph-bar',
    trigger: { type: 'path-completed', pathId: 'observability-basics' },
  },
  {
    id: 'consistent-learner',
    title: 'Consistent Learner',
    description: 'Maintain a 3-day learning streak',
    icon: 'fire',
    trigger: { type: 'streak', days: 3 },
  },
  {
    id: 'dedicated-learner',
    title: 'Dedicated Learner',
    description: 'Maintain a 7-day learning streak',
    icon: 'star',
    trigger: { type: 'streak', days: 7 },
  },
];

// ============================================================================
// BADGE CHECKING LOGIC
// ============================================================================

/**
 * Checks if a specific badge should be awarded based on current progress
 *
 * @param badge - The badge to check
 * @param progress - Current learning progress
 * @param paths - Available learning paths (for path completion checks)
 * @returns true if the badge should be awarded
 */
export function shouldAwardBadge(badge: Badge, progress: LearningProgress, paths: LearningPath[]): boolean {
  // Already earned - don't award again
  if (progress.earnedBadges.some((b) => b.id === badge.id)) {
    return false;
  }

  return checkTrigger(badge.trigger, progress, paths);
}

/**
 * Checks if a trigger condition is met
 */
function checkTrigger(trigger: BadgeTrigger, progress: LearningProgress, paths: LearningPath[]): boolean {
  switch (trigger.type) {
    case 'guide-completed':
      // Any guide completed, or specific guide if specified
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

/**
 * Checks if a learning path is fully completed
 */
function isPathCompleted(pathId: string, progress: LearningProgress, paths: LearningPath[]): boolean {
  const path = paths.find((p) => p.id === pathId);
  if (!path) {
    return false;
  }

  return path.guides.every((guideId) => progress.completedGuides.includes(guideId));
}

/**
 * Gets all badges that should be awarded based on current progress
 *
 * @param progress - Current learning progress
 * @param paths - Available learning paths
 * @returns Array of badge IDs that should be awarded
 */
export function getBadgesToAward(progress: LearningProgress, paths: LearningPath[]): string[] {
  return BADGES.filter((badge) => shouldAwardBadge(badge, progress, paths)).map((badge) => badge.id);
}

/**
 * Gets a badge by ID
 */
export function getBadgeById(badgeId: string): Badge | undefined {
  return BADGES.find((b) => b.id === badgeId);
}

/**
 * Gets badges for a specific trigger type
 */
export function getBadgesByTriggerType(type: BadgeTrigger['type']): Badge[] {
  return BADGES.filter((b) => b.trigger.type === type);
}

// ============================================================================
// BADGE DISPLAY HELPERS
// ============================================================================

/**
 * Gets the count of earned badges
 */
export function getEarnedBadgeCount(progress: LearningProgress): number {
  return progress.earnedBadges.length;
}

/**
 * Gets the total number of available badges
 */
export function getTotalBadgeCount(): number {
  return BADGES.length;
}

/**
 * Sorts badges with earned first, then by unlock order
 */
export function sortBadgesForDisplay(badges: Badge[], earnedBadgeIds: string[]): Badge[] {
  return [...badges].sort((a, b) => {
    const aEarned = earnedBadgeIds.includes(a.id);
    const bEarned = earnedBadgeIds.includes(b.id);

    // Earned badges first
    if (aEarned && !bEarned) {
      return -1;
    }
    if (!aEarned && bEarned) {
      return 1;
    }

    // Within same earned status, maintain original order
    return 0;
  });
}
