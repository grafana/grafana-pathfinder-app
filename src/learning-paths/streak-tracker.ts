/**
 * Streak Tracker
 *
 * Handles daily learning streak calculation and updates.
 * Streaks are based on consecutive days with learning activity.
 */

import type { StreakInfo } from '../types/learning-paths.types';

// ============================================================================
// DATE HELPERS
// ============================================================================

/**
 * Gets today's date in YYYY-MM-DD format
 */
export function getTodayDateString(): string {
  return new Date().toISOString().split('T')[0]!;
}

/**
 * Gets yesterday's date in YYYY-MM-DD format
 */
export function getYesterdayDateString(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split('T')[0]!;
}

/**
 * Parses a date string (YYYY-MM-DD) to a Date object at midnight UTC
 */
function parseDate(dateString: string): Date {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!));
}

/**
 * Calculates the difference in days between two dates
 */
function getDaysDifference(date1: string, date2: string): number {
  const d1 = parseDate(date1);
  const d2 = parseDate(date2);
  const diffTime = Math.abs(d2.getTime() - d1.getTime());
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

// ============================================================================
// STREAK CALCULATION
// ============================================================================

/**
 * Calculates the updated streak based on last activity
 *
 * Rules:
 * - If last activity was today: keep current streak
 * - If last activity was yesterday: increment streak by 1
 * - If last activity was more than 1 day ago: reset streak to 1
 * - If no previous activity: start at 1
 *
 * @param currentStreak - The current streak count
 * @param lastActivityDate - Last activity date in YYYY-MM-DD format
 * @returns Updated streak count
 */
export function calculateUpdatedStreak(currentStreak: number, lastActivityDate: string): number {
  const today = getTodayDateString();
  const yesterday = getYesterdayDateString();

  // No previous activity - starting fresh
  if (!lastActivityDate) {
    return 1;
  }

  // Already active today - no change
  if (lastActivityDate === today) {
    return currentStreak;
  }

  // Active yesterday - increment streak
  if (lastActivityDate === yesterday) {
    return currentStreak + 1;
  }

  // Gap in activity - reset to 1
  return 1;
}

/**
 * Gets the current streak status without modification
 * Used for display purposes
 *
 * @param currentStreak - The stored streak count
 * @param lastActivityDate - Last activity date in YYYY-MM-DD format
 * @returns StreakInfo with current status
 */
export function getStreakInfo(currentStreak: number, lastActivityDate: string): StreakInfo {
  const today = getTodayDateString();
  const yesterday = getYesterdayDateString();

  // No activity recorded yet
  if (!lastActivityDate) {
    return {
      days: 0,
      isActiveToday: false,
      isAtRisk: false,
    };
  }

  const isActiveToday = lastActivityDate === today;
  const wasActiveYesterday = lastActivityDate === yesterday;
  const daysSinceActivity = getDaysDifference(lastActivityDate, today);

  // Streak is broken if more than 1 day has passed
  if (daysSinceActivity > 1) {
    return {
      days: 0,
      isActiveToday: false,
      isAtRisk: false,
    };
  }

  return {
    days: currentStreak,
    isActiveToday,
    // At risk if not active today but was active yesterday
    isAtRisk: !isActiveToday && wasActiveYesterday,
  };
}

/**
 * Checks if the streak should be displayed
 * Only show streak if user has some activity
 */
export function shouldShowStreak(streakInfo: StreakInfo): boolean {
  return streakInfo.days > 0 || streakInfo.isAtRisk;
}

/**
 * Gets a message for the streak status
 */
export function getStreakMessage(streakInfo: StreakInfo): string {
  if (streakInfo.days === 0 && !streakInfo.isAtRisk) {
    return 'Start learning to build your streak!';
  }

  if (streakInfo.isAtRisk) {
    return `${streakInfo.days} day streak - learn today to keep it going!`;
  }

  if (streakInfo.days === 1) {
    return '1 day streak - keep it up!';
  }

  return `${streakInfo.days} day streak`;
}

// ============================================================================
// STREAK MILESTONES
// ============================================================================

/**
 * Streak milestone thresholds for special celebrations
 */
export const STREAK_MILESTONES = [3, 7, 14, 30] as const;

/**
 * Checks if a streak milestone was just reached
 *
 * @param previousStreak - Streak before update
 * @param newStreak - Streak after update
 * @returns The milestone reached, or null if none
 */
export function checkStreakMilestone(previousStreak: number, newStreak: number): number | null {
  for (const milestone of STREAK_MILESTONES) {
    if (previousStreak < milestone && newStreak >= milestone) {
      return milestone;
    }
  }
  return null;
}

/**
 * Gets the next milestone to achieve
 */
export function getNextMilestone(currentStreak: number): number | null {
  for (const milestone of STREAK_MILESTONES) {
    if (currentStreak < milestone) {
      return milestone;
    }
  }
  return null;
}

/**
 * Gets progress towards the next milestone as a percentage
 */
export function getMilestoneProgress(currentStreak: number): number {
  const nextMilestone = getNextMilestone(currentStreak);
  if (!nextMilestone) {
    return 100; // All milestones achieved
  }

  // Find the previous milestone
  const milestoneIndex = STREAK_MILESTONES.indexOf(nextMilestone as (typeof STREAK_MILESTONES)[number]);
  const previousMilestone = milestoneIndex > 0 ? STREAK_MILESTONES[milestoneIndex - 1]! : 0;

  const progress = currentStreak - previousMilestone;
  const total = nextMilestone - previousMilestone;

  return Math.round((progress / total) * 100);
}
