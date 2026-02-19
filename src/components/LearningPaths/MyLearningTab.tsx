/**
 * My Learning Tab Component
 *
 * A dedicated gamified tab for learning paths, badges, and progress tracking.
 * Provides a unified experience for users to explore and track their learning journey.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useStyles2, Icon } from '@grafana/ui';
import { t } from '@grafana/i18n';

import { useLearningPaths, BADGES } from '../../learning-paths';
import { LearningPathCard } from './LearningPathCard';
import { BadgeIcon } from './BadgeIcon';
import { SkeletonLoader } from '../SkeletonLoader';
import { FeedbackButton } from '../FeedbackButton/FeedbackButton';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import {
  learningProgressStorage,
  journeyCompletionStorage,
  interactiveStepStorage,
  interactiveCompletionStorage,
} from '../../lib/user-storage';
import type { EarnedBadge } from '../../types';

// Import paths data for guide metadata (runtime platform selection)
import { getPathsData } from '../../learning-paths/paths-data';

// Badge utilities extracted for testability
import { getBadgeProgress, getBadgeRequirementText, type BadgeProgressInfo } from './badge-utils';

// Styles extracted for maintainability
import { getBadgeDetailStyles } from './BadgeDetailCard.styles';
import { getMyLearningStyles } from './MyLearningTab.styles';

interface MyLearningTabProps {
  onOpenGuide: (url: string, title: string) => void;
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
          <BadgeIcon emoji={badge.emoji} icon={badge.icon} size="xxxl" emojiClassName={styles.badgeEmoji} />
          {isEarned && !isLegacy && (
            <div className={styles.checkmark}>
              <Icon name="check" size="sm" />
            </div>
          )}
          {isLegacy && (
            <div className={styles.legacyIndicator}>
              <Icon name="history" size="sm" />
            </div>
          )}
        </div>

        {/* Title */}
        <h3 className={styles.title}>{badge.title}</h3>

        {/* Status badge */}
        <div
          className={`${styles.statusBadge} ${isLegacy ? styles.statusLegacy : isEarned ? styles.statusEarned : styles.statusLocked}`}
        >
          {isLegacy ? '📜 Legacy' : isEarned ? '✨ Unlocked' : '🔒 Locked'}
        </div>

        {/* Earned date or requirement */}
        {isEarned && badge.earnedAt ? (
          <p className={styles.earnedDate}>
            Earned on{' '}
            {new Date(badge.earnedAt).toLocaleDateString('en-US', {
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
          <div className={styles.requirementLabel}>{isLegacy ? 'Note' : isEarned ? 'Completed' : 'Requirement'}</div>
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
              <div className={styles.progressBarInner} style={{ width: `${progress.percentage}%` }} />
              <div className={styles.progressBarShimmer} style={{ width: `${progress.percentage}%` }} />
            </div>
            <div className={styles.progressPercentage}>{progress.percentage}%</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// BADGE GRID ITEM COMPONENT
// ============================================================================

interface BadgeGridItemProps {
  badge: EarnedBadge;
  index: number;
  completedGuides: string[];
  streakDays: number;
  paths: Array<{ id: string; guides: string[] }>;
  styles: ReturnType<typeof getMyLearningStyles>;
  onSelect: (badge: EarnedBadge) => void;
}

function BadgeGridItem({ badge, index, completedGuides, streakDays, paths, styles, onSelect }: BadgeGridItemProps) {
  const isEarned = !!badge.earnedAt;
  const isLegacy = badge.isLegacy;
  const baseBadge = BADGES.find((b) => b.id === badge.id);
  const badgeProgress = baseBadge ? getBadgeProgress(baseBadge, completedGuides, streakDays, paths) : null;

  // Determine the badge item class based on state
  const badgeItemClass = isLegacy
    ? `${styles.badgeItem} ${styles.badgeItemLegacy}`
    : isEarned
      ? `${styles.badgeItem} ${styles.badgeItemEarned}`
      : `${styles.badgeItem} ${styles.badgeItemLocked}`;

  return (
    <button
      className={badgeItemClass}
      onClick={() => onSelect(badge)}
      style={{ animationDelay: `${index * 50}ms` }}
      title={isLegacy ? 'This badge was earned in a previous version' : undefined}
    >
      <div className={styles.badgeIconWrapper}>
        <BadgeIcon emoji={badge.emoji} icon={badge.icon} size="xl" emojiClassName={styles.badgeEmojiSmall} />
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
        <span
          className={`${styles.badgeTitle} ${!isEarned && !isLegacy ? styles.badgeTitleLocked : ''} ${isLegacy ? styles.badgeTitleLegacy : ''}`}
        >
          {badge.title}
        </span>
        {!isEarned && !isLegacy && badgeProgress && (
          <div className={styles.badgeMiniProgress}>
            <div className={styles.badgeMiniProgressTrack}>
              <div className={styles.badgeMiniProgressBar} style={{ width: `${badgeProgress.percentage}%` }} />
            </div>
            <span className={styles.badgeMiniProgressText}>
              {badgeProgress.current}/{badgeProgress.total}
            </span>
          </div>
        )}
      </div>
    </button>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function MyLearningTab({ onOpenGuide }: MyLearningTabProps) {
  const styles = useStyles2(getMyLearningStyles);
  const [showAllBadges, setShowAllBadges] = useState(false);
  const [showAllPaths, setShowAllPaths] = useState(false);
  const [selectedBadge, setSelectedBadge] = useState<EarnedBadge | null>(null);
  const [hideCompletedPaths, setHideCompletedPaths] = useState(false);

  const {
    paths,
    badgesWithStatus,
    progress,
    getPathGuides,
    getPathProgress,
    isPathCompleted,
    resetPath,
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

  // Paths to display (first 4 by default, or all when expanded)
  const displayedPaths = showAllPaths ? sortedPaths : sortedPaths.slice(0, 4);

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
    (guideId: string, pathId: string) => {
      // Find the parent path by ID (not by guideId, since multiple paths may share the same guide slugs)
      const parentPath = paths.find((p) => p.id === pathId);

      // URL-based path — open as learning journey
      if (parentPath?.url) {
        reportAppInteraction(UserInteraction.OpenResourceClick, {
          content_title: parentPath.title,
          content_url: parentPath.url,
          content_type: 'learning-journey',
          interaction_location: 'my_learning_tab',
        });

        onOpenGuide(parentPath.url, parentPath.title);
        return;
      }

      // Static guide — open the individual guide content
      const guideMetadata = getPathsData().guideMetadata[guideId];
      const title = guideMetadata?.title || guideId;
      const guideUrl = guideMetadata?.url ?? `bundled:${guideId}`;

      reportAppInteraction(UserInteraction.OpenResourceClick, {
        content_title: title,
        content_url: guideUrl,
        content_type: 'learning-journey',
        interaction_location: 'my_learning_tab',
      });

      // Track learning path progress when user opens a guide from a path
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

      onOpenGuide(guideUrl, title);
    },
    [onOpenGuide, paths, getPathProgress, getPathGuides]
  );

  // Handle reset all progress (for testing)
  const handleResetProgress = useCallback(async () => {
    if (window.confirm('Reset all learning progress? This will clear completed guides, badges, and streaks.')) {
      await learningProgressStorage.clear();

      // Clear journey completion percentages
      const completions = await journeyCompletionStorage.getAll();
      for (const url of Object.keys(completions)) {
        await journeyCompletionStorage.clear(url);
      }

      // Clear all interactive guide step and completion state
      // This prevents guides from instantly re-completing when reopened
      await interactiveStepStorage.clearAll();
      await interactiveCompletionStorage.clearAll();

      // Notify the context engine to refresh recommendations.
      // Note: already-open interactive guide tabs may still show stale completed
      // steps until the user closes and reopens them, because individual tab
      // components don't re-read from storage on this event. Acceptable here
      // since reset-progress is a dev/QA tool, not a primary user flow.
      window.dispatchEvent(
        new CustomEvent('interactive-progress-cleared', {
          detail: { contentKey: '*' },
        })
      );
    }
  }, []);

  const totalGuidesCompleted = progress.completedGuides.length;
  const totalBadgesEarned = progress.earnedBadges.length;
  const totalBadges = badgesWithStatus.length;

  // Sort badges: earned first (most recent first), then unearned (by progress %)
  const sortedBadges = useMemo(() => {
    const pathsForProgress = paths.map((p) => ({ id: p.id, guides: p.guides }));

    return [...badgesWithStatus].sort((a, b) => {
      const aEarned = !!a.earnedAt;
      const bEarned = !!b.earnedAt;

      // Earned badges come first
      if (aEarned !== bEarned) {
        return aEarned ? -1 : 1;
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
          <p className={styles.heroSubtitle}>
            {t('myLearning.subtitle', 'Track your progress, earn badges, and master Grafana')}
          </p>
        </div>

        {/* Stats Row */}
        <div className={styles.statsRow}>
          <div className={styles.statItem}>
            <div className={styles.statValue}>{totalGuidesCompleted}</div>
            <div className={styles.statLabel}>{t('myLearning.guidesCompleted', 'Guides completed')}</div>
          </div>
          <div className={styles.statDivider} />
          <div className={styles.statItem}>
            <div className={styles.statValue}>
              {totalBadgesEarned}/{totalBadges}
            </div>
            <div className={styles.statLabel}>{t('myLearning.badgesEarned', 'Badges earned')}</div>
          </div>
          {streakInfo.days > 0 && (
            <>
              <div className={styles.statDivider} />
              <div className={styles.statItem}>
                <div className={styles.statValueStreak}>
                  <span className={styles.fireEmoji}>🔥</span>
                  {streakInfo.days}
                </div>
                <div className={styles.statLabel}>{t('myLearning.dayStreak', 'Day streak')}</div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Learning Paths Section */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <Icon name="book-open" size="md" className={styles.sectionIcon} />
          <h2 className={styles.sectionTitle}>{t('myLearning.learningPaths', 'Learning paths')}</h2>
          {sortedPaths.length > 4 && (
            <button className={styles.expandButton} onClick={() => setShowAllPaths(!showAllPaths)}>
              {showAllPaths
                ? t('myLearning.showLess', 'Show less')
                : t('myLearning.viewAll', 'View all ({{count}})', { count: sortedPaths.length })}
              <Icon name={showAllPaths ? 'angle-up' : 'angle-down'} size="sm" />
            </button>
          )}
          {/* Hide completed toggle */}
          {completedPathsCount > 0 && (
            <label className={styles.hideCompletedToggle}>
              <input
                type="checkbox"
                checked={hideCompletedPaths}
                onChange={(e) => setHideCompletedPaths(e.target.checked)}
                className={styles.hideCompletedCheckbox}
              />
              <span className={styles.hideCompletedLabel}>Hide completed ({completedPathsCount})</span>
            </label>
          )}
        </div>
        <p className={styles.sectionDescription}>
          {t('myLearning.pathsDescription', 'Structured guides to help you master Grafana step by step')}
        </p>

        <div className={styles.pathsGrid}>
          {displayedPaths.map((path, index) => {
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
                onReset={resetPath}
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
          <h2 className={styles.sectionTitle}>{t('myLearning.badges', 'Badges')}</h2>
          <button className={styles.expandButton} onClick={() => setShowAllBadges(!showAllBadges)}>
            {showAllBadges
              ? t('myLearning.showLess', 'Show less')
              : t('myLearning.viewAll', 'View all ({{count}})', { count: totalBadges })}
            <Icon name={showAllBadges ? 'angle-up' : 'angle-down'} size="sm" />
          </button>
        </div>
        <p className={styles.sectionDescription}>
          {t('myLearning.badgesDescription', 'Earn badges by completing guides and maintaining streaks')}
        </p>

        {/* Badges Grid */}
        <div className={`${styles.badgesGrid} ${showAllBadges ? styles.badgesGridExpanded : ''}`}>
          {displayedBadges.map((badge, index) => (
            <BadgeGridItem
              key={badge.id}
              badge={badge}
              index={index}
              completedGuides={progress.completedGuides}
              streakDays={progress.streakDays}
              paths={paths.map((p) => ({ id: p.id, guides: p.guides }))}
              styles={styles}
              onSelect={setSelectedBadge}
            />
          ))}
        </div>
      </div>

      {/* Preview Notice - at bottom to not distract from main content */}
      <div className={styles.previewNotice}>
        <Icon name="info-circle" size="sm" />
        <span>Learning paths and badges are in preview. Content may change as we refine the experience.</span>
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
