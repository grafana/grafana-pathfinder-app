/**
 * Learning Paths Module
 *
 * Exports for the gamified learning system with structured paths,
 * progress tracking, and achievement badges.
 */

// Main hook
export { useLearningPaths, useGuideCompletion } from './learning-paths.hook';

// Badge utilities
export {
  BADGES,
  getBadgesToAward,
  getBadgeById,
  getBadgesByTriggerType,
  getEarnedBadgeCount,
  getTotalBadgeCount,
  sortBadgesForDisplay,
} from './badges';

// Streak utilities
export {
  getTodayDateString,
  getYesterdayDateString,
  calculateUpdatedStreak,
  getStreakInfo,
  shouldShowStreak,
  getStreakMessage,
  STREAK_MILESTONES,
  checkStreakMilestone,
  getNextMilestone,
  getMilestoneProgress,
} from './streak-tracker';

// Path data
export { default as pathsData } from './paths.json';
