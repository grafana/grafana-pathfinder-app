/**
 * Learning Paths Panel Component
 *
 * Main panel that displays learning paths, badges, and streak information.
 * Integrates with the context panel in the sidebar.
 */

import React, { useState, useCallback } from 'react';
import { useStyles2, Icon, Modal } from '@grafana/ui';

import { useLearningPaths, getBadgeById } from '../../learning-paths';
import { getLearningPathsPanelStyles } from './learning-paths.styles';
import { LearningPathCard } from './LearningPathCard';
import { BadgesDisplay } from './BadgesDisplay';
import { BadgeUnlockedToast } from './BadgeUnlockedToast';
import { StreakIndicator } from './StreakIndicator';
import { SkeletonLoader } from '../SkeletonLoader';

interface LearningPathsPanelProps {
  /**
   * Callback when user wants to open a guide
   * @param guideId - ID of the guide to open
   */
  onOpenGuide: (guideId: string) => void;
}

/**
 * Main panel for displaying learning paths and badges
 */
export function LearningPathsPanel({ onOpenGuide }: LearningPathsPanelProps) {
  const styles = useStyles2(getLearningPathsPanelStyles);
  const [showBadgesModal, setShowBadgesModal] = useState(false);

  const {
    paths,
    badgesWithStatus,
    progress,
    getPathGuides,
    getPathProgress,
    isPathCompleted,
    resetPath,
    dismissCelebration,
    streakInfo,
    isLoading,
  } = useLearningPaths();

  // Handle opening a guide
  const handleContinue = useCallback(
    (guideId: string, pathId: string) => {
      // Find the parent path by ID (not by guideId, since multiple paths may share the same guide slugs)
      const parentPath = paths.find((p) => p.id === pathId);

      // URL-based path — open the path's base URL
      if (parentPath?.url) {
        onOpenGuide(parentPath.url);
        return;
      }

      // Static guide — open by guideId
      onOpenGuide(guideId);
    },
    [onOpenGuide, paths]
  );

  // Handle badge celebration dismissal
  const handleDismissCelebration = useCallback(async () => {
    const firstCelebration = progress.pendingCelebrations[0];
    if (firstCelebration) {
      await dismissCelebration(firstCelebration);
    }
  }, [progress.pendingCelebrations, dismissCelebration]);

  // Get the badge to celebrate (if any)
  const celebrationBadge = progress.pendingCelebrations[0] ? getBadgeById(progress.pendingCelebrations[0]) : null;

  if (isLoading) {
    return (
      <div className={styles.container}>
        <SkeletonLoader type="recommendations" />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <Icon name="book-open" size="md" className={styles.headerIcon} />
          <h3 className={styles.headerTitle}>Learning paths</h3>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <StreakIndicator streakInfo={streakInfo} />

          <button
            className={styles.viewBadgesLink}
            onClick={() => setShowBadgesModal(true)}
            aria-label="View all badges"
          >
            <Icon name="star" size="sm" />
            <span>Badges</span>
          </button>
        </div>
      </div>

      {/* Learning path cards */}
      <div className={styles.pathsGrid}>
        {paths.map((path) => (
          <LearningPathCard
            key={path.id}
            path={path}
            guides={getPathGuides(path.id)}
            progress={getPathProgress(path.id)}
            isCompleted={isPathCompleted(path.id)}
            onContinue={handleContinue}
            onReset={resetPath}
          />
        ))}
      </div>

      {/* Badges modal */}
      <Modal title="Your badges" isOpen={showBadgesModal} onDismiss={() => setShowBadgesModal(false)}>
        <BadgesDisplay badges={badgesWithStatus} />
      </Modal>

      {/* Badge celebration toast */}
      {celebrationBadge && <BadgeUnlockedToast badge={celebrationBadge} onDismiss={handleDismissCelebration} />}
    </div>
  );
}
