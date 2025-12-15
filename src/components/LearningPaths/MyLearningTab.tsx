/**
 * My Learning Tab Component
 *
 * A dedicated gamified tab for learning paths, badges, and progress tracking.
 * Provides a unified experience for users to explore and track their learning journey.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useStyles2, Icon } from '@grafana/ui';
import { css, keyframes } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { t } from '@grafana/i18n';

import { useLearningPaths, BADGES } from '../../learning-paths';
import { LearningPathCard } from './LearningPathCard';
import { SkeletonLoader } from '../SkeletonLoader';
import { FeedbackButton } from '../FeedbackButton/FeedbackButton';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { learningProgressStorage, journeyCompletionStorage } from '../../lib/user-storage';
import type { Badge, EarnedBadge } from '../../types';

// Import paths data for guide metadata
import pathsData from '../../learning-paths/paths.json';

interface MyLearningTabProps {
  onOpenGuide: (url: string, title: string) => void;
}

// ============================================================================
// BADGE PROGRESS CALCULATION
// ============================================================================

interface BadgeProgressInfo {
  current: number;
  total: number;
  label: string;
  percentage: number;
}

function getBadgeProgress(
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

function getBadgeRequirementText(badge: Badge): string {
  const { trigger } = badge;

  switch (trigger.type) {
    case 'guide-completed':
      return trigger.guideId
        ? `Complete the "${trigger.guideId}" guide`
        : 'Complete any learning guide';
    case 'path-completed':
      const pathTitle = (pathsData.paths as Array<{ id: string; title: string }>)
        .find((p) => p.id === trigger.pathId)?.title || trigger.pathId;
      return `Complete all guides in the "${pathTitle}" learning path`;
    case 'streak':
      return `Maintain a ${trigger.days}-day learning streak`;
    default:
      return badge.description;
  }
}

// ============================================================================
// BADGE DETAIL CARD COMPONENT
// ============================================================================

interface BadgeDetailCardProps {
  badge: EarnedBadge;
  progress: BadgeProgressInfo | null;
  onClose: () => void;
}

function BadgeDetailCard({ badge, progress, onClose }: BadgeDetailCardProps) {
  const styles = useStyles2(getBadgeDetailStyles);
  const isEarned = !!badge.earnedAt;
  const isLegacy = badge.isLegacy;
  const requirementText = isLegacy
    ? 'This badge was earned in a previous version of Pathfinder'
    : getBadgeRequirementText(badge);

  // Determine icon wrapper class based on badge state
  const iconWrapperClass = isLegacy
    ? `${styles.iconWrapper} ${styles.iconLegacy}`
    : isEarned
      ? `${styles.iconWrapper} ${styles.iconEarned}`
      : `${styles.iconWrapper} ${styles.iconLocked}`;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        {/* Close button */}
        <button className={styles.closeButton} onClick={onClose}>
          <Icon name="times" size="lg" />
        </button>

        {/* Badge Icon with glow effect */}
        <div className={iconWrapperClass}>
          {!isLegacy && <div className={styles.iconGlow} />}
          <Icon name={badge.icon as any} size="xxxl" />
          {isEarned && !isLegacy && <div className={styles.checkmark}><Icon name="check" size="sm" /></div>}
          {isLegacy && <div className={styles.legacyIndicator}><Icon name="history" size="sm" /></div>}
        </div>

        {/* Title */}
        <h3 className={styles.title}>{badge.title}</h3>

        {/* Status badge */}
        <div className={`${styles.statusBadge} ${isLegacy ? styles.statusLegacy : isEarned ? styles.statusEarned : styles.statusLocked}`}>
          {isLegacy ? '📜 Legacy' : isEarned ? '✨ Unlocked' : '🔒 Locked'}
        </div>

        {/* Earned date or requirement */}
        {isEarned && badge.earnedAt ? (
          <p className={styles.earnedDate}>
            Earned on {new Date(badge.earnedAt).toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
        ) : !isLegacy ? (
          <p className={styles.description}>{badge.description}</p>
        ) : null}

        {/* Requirement section */}
        <div className={styles.requirementSection}>
          <div className={styles.requirementLabel}>
            {isLegacy ? 'Note' : isEarned ? 'Completed' : 'Requirement'}
          </div>
          <div className={styles.requirementText}>{requirementText}</div>
        </div>

        {/* Progress section (only for locked badges that aren't legacy) */}
        {!isEarned && !isLegacy && progress && progress.total > 0 && (
          <div className={styles.progressSection}>
            <div className={styles.progressHeader}>
              <span className={styles.progressLabel}>Progress</span>
              <span className={styles.progressValue}>
                {progress.current}/{progress.total} {progress.label}
              </span>
            </div>
            <div className={styles.progressBarOuter}>
              <div
                className={styles.progressBarInner}
                style={{ width: `${progress.percentage}%` }}
              />
              <div
                className={styles.progressBarShimmer}
                style={{ width: `${progress.percentage}%` }}
              />
            </div>
            <div className={styles.progressPercentage}>{progress.percentage}%</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function MyLearningTab({ onOpenGuide }: MyLearningTabProps) {
  const styles = useStyles2(getMyLearningStyles);
  const [showAllBadges, setShowAllBadges] = useState(false);
  const [selectedBadge, setSelectedBadge] = useState<EarnedBadge | null>(null);
  const [hideCompletedPaths, setHideCompletedPaths] = useState(false);

  const {
    paths,
    badgesWithStatus,
    progress,
    getPathGuides,
    getPathProgress,
    isPathCompleted,
    streakInfo,
    isLoading,
  } = useLearningPaths();

  // Sort and filter paths: in-progress first, then not-started, then completed
  const sortedPaths = useMemo(() => {
    const sorted = [...paths].sort((a, b) => {
      const aProgress = getPathProgress(a.id);
      const bProgress = getPathProgress(b.id);
      const aCompleted = isPathCompleted(a.id);
      const bCompleted = isPathCompleted(b.id);

      // Completed paths go last
      if (aCompleted !== bCompleted) {
        return aCompleted ? 1 : -1;
      }

      // In-progress (has some progress but not complete) goes first
      const aInProgress = aProgress > 0 && !aCompleted;
      const bInProgress = bProgress > 0 && !bCompleted;
      if (aInProgress !== bInProgress) {
        return aInProgress ? -1 : 1;
      }

      // Among in-progress, sort by progress (higher first)
      if (aInProgress && bInProgress) {
        return bProgress - aProgress;
      }

      // Keep original order for others
      return 0;
    });

    // Filter out completed if toggle is on
    if (hideCompletedPaths) {
      return sorted.filter((path) => !isPathCompleted(path.id));
    }

    return sorted;
  }, [paths, getPathProgress, isPathCompleted, hideCompletedPaths]);

  // Count completed paths for the toggle label
  const completedPathsCount = useMemo(
    () => paths.filter((path) => isPathCompleted(path.id)).length,
    [paths, isPathCompleted]
  );

  // Calculate progress for selected badge
  const selectedBadgeProgress = useMemo(() => {
    if (!selectedBadge) {
      return null;
    }
    const baseBadge = BADGES.find((b) => b.id === selectedBadge.id);
    if (!baseBadge) {
      return null;
    }
    return getBadgeProgress(
      baseBadge,
      progress.completedGuides,
      progress.streakDays,
      paths.map((p) => ({ id: p.id, guides: p.guides }))
    );
  }, [selectedBadge, progress.completedGuides, progress.streakDays, paths]);

  // Handle opening a guide
  const handleOpenGuide = useCallback(
    (guideId: string) => {
      const guideMetadata = (pathsData.guideMetadata as Record<string, { title: string }>)[guideId];
      const title = guideMetadata?.title || guideId;

      reportAppInteraction(UserInteraction.OpenResourceClick, {
        content_title: title,
        content_url: `bundled:${guideId}`,
        content_type: 'learning-journey',
        interaction_location: 'my_learning_tab',
      });

      // Track learning path progress when user opens a guide from a path
      const parentPath = paths.find((p) => p.guides.includes(guideId));
      if (parentPath) {
        const pathProgress = getPathProgress(parentPath.id);
        const pathGuides = getPathGuides(parentPath.id);
        const completedCount = pathGuides.filter((g) => g.completed).length;

        reportAppInteraction(UserInteraction.LearningPathProgress, {
          path_id: parentPath.id,
          path_title: parentPath.title,
          completion_percent: pathProgress,
          guides_total: parentPath.guides.length,
          guides_completed: completedCount,
        });
      }

      onOpenGuide(`bundled:${guideId}`, title);
    },
    [onOpenGuide, paths, getPathProgress, getPathGuides]
  );

  // Handle reset all progress (for testing)
  const handleResetProgress = useCallback(async () => {
    if (window.confirm('Reset all learning progress? This will clear completed guides, badges, and streaks.')) {
      await learningProgressStorage.clear();
      // Also clear journey completion percentages
      const completions = await journeyCompletionStorage.getAll();
      for (const url of Object.keys(completions)) {
        await journeyCompletionStorage.clear(url);
      }
    }
  }, []);

  const totalGuidesCompleted = progress.completedGuides.length;
  const totalBadgesEarned = progress.earnedBadges.length;
  const totalBadges = badgesWithStatus.length;

  // Sort badges: unearned first (by progress %), then earned (most recent first)
  const sortedBadges = useMemo(() => {
    const pathsForProgress = paths.map((p) => ({ id: p.id, guides: p.guides }));

    return [...badgesWithStatus].sort((a, b) => {
      const aEarned = !!a.earnedAt;
      const bEarned = !!b.earnedAt;

      // Unearned badges come first
      if (aEarned !== bEarned) {
        return aEarned ? 1 : -1;
      }

      // Both earned: sort by earnedAt (most recent first)
      if (aEarned && bEarned) {
        return (b.earnedAt || 0) - (a.earnedAt || 0);
      }

      // Both unearned: sort by progress percentage (highest first)
      const baseBadgeA = BADGES.find((badge) => badge.id === a.id);
      const baseBadgeB = BADGES.find((badge) => badge.id === b.id);

      const progressA = baseBadgeA
        ? getBadgeProgress(baseBadgeA, progress.completedGuides, progress.streakDays, pathsForProgress)?.percentage || 0
        : 0;
      const progressB = baseBadgeB
        ? getBadgeProgress(baseBadgeB, progress.completedGuides, progress.streakDays, pathsForProgress)?.percentage || 0
        : 0;

      return progressB - progressA;
    });
  }, [badgesWithStatus, progress.completedGuides, progress.streakDays, paths]);

  // Badges to display (4 preview or all)
  const displayedBadges = showAllBadges ? sortedBadges : sortedBadges.slice(0, 4);

  if (isLoading) {
    return (
      <div className={styles.container}>
        <SkeletonLoader type="recommendations" />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Hero Section */}
      <div className={styles.heroSection}>
        <div className={styles.heroContent}>
          <h1 className={styles.heroTitle}>
            {t('myLearning.title', 'My learning')}
          </h1>
          <p className={styles.heroSubtitle}>
            {t('myLearning.subtitle', 'Track your progress, earn badges, and master Grafana')}
          </p>
        </div>

        {/* Stats Row */}
        <div className={styles.statsRow}>
          <div className={styles.statItem}>
            <div className={styles.statValue}>{totalGuidesCompleted}</div>
            <div className={styles.statLabel}>
              {t('myLearning.guidesCompleted', 'Guides completed')}
            </div>
          </div>
          <div className={styles.statDivider} />
          <div className={styles.statItem}>
            <div className={styles.statValue}>
              {totalBadgesEarned}/{totalBadges}
            </div>
            <div className={styles.statLabel}>
              {t('myLearning.badgesEarned', 'Badges earned')}
            </div>
          </div>
          {streakInfo.days > 0 && (
            <>
              <div className={styles.statDivider} />
              <div className={styles.statItem}>
                <div className={styles.statValueStreak}>
                  <span className={styles.fireEmoji}>🔥</span>
                  {streakInfo.days}
                </div>
                <div className={styles.statLabel}>
                  {t('myLearning.dayStreak', 'Day streak')}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Preview Notice */}
        <div className={styles.previewNotice}>
          <Icon name="info-circle" size="sm" />
          <span>Learning paths and badges are in preview. Content may change as we refine the experience.</span>
        </div>
      </div>

      {/* Learning Paths Section */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <Icon name="book-open" size="md" className={styles.sectionIcon} />
          <h2 className={styles.sectionTitle}>
            {t('myLearning.learningPaths', 'Learning paths')}
          </h2>
          {/* Hide completed toggle */}
          {completedPathsCount > 0 && (
            <label className={styles.hideCompletedToggle}>
              <input
                type="checkbox"
                checked={hideCompletedPaths}
                onChange={(e) => setHideCompletedPaths(e.target.checked)}
                className={styles.hideCompletedCheckbox}
              />
              <span className={styles.hideCompletedLabel}>
                Hide completed ({completedPathsCount})
              </span>
            </label>
          )}
        </div>
        <p className={styles.sectionDescription}>
          {t('myLearning.pathsDescription', 'Structured guides to help you master Grafana step by step')}
        </p>

        <div className={styles.pathsGrid}>
          {sortedPaths.map((path, index) => {
            const pathProgress = getPathProgress(path.id);
            const pathCompleted = isPathCompleted(path.id);
            // Expand the first in-progress path by default
            const isFirstInProgress = index === 0 && pathProgress > 0 && !pathCompleted;

            return (
              <LearningPathCard
                key={path.id}
                path={path}
                guides={getPathGuides(path.id)}
                progress={pathProgress}
                isCompleted={pathCompleted}
                onContinue={handleOpenGuide}
                defaultExpanded={isFirstInProgress}
              />
            );
          })}
          {sortedPaths.length === 0 && hideCompletedPaths && (
            <div className={styles.emptyPathsMessage}>
              <Icon name="check-circle" size="xl" className={styles.emptyPathsIcon} />
              <p>All paths completed! Uncheck &ldquo;Hide completed&rdquo; to review them.</p>
            </div>
          )}
        </div>
      </div>

      {/* Badges Section - Expandable Inline */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <Icon name="star" size="md" className={styles.sectionIcon} />
          <h2 className={styles.sectionTitle}>
            {t('myLearning.badges', 'Badges')}
          </h2>
          <button
            className={styles.expandButton}
            onClick={() => setShowAllBadges(!showAllBadges)}
          >
            {showAllBadges ? 'Show less' : `View all (${totalBadges})`}
            <Icon name={showAllBadges ? 'angle-up' : 'angle-down'} size="sm" />
          </button>
        </div>
        <p className={styles.sectionDescription}>
          {t('myLearning.badgesDescription', 'Earn badges by completing guides and maintaining streaks')}
        </p>

        {/* Badges Grid */}
        <div className={`${styles.badgesGrid} ${showAllBadges ? styles.badgesGridExpanded : ''}`}>
          {displayedBadges.map((badge, index) => {
            const isEarned = !!badge.earnedAt;
            const isLegacy = badge.isLegacy;
            const baseBadge = BADGES.find((b) => b.id === badge.id);
            const badgeProgress = baseBadge
              ? getBadgeProgress(
                  baseBadge,
                  progress.completedGuides,
                  progress.streakDays,
                  paths.map((p) => ({ id: p.id, guides: p.guides }))
                )
              : null;

            // Determine the badge item class based on state
            const badgeItemClass = isLegacy
              ? `${styles.badgeItem} ${styles.badgeItemLegacy}`
              : isEarned
                ? `${styles.badgeItem} ${styles.badgeItemEarned}`
                : `${styles.badgeItem} ${styles.badgeItemLocked}`;

            return (
              <button
                key={badge.id}
                className={badgeItemClass}
                onClick={() => setSelectedBadge(badge)}
                style={{ animationDelay: `${index * 50}ms` }}
                title={isLegacy ? 'This badge was earned in a previous version' : undefined}
              >
                <div className={styles.badgeIconWrapper}>
                  <Icon name={badge.icon as any} size="xl" />
                  {isEarned && !isLegacy && (
                    <div className={styles.badgeCheckmark}>
                      <Icon name="check" size="xs" />
                    </div>
                  )}
                  {isLegacy && (
                    <div className={styles.badgeLegacyIndicator}>
                      <Icon name="history" size="xs" />
                    </div>
                  )}
                </div>
                <div className={styles.badgeInfo}>
                  <span className={`${styles.badgeTitle} ${!isEarned && !isLegacy ? styles.badgeTitleLocked : ''} ${isLegacy ? styles.badgeTitleLegacy : ''}`}>
                    {badge.title}
                  </span>
                  {!isEarned && !isLegacy && badgeProgress && (
                    <div className={styles.badgeMiniProgress}>
                      <div className={styles.badgeMiniProgressTrack}>
                        <div
                          className={styles.badgeMiniProgressBar}
                          style={{ width: `${badgeProgress.percentage}%` }}
                        />
                      </div>
                      <span className={styles.badgeMiniProgressText}>
                        {badgeProgress.current}/{badgeProgress.total}
                      </span>
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        <FeedbackButton variant="secondary" interactionLocation="my_learning_tab_feedback" />
        <button
          className={styles.resetButton}
          onClick={handleResetProgress}
          title="Reset all learning progress (for testing)"
        >
          Reset progress
        </button>
      </div>

      {/* Badge Detail Card Overlay */}
      {selectedBadge && (
        <BadgeDetailCard
          badge={selectedBadge}
          progress={selectedBadgeProgress}
          onClose={() => setSelectedBadge(null)}
        />
      )}

    </div>
  );
}

// ============================================================================
// BADGE DETAIL CARD STYLES
// ============================================================================

const getBadgeDetailStyles = (theme: GrafanaTheme2) => {
  const isDark = theme.isDark;
  // Vibrant success green for earned badges
  const successColor = '#22C55E';
  const successGlow = isDark ? 'rgba(34, 197, 94, 0.5)' : 'rgba(34, 197, 94, 0.4)';
  const accentColor = isDark ? '#8B7CF6' : '#6C63FF';

  const shimmer = keyframes`
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  `;

  const slideIn = keyframes`
    from { 
      opacity: 0; 
      transform: translate(-50%, -50%) scale(0.9);
    }
    to { 
      opacity: 1; 
      transform: translate(-50%, -50%) scale(1);
    }
  `;

  const fadeIn = keyframes`
    from { opacity: 0; }
    to { opacity: 1; }
  `;

  return {
    overlay: css({
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      backdropFilter: 'blur(4px)',
      zIndex: 1000,
      animation: `${fadeIn} 0.2s ease-out`,
    }),
    card: css({
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: 'min(320px, 90vw)',
      background: `linear-gradient(180deg, ${theme.colors.background.secondary} 0%, ${theme.colors.background.primary} 100%)`,
      borderRadius: 16,
      padding: theme.spacing(3),
      textAlign: 'center',
      border: `1px solid ${theme.colors.border.medium}`,
      boxShadow: `0 20px 60px rgba(0, 0, 0, 0.4)`,
      animation: `${slideIn} 0.3s ease-out`,
    }),
    closeButton: css({
      position: 'absolute',
      top: theme.spacing(1.5),
      right: theme.spacing(1.5),
      background: 'none',
      border: 'none',
      color: theme.colors.text.secondary,
      cursor: 'pointer',
      padding: theme.spacing(0.5),
      borderRadius: '50%',
      transition: 'all 0.2s ease',
      '&:hover': {
        backgroundColor: theme.colors.action.hover,
        color: theme.colors.text.primary,
      },
    }),
    iconWrapper: css({
      position: 'relative',
      width: 80,
      height: 80,
      margin: '0 auto',
      marginBottom: theme.spacing(2),
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: '50%',
    }),
    iconEarned: css({
      background: `linear-gradient(135deg, ${successColor}40 0%, ${successColor}15 100%)`,
      // Vibrant glow effect
      boxShadow: `0 0 24px ${successGlow}, 0 0 48px ${successGlow}`,
      border: `2px solid ${successColor}`,
      '& svg': {
        color: successColor,
        filter: `drop-shadow(0 0 10px ${successColor})`,
      },
    }),
    iconLocked: css({
      background: theme.colors.background.secondary,
      border: `2px dashed ${theme.colors.border.weak}`,
      '& svg': {
        color: theme.colors.text.disabled,
      },
    }),
    iconLegacy: css({
      background: isDark ? 'rgba(161, 136, 107, 0.2)' : 'rgba(139, 119, 101, 0.15)',
      border: `2px solid ${isDark ? 'rgba(161, 136, 107, 0.6)' : 'rgba(139, 119, 101, 0.5)'}`,
      filter: 'sepia(20%)',
      '& svg': {
        color: isDark ? '#A1886B' : '#8B7765',
      },
    }),
    iconGlow: css({
      position: 'absolute',
      inset: -6,
      borderRadius: '50%',
      background: `radial-gradient(circle, ${successGlow} 0%, transparent 60%)`,
    }),
    checkmark: css({
      position: 'absolute',
      bottom: -2,
      right: -2,
      width: 24,
      height: 24,
      borderRadius: '50%',
      backgroundColor: successColor,
      color: 'white',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: `2px solid ${theme.colors.background.primary}`,
      boxShadow: `0 0 8px ${successGlow}`,
    }),
    legacyIndicator: css({
      position: 'absolute',
      bottom: -2,
      right: -2,
      width: 24,
      height: 24,
      borderRadius: '50%',
      backgroundColor: isDark ? '#A1886B' : '#8B7765',
      color: 'white',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: `2px solid ${theme.colors.background.primary}`,
    }),
    title: css({
      margin: 0,
      marginBottom: theme.spacing(1),
      fontSize: theme.typography.h4.fontSize,
      fontWeight: theme.typography.fontWeightBold,
      color: theme.colors.text.primary,
    }),
    statusBadge: css({
      display: 'inline-block',
      padding: `${theme.spacing(0.5)} ${theme.spacing(1.5)}`,
      borderRadius: 20,
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      marginBottom: theme.spacing(1.5),
    }),
    statusEarned: css({
      backgroundColor: `${successColor}20`,
      color: successColor,
    }),
    statusLocked: css({
      backgroundColor: theme.colors.background.secondary,
      color: theme.colors.text.secondary,
      border: `1px solid ${theme.colors.border.weak}`,
    }),
    statusLegacy: css({
      backgroundColor: isDark ? 'rgba(161, 136, 107, 0.2)' : 'rgba(139, 119, 101, 0.15)',
      color: isDark ? '#A1886B' : '#8B7765',
      border: `1px solid ${isDark ? 'rgba(161, 136, 107, 0.4)' : 'rgba(139, 119, 101, 0.4)'}`,
    }),
    earnedDate: css({
      margin: 0,
      marginBottom: theme.spacing(2),
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
    }),
    description: css({
      margin: 0,
      marginBottom: theme.spacing(2),
      fontSize: theme.typography.body.fontSize,
      color: theme.colors.text.secondary,
      lineHeight: 1.5,
    }),
    requirementSection: css({
      backgroundColor: theme.colors.background.secondary,
      borderRadius: theme.shape.radius.default,
      padding: theme.spacing(1.5),
      marginBottom: theme.spacing(2),
      textAlign: 'left',
    }),
    requirementLabel: css({
      fontSize: 10,
      fontWeight: theme.typography.fontWeightMedium,
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      color: accentColor,
      marginBottom: theme.spacing(0.5),
    }),
    requirementText: css({
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.primary,
      lineHeight: 1.4,
    }),
    progressSection: css({
      textAlign: 'left',
    }),
    progressHeader: css({
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: theme.spacing(0.75),
    }),
    progressLabel: css({
      fontSize: 10,
      fontWeight: theme.typography.fontWeightMedium,
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      color: accentColor,
    }),
    progressValue: css({
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
    }),
    progressBarOuter: css({
      position: 'relative',
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.colors.background.secondary,
      overflow: 'hidden',
    }),
    progressBarInner: css({
      position: 'absolute',
      top: 0,
      left: 0,
      height: '100%',
      borderRadius: 4,
      background: `linear-gradient(90deg, ${accentColor}, ${theme.colors.primary.main})`,
      transition: 'width 0.5s ease-out',
    }),
    progressBarShimmer: css({
      position: 'absolute',
      top: 0,
      left: 0,
      height: '100%',
      background: `linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)`,
      animation: `${shimmer} 2s infinite`,
    }),
    progressPercentage: css({
      marginTop: theme.spacing(0.5),
      fontSize: theme.typography.h5.fontSize,
      fontWeight: theme.typography.fontWeightBold,
      color: theme.colors.text.primary,
      textAlign: 'center',
    }),
  };
};

// ============================================================================
// MAIN STYLES
// ============================================================================

const getMyLearningStyles = (theme: GrafanaTheme2) => {
  const isDark = theme.isDark;
  const accentColor = isDark ? '#8B7CF6' : '#6C63FF';
  const accentLight = isDark ? 'rgba(139, 124, 246, 0.15)' : 'rgba(108, 99, 255, 0.12)';

  // Vibrant success green for earned badges
  const successGreen = '#22C55E';
  const successGreenGlow = isDark ? 'rgba(34, 197, 94, 0.5)' : 'rgba(34, 197, 94, 0.4)';

  const badgeFadeIn = keyframes`
    from { 
      opacity: 0; 
      transform: translateY(8px);
    }
    to { 
      opacity: 1; 
      transform: translateY(0);
    }
  `;

  const successGlow = keyframes`
    0%, 100% { box-shadow: 0 0 8px ${successGreenGlow}; }
    50% { box-shadow: 0 0 16px ${successGreenGlow}; }
  `;

  return {
    container: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(2),
      padding: theme.spacing(2),
      height: '100%',
      overflowY: 'auto',
    }),

    // Hero Section
    heroSection: css({
      background: `linear-gradient(135deg, ${accentLight} 0%, ${theme.colors.background.primary} 100%)`,
      borderRadius: theme.shape.radius.default,
      padding: theme.spacing(2.5),
      border: `1px solid ${theme.colors.border.weak}`,
    }),
    heroContent: css({
      textAlign: 'center',
      marginBottom: theme.spacing(2),
    }),
    previewNotice: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing(0.75),
      marginTop: theme.spacing(1.5),
      padding: `${theme.spacing(0.75)} ${theme.spacing(1.5)}`,
      borderRadius: theme.shape.radius.default,
      backgroundColor: isDark ? 'rgba(140, 140, 140, 0.1)' : 'rgba(0, 0, 0, 0.04)',
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
      '& svg': {
        color: theme.colors.text.disabled,
        flexShrink: 0,
      },
    }),
    heroTitle: css({
      margin: 0,
      fontSize: theme.typography.h4.fontSize,
      fontWeight: theme.typography.fontWeightBold,
      background: `linear-gradient(90deg, ${accentColor}, ${theme.colors.primary.main})`,
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      backgroundClip: 'text',
    }),
    heroSubtitle: css({
      margin: 0,
      fontSize: theme.typography.body.fontSize,
      color: theme.colors.text.secondary,
    }),

    // Stats Row
    statsRow: css({
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      gap: theme.spacing(2),
      flexWrap: 'wrap',
    }),
    statItem: css({
      textAlign: 'center',
      minWidth: 80,
    }),
    statValue: css({
      fontSize: theme.typography.h4.fontSize,
      fontWeight: theme.typography.fontWeightBold,
      color: theme.colors.text.primary,
      fontVariantNumeric: 'tabular-nums',
    }),
    statValueStreak: css({
      fontSize: theme.typography.h4.fontSize,
      fontWeight: theme.typography.fontWeightBold,
      color: isDark ? '#FF8C5A' : '#FF6B35',
      fontVariantNumeric: 'tabular-nums',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing(0.5),
    }),
    fireEmoji: css({
      fontSize: '1.2em',
    }),
    statLabel: css({
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
    }),
    statDivider: css({
      width: 1,
      height: 32,
      backgroundColor: theme.colors.border.weak,
    }),

    // Sections
    section: css({
      backgroundColor: theme.colors.background.secondary,
      borderRadius: theme.shape.radius.default,
      padding: theme.spacing(2),
      border: `1px solid ${theme.colors.border.weak}`,
    }),
    sectionHeader: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
      marginBottom: theme.spacing(0.5),
    }),
    sectionIcon: css({
      color: accentColor,
    }),
    sectionTitle: css({
      margin: 0,
      fontSize: theme.typography.h6.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
      flex: 1,
    }),
    sectionDescription: css({
      margin: 0,
      marginBottom: theme.spacing(1.5),
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
    }),
    hideCompletedToggle: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.75),
      cursor: 'pointer',
      marginLeft: 'auto',
      userSelect: 'none',
    }),
    hideCompletedCheckbox: css({
      width: 14,
      height: 14,
      cursor: 'pointer',
      accentColor: successGreen,
    }),
    hideCompletedLabel: css({
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
    }),
    emptyPathsMessage: css({
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing(4),
      textAlign: 'center',
      color: theme.colors.text.secondary,
      gap: theme.spacing(1),
    }),
    emptyPathsIcon: css({
      color: successGreen,
    }),
    expandButton: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
      borderRadius: theme.shape.radius.default,
      backgroundColor: 'transparent',
      color: theme.colors.text.link,
      fontSize: theme.typography.bodySmall.fontSize,
      border: 'none',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      '&:hover': {
        backgroundColor: theme.colors.action.hover,
      },
    }),

    // Paths Grid
    pathsGrid: css({
      display: 'flex',
      flexDirection: 'column',
      gap: theme.spacing(1.5),
    }),

    // Badges Grid - responsive
    badgesGrid: css({
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
      gap: theme.spacing(1),
      maxHeight: '180px',
      overflow: 'hidden',
      transition: 'max-height 0.3s ease-out',
    }),
    badgesGridExpanded: css({
      maxHeight: '1000px',
      overflow: 'visible',
    }),
    badgeItem: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
      padding: theme.spacing(1),
      borderRadius: theme.shape.radius.default,
      backgroundColor: theme.colors.background.primary,
      border: `1px solid ${theme.colors.border.weak}`,
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      animation: `${badgeFadeIn} 0.3s ease-out forwards`,
      opacity: 0,
      textAlign: 'left',
      '&:hover': {
        transform: 'translateY(-2px)',
        boxShadow: `0 4px 12px rgba(0, 0, 0, 0.15)`,
      },
    }),
    badgeItemEarned: css({
      borderColor: successGreen,
      animation: `${badgeFadeIn} 0.3s ease-out forwards, ${successGlow} 3s ease-in-out infinite`,
      '& svg': {
        color: successGreen,
      },
    }),
    badgeItemLocked: css({
      borderStyle: 'dashed',
      backgroundColor: isDark ? 'rgba(0, 0, 0, 0.2)' : 'rgba(0, 0, 0, 0.03)',
      '& svg': {
        color: theme.colors.text.disabled,
        filter: 'grayscale(100%)',
        opacity: 0.5,
      },
    }),
    badgeItemLegacy: css({
      // Muted/sepia style for badges earned in previous versions
      borderColor: isDark ? 'rgba(161, 136, 107, 0.5)' : 'rgba(139, 119, 101, 0.5)',
      backgroundColor: isDark ? 'rgba(161, 136, 107, 0.15)' : 'rgba(139, 119, 101, 0.1)',
      filter: 'sepia(20%)',
      '& svg': {
        color: isDark ? '#A1886B' : '#8B7765',
      },
      '&:hover': {
        borderColor: isDark ? 'rgba(161, 136, 107, 0.7)' : 'rgba(139, 119, 101, 0.7)',
        boxShadow: `0 0 8px ${isDark ? 'rgba(161, 136, 107, 0.3)' : 'rgba(139, 119, 101, 0.3)'}`,
      },
    }),
    badgeIconWrapper: css({
      position: 'relative',
      flexShrink: 0,
    }),
    badgeCheckmark: css({
      position: 'absolute',
      bottom: -4,
      right: -4,
      width: 16,
      height: 16,
      borderRadius: '50%',
      backgroundColor: successGreen,
      color: 'white',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: `2px solid ${theme.colors.background.primary}`,
    }),
    badgeLegacyIndicator: css({
      position: 'absolute',
      bottom: -4,
      right: -4,
      width: 16,
      height: 16,
      borderRadius: '50%',
      backgroundColor: isDark ? '#A1886B' : '#8B7765',
      color: 'white',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: `2px solid ${theme.colors.background.primary}`,
      '& svg': {
        color: 'white !important',
        filter: 'none !important',
        opacity: '1 !important',
      },
    }),
    badgeInfo: css({
      flex: 1,
      minWidth: 0,
    }),
    badgeTitle: css({
      display: 'block',
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }),
    badgeTitleLocked: css({
      color: theme.colors.text.secondary,
    }),
    badgeTitleLegacy: css({
      color: isDark ? '#A1886B' : '#8B7765',
      fontStyle: 'italic',
    }),
    badgeMiniProgress: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      marginTop: theme.spacing(0.5),
    }),
    badgeMiniProgressTrack: css({
      flex: 1,
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.colors.border.weak,
      overflow: 'hidden',
    }),
    badgeMiniProgressBar: css({
      height: '100%',
      borderRadius: 2,
      background: `linear-gradient(90deg, ${accentColor}, ${theme.colors.primary.main})`,
      transition: 'width 0.3s ease',
      minWidth: 0,
    }),
    badgeMiniProgressText: css({
      fontSize: 9,
      color: theme.colors.text.secondary,
      fontVariantNumeric: 'tabular-nums',
      minWidth: 24,
      textAlign: 'right',
    }),

    // Streak Section
    streakSection: css({
      background: `linear-gradient(135deg, rgba(255, 107, 53, 0.1) 0%, ${theme.colors.background.secondary} 100%)`,
      borderRadius: theme.shape.radius.default,
      padding: theme.spacing(2),
      border: `1px solid ${isDark ? 'rgba(255, 140, 90, 0.3)' : 'rgba(255, 107, 53, 0.3)'}`,
    }),
    streakContent: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1.5),
    }),
    streakFire: css({
      fontSize: 32,
    }),
    streakInfo: css({
      flex: 1,
    }),
    streakDays: css({
      fontSize: theme.typography.h5.fontSize,
      fontWeight: theme.typography.fontWeightBold,
      color: isDark ? '#FF8C5A' : '#FF6B35',
    }),
    streakMessage: css({
      fontSize: theme.typography.bodySmall.fontSize,
      color: theme.colors.text.secondary,
    }),

    // Footer
    footer: css({
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      gap: theme.spacing(2),
      paddingTop: theme.spacing(1),
      borderTop: `1px solid ${theme.colors.border.weak}`,
    }),
    resetButton: css({
      padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
      borderRadius: theme.shape.radius.default,
      backgroundColor: 'transparent',
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      border: `1px solid ${theme.colors.border.weak}`,
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      '&:hover': {
        backgroundColor: theme.colors.error.transparent,
        borderColor: theme.colors.error.border,
        color: theme.colors.error.text,
      },
    }),
  };
};
