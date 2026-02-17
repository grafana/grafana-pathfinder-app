/**
 * Learning Paths Module
 *
 * Exports for the gamified learning system with structured paths,
 * progress tracking, and badges.
 */

// Main hook
export { useLearningPaths, useGuideCompletion } from './learning-paths.hook';

// Profile summary hook
export { useNextLearningAction, computeNextAction } from './useNextLearningAction';
export type { LearningProfileSummary, NextLearningAction } from './useNextLearningAction';

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

// Path data (runtime platform selection)
export { getPathsData } from './paths-data';
export type { PathsDataSet } from './paths-data';
