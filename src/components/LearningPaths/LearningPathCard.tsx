/**
 * Learning Path Card Component
 *
 * Collapsible learning path card with balanced compact design.
 */

import React, { useState } from 'react';
import { useStyles2, Icon } from '@grafana/ui';
import { cx } from '@emotion/css';

import type { LearningPathCardProps } from '../../types/learning-paths.types';
import { getLearningPathCardStyles } from './learning-paths.styles';
import { ProgressRing } from './ProgressRing';

/**
 * Card displaying a learning path with collapsible guide list
 */
export function LearningPathCard({
  path,
  guides,
  progress,
  isCompleted,
  onContinue,
  onReset,
  defaultExpanded = false,
}: LearningPathCardProps & { defaultExpanded?: boolean }) {
  const styles = useStyles2(getLearningPathCardStyles);
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);

  // Whether this is a URL-based path (guides fetched dynamically)
  const isUrlBased = Boolean(path.url);
  const isLoadingGuides = isUrlBased && guides.length === 0;

  // Find the next guide to continue with
  const currentGuide = guides.find((g) => g.isCurrent);
  const firstIncompleteGuide = guides.find((g) => !g.completed);
  const firstGuide = guides[0];
  const nextGuide = currentGuide || firstIncompleteGuide || firstGuide;

  const handleContinue = (e: React.MouseEvent) => {
    e.stopPropagation();
    const guideToOpen = currentGuide?.id || firstIncompleteGuide?.id || firstGuide?.id;
    if (guideToOpen) {
      onContinue(guideToOpen, path.id);
    }
  };

  const handleResetClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsConfirmingReset(true);
  };

  const handleConfirmReset = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onReset) {
      onReset(path.id);
    }
    setIsConfirmingReset(false);
  };

  const handleCancelReset = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsConfirmingReset(false);
  };

  const handleToggleExpand = () => {
    setIsExpanded(!isExpanded);
  };

  const getButtonText = () => {
    if (progress === 0) {
      return 'Start';
    }
    return 'Continue';
  };

  const completedCount = guides.filter((g) => g.completed).length;

  return (
    <div className={cx(styles.card, isCompleted && styles.cardCompleted)}>
      {/* Header - clickable to expand */}
      <div
        className={styles.header}
        onClick={handleToggleExpand}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && handleToggleExpand()}
        aria-expanded={isExpanded}
      >
        <ProgressRing progress={progress} size={40} strokeWidth={3} isCompleted={isCompleted} showPercentage={true} />

        <div className={styles.content}>
          <h3 className={cx(styles.title, isCompleted && styles.titleCompleted)}>{path.title}</h3>

          <div className={styles.meta}>
            {isLoadingGuides ? (
              <span>Loading guides...</span>
            ) : (
              <span>
                {completedCount}/{guides.length} guides
              </span>
            )}
            {path.estimatedMinutes && (
              <>
                <span className={styles.metaDot}>·</span>
                <span>~{path.estimatedMinutes} min</span>
              </>
            )}
          </div>

          {/* Next guide hint - only show for in-progress paths when collapsed */}
          {!isCompleted && progress > 0 && nextGuide && !isExpanded && (
            <div className={styles.nextHint}>Next: {nextGuide.title}</div>
          )}
        </div>

        {/* Actions - fixed position at end */}
        <div className={styles.actions}>
          {!isCompleted && (
            <button className={styles.actionButton} onClick={handleContinue}>
              <Icon name="play" size="sm" />
              {getButtonText()}
            </button>
          )}
          {isCompleted && onReset && !isConfirmingReset && (
            <button className={styles.resetButton} onClick={handleResetClick}>
              <Icon name="history" size="sm" />
              Restart
            </button>
          )}
          {isCompleted && onReset && isConfirmingReset && (
            <>
              <button className={styles.confirmResetButton} onClick={handleConfirmReset}>
                Confirm
              </button>
              <button className={styles.cancelResetButton} onClick={handleCancelReset}>
                Cancel
              </button>
            </>
          )}
          <button
            className={cx(styles.expandChevron, isExpanded && styles.expandChevronRotated)}
            onClick={(e) => {
              e.stopPropagation();
              handleToggleExpand();
            }}
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            <Icon name="angle-down" size="lg" />
          </button>
        </div>
      </div>

      {/* Expandable guide list */}
      <div className={cx(styles.expandable, isExpanded && styles.expandableOpen)}>
        {path.description && <p className={styles.description}>{path.description}</p>}

        <div className={styles.guideList}>
          {isLoadingGuides ? (
            <div className={styles.guideItem}>
              <Icon name="fa fa-spinner" size="sm" />
              <span className={styles.guideTitle}>Loading guides...</span>
            </div>
          ) : (
            guides.map((guide) => (
              <div key={guide.id} className={cx(styles.guideItem, guide.isCurrent && styles.guideItemCurrent)}>
                <span
                  className={cx(
                    styles.guideIcon,
                    guide.completed && styles.guideIconCompleted,
                    guide.isCurrent && styles.guideIconCurrent,
                    !guide.completed && !guide.isCurrent && styles.guideIconPending
                  )}
                >
                  {guide.completed ? <Icon name="check" size="sm" /> : <Icon name="circle" size="sm" />}
                </span>
                <span className={styles.guideTitle}>{guide.title}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
