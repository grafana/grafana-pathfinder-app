/**
 * Learning Paths and Badges Type Definitions
 *
 * Types for the gamified learning system with structured paths,
 * progress tracking, and achievement badges.
 */

// ============================================================================
// LEARNING PATH TYPES
// ============================================================================

/**
 * Represents a structured learning path containing multiple guides.
 * Completing all guides in a path awards the associated badge.
 */
export interface LearningPath {
  /** Unique identifier for the path */
  id: string;
  /** Display title for the path */
  title: string;
  /** Brief description of what the user will learn */
  description: string;
  /** Ordered array of guide IDs from bundled-interactives */
  guides: string[];
  /** Badge ID awarded upon path completion */
  badgeId: string;
  /** Target platform (omit for both) */
  targetPlatform?: 'oss' | 'cloud';
  /** Estimated time to complete in minutes */
  estimatedMinutes?: number;
  /** Icon name for the path (Grafana icon) */
  icon?: string;
}

/**
 * Guide metadata for display within a learning path
 */
export interface PathGuide {
  /** Guide ID matching bundled-interactives */
  id: string;
  /** Display title */
  title: string;
  /** Whether this guide has been completed */
  completed: boolean;
  /** Whether this is the current/next guide to complete */
  isCurrent: boolean;
}

// ============================================================================
// BADGE TYPES
// ============================================================================

/**
 * Badge trigger types determine when a badge is awarded
 */
export type BadgeTrigger =
  | { type: 'guide-completed'; guideId?: string } // Any guide or specific guide
  | { type: 'path-completed'; pathId: string } // Complete a specific path
  | { type: 'streak'; days: number }; // Maintain streak for N days

/**
 * Represents an achievement badge that users can earn
 */
export interface Badge {
  /** Unique identifier for the badge */
  id: string;
  /** Display title for the badge */
  title: string;
  /** Description of how to earn the badge */
  description: string;
  /** Grafana icon name */
  icon: string;
  /** Trigger condition for earning this badge */
  trigger: BadgeTrigger;
}

/**
 * Badge with earned state for display
 */
export interface EarnedBadge extends Badge {
  /** Timestamp when earned (undefined if not earned) */
  earnedAt?: number;
  /** Whether this badge was recently earned (for animations) */
  isNew?: boolean;
}

// ============================================================================
// PROGRESS TYPES
// ============================================================================

/**
 * User's learning progress stored in localStorage/Grafana storage
 */
export interface LearningProgress {
  /** Array of completed guide IDs */
  completedGuides: string[];
  /** Array of earned badge IDs with timestamps */
  earnedBadges: EarnedBadgeRecord[];
  /** Current streak in days */
  streakDays: number;
  /** Last activity date in ISO format (YYYY-MM-DD) */
  lastActivityDate: string;
  /** Badge IDs that were recently earned (for showing celebration) */
  pendingCelebrations: string[];
}

/**
 * Record of an earned badge with timestamp
 */
export interface EarnedBadgeRecord {
  /** Badge ID */
  id: string;
  /** Timestamp when earned */
  earnedAt: number;
}

/**
 * Default/initial learning progress state
 */
export const DEFAULT_LEARNING_PROGRESS: LearningProgress = {
  completedGuides: [],
  earnedBadges: [],
  streakDays: 0,
  lastActivityDate: '',
  pendingCelebrations: [],
};

// ============================================================================
// COMPONENT PROP TYPES
// ============================================================================

/**
 * Props for the LearningPathCard component
 */
export interface LearningPathCardProps {
  /** The learning path to display */
  path: LearningPath;
  /** Guides with completion status */
  guides: PathGuide[];
  /** Completion percentage (0-100) */
  progress: number;
  /** Whether this path is fully completed */
  isCompleted: boolean;
  /** Callback when user clicks to continue/start the path */
  onContinue: (guideId: string) => void;
}

/**
 * Props for the ProgressRing component
 */
export interface ProgressRingProps {
  /** Progress percentage (0-100) */
  progress: number;
  /** Size in pixels */
  size?: number;
  /** Stroke width in pixels */
  strokeWidth?: number;
  /** Whether the path is completed */
  isCompleted?: boolean;
  /** Whether to show percentage text */
  showPercentage?: boolean;
}

/**
 * Props for the BadgesDisplay component
 */
export interface BadgesDisplayProps {
  /** All available badges with earned state */
  badges: EarnedBadge[];
  /** Callback when user clicks a badge */
  onBadgeClick?: (badge: EarnedBadge) => void;
}

/**
 * Props for the BadgeUnlockedToast component
 */
export interface BadgeUnlockedToastProps {
  /** The badge that was unlocked */
  badge: Badge;
  /** Callback when toast is dismissed */
  onDismiss: () => void;
}

// ============================================================================
// HOOK RETURN TYPES
// ============================================================================

/**
 * Return type for the useLearningPaths hook
 */
export interface UseLearningPathsReturn {
  /** Available learning paths (filtered by platform) */
  paths: LearningPath[];
  /** All available badges */
  allBadges: Badge[];
  /** Badges with earned state */
  badgesWithStatus: EarnedBadge[];
  /** Current learning progress */
  progress: LearningProgress;
  /** Get guides for a specific path with completion status */
  getPathGuides: (pathId: string) => PathGuide[];
  /** Get completion percentage for a path */
  getPathProgress: (pathId: string) => number;
  /** Check if a path is completed */
  isPathCompleted: (pathId: string) => boolean;
  /** Mark a guide as completed (triggers badge checks) */
  markGuideCompleted: (guideId: string) => Promise<void>;
  /** Dismiss a pending celebration */
  dismissCelebration: (badgeId: string) => Promise<void>;
  /** Current streak display info */
  streakInfo: StreakInfo;
  /** Loading state */
  isLoading: boolean;
}

/**
 * Streak information for display
 */
export interface StreakInfo {
  /** Current streak in days */
  days: number;
  /** Whether user has been active today */
  isActiveToday: boolean;
  /** Whether the streak is at risk (no activity yesterday) */
  isAtRisk: boolean;
}
