/**
 * Learning Path Card Component
 *
 * Displays a learning path with progress, guides list, and continue button.
 * Features gradient backgrounds, animated progress bar, and hover effects.
 */

import React from 'react';
import { useStyles2, Icon } from '@grafana/ui';
import { cx } from '@emotion/css';

import type { LearningPathCardProps } from '../../types/learning-paths.types';
import { getLearningPathCardStyles } from './learning-paths.styles';
import { ProgressRing } from './ProgressRing';

/**
 * Card displaying a learning path with progress and guide list
 */
export function LearningPathCard({
  path,
  guides,
  progress,
  isCompleted,
  onContinue,
}: LearningPathCardProps) {
  const styles = useStyles2(getLearningPathCardStyles);

  // Find the next guide to continue with
  const currentGuide = guides.find((g) => g.isCurrent);
  const firstGuide = guides[0];

  const handleContinue = () => {
    const guideToOpen = currentGuide?.id || firstGuide?.id;
    if (guideToOpen) {
      onContinue(guideToOpen);
    }
  };

  // Get button text based on state
  const getButtonText = () => {
    if (isCompleted) {
      return 'Review';
    }
    if (progress === 0) {
      return 'Start';
    }
    return 'Continue';
  };

  return (
    <div className={cx(styles.card, isCompleted && styles.cardCompleted)}>
      {/* Header with progress ring and title */}
      <div className={styles.header}>
        <ProgressRing
          progress={progress}
          size={44}
          strokeWidth={4}
          isCompleted={isCompleted}
          showPercentage={true}
        />

        <div className={styles.titleSection}>
          <h3 className={cx(styles.title, isCompleted && styles.titleCompleted)}>
            {path.title}
          </h3>
          <div className={styles.meta}>
            <span>{guides.length} guides</span>
            {path.estimatedMinutes && (
              <>
                <span className={styles.metaDot} />
                <span>~{path.estimatedMinutes} min</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Guide list */}
      <div className={styles.guideList}>
        {guides.map((guide) => (
          <div
            key={guide.id}
            className={cx(styles.guideItem, guide.isCurrent && styles.guideItemCurrent)}
          >
            <span
              className={cx(
                styles.guideIcon,
                guide.completed && styles.guideIconCompleted,
                guide.isCurrent && styles.guideIconCurrent,
                !guide.completed && !guide.isCurrent && styles.guideIconPending
              )}
            >
              {guide.completed ? (
                <Icon name="check" size="sm" />
              ) : guide.isCurrent ? (
                <Icon name="circle" size="sm" />
              ) : (
                <Icon name="circle" size="sm" />
              )}
            </span>
            <span>{guide.title}</span>
          </div>
        ))}
      </div>

      {/* Footer with continue button */}
      <div className={styles.footer}>
        <button
          className={cx(styles.continueButton, isCompleted && styles.continueButtonCompleted)}
          onClick={handleContinue}
        >
          {getButtonText()}
          <Icon name="arrow-right" size="sm" />
        </button>
      </div>
    </div>
  );
}
