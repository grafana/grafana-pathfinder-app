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
  getBadgesToAward,
  getBadgeById,
  getBadgesByTriggerType,
  getEarnedBadgeCount,
  getTotalBadgeCount,
  sortBadgesForDisplay,
} from './badges';

// Bundled fallback (offline mode)
export { FALLBACK_BADGES, FALLBACK_COURSES } from './bundled-courses';

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
export { getPathsData, initCoursesData, resetCoursesData } from './paths-data';
export type { PathsDataSet, CoursesDataSource } from './paths-data';

// CDN fetch (exposed for tests / direct callers)
export { fetchCourses, resetFetchCoursesCache } from './fetch-courses';
export type { CoursesPlatform } from './fetch-courses';
