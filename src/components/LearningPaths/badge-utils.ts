/**
 * Badge progress and requirement utilities
 *
 * Pure functions for calculating badge progress and generating requirement text.
 * These functions have no external dependencies beyond type definitions.
 */

import type { Badge } from '../../types';

import { getPathsData } from '../../learning-paths';

/**
 * Information about a badge's progress toward completion
 */
export interface BadgeProgressInfo {
  /** Current progress value */
  current: number;
  /** Total required for completion */
  total: number;
  /** Human-readable label for the progress type */
  label: string;
  /** Percentage complete (0-100) */
  percentage: number;
}

/**
 * Calculates progress information for a badge based on its trigger type
 *
 * @param badge - The badge definition to calculate progress for
 * @param completedGuides - Array of completed guide IDs
 * @param streakDays - Current streak count in days
 * @param paths - Available learning paths with their guides
 * @returns Progress information or null if badge type is unknown
 */
export function getBadgeProgress(
  badge: Badge,
  completedGuides: string[],
  streakDays: number,
  paths: Array<{ id: string; guides: string[] }>
): BadgeProgressInfo | null {
  const { trigger } = badge;

  switch (trigger.type) {
    case 'guide-completed':
      if (trigger.guideId) {
        // Specific guide
        const completed = completedGuides.includes(trigger.guideId);
        return {
          current: completed ? 1 : 0,
          total: 1,
          label: 'guide completed',
          percentage: completed ? 100 : 0,
        };
      }
      // Any guide
      return {
        current: Math.min(completedGuides.length, 1),
        total: 1,
        label: 'guide completed',
        percentage: completedGuides.length > 0 ? 100 : 0,
      };

    case 'path-completed': {
      const path = paths.find((p) => p.id === trigger.pathId);
      if (!path) {
        return null;
      }
      const completedInPath = path.guides.filter((g) => completedGuides.includes(g)).length;
      return {
        current: completedInPath,
        total: path.guides.length,
        label: 'guides in path',
        percentage: Math.round((completedInPath / path.guides.length) * 100),
      };
    }

    case 'streak':
      return {
        current: Math.min(streakDays, trigger.days),
        total: trigger.days,
        label: 'day streak',
        percentage: Math.round((Math.min(streakDays, trigger.days) / trigger.days) * 100),
      };

    default:
      return null;
  }
}

/**
 * Generates human-readable requirement text for a badge
 *
 * @param badge - The badge definition
 * @returns Human-readable description of how to earn the badge
 */
export function getBadgeRequirementText(badge: Badge): string {
  const { trigger } = badge;

  switch (trigger.type) {
    case 'guide-completed':
      return trigger.guideId ? `Complete the "${trigger.guideId}" guide` : 'Complete any learning guide';
    case 'path-completed':
      const pathTitle = getPathsData().paths.find((p) => p.id === trigger.pathId)?.title || trigger.pathId;
      return `Complete all guides in the "${pathTitle}" learning path`;
    case 'streak':
      return `Maintain a ${trigger.days}-day learning streak`;
    default:
      return badge.description;
  }
}
