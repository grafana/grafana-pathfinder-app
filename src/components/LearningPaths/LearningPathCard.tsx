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
  defaultExpanded = false,
}: LearningPathCardProps & { defaultExpanded?: boolean }) {
  const styles = useStyles2(getLearningPathCardStyles);
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  // Find the next guide to continue with
  const currentGuide = guides.find((g) => g.isCurrent);
  const firstIncompleteGuide = guides.find((g) => !g.completed);
  const firstGuide = guides[0];
  const nextGuide = currentGuide || firstIncompleteGuide || firstGuide;

  const handleContinue = (e: React.MouseEvent) => {
    e.stopPropagation();
    const guideToOpen = currentGuide?.id || firstIncompleteGuide?.id || firstGuide?.id;
    if (guideToOpen) {
      onContinue(guideToOpen);
    }
  };

  const handleToggleExpand = () => {
    setIsExpanded(!isExpanded);
  };

  const getButtonText = () => {
    if (progress === 0) return 'Start';
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
        <ProgressRing
          progress={progress}
          size={40}
          strokeWidth={3}
          isCompleted={isCompleted}
          showPercentage={true}
        />

        <div className={styles.content}>
          <h3 className={cx(styles.title, isCompleted && styles.titleCompleted)}>
            {path.title}
          </h3>

          <div className={styles.meta}>
            <span>{completedCount}/{guides.length} guides</span>
            {path.estimatedMinutes && (
              <>
                <span className={styles.metaDot}>·</span>
                <span>~{path.estimatedMinutes} min</span>
              </>
            )}
          </div>

          {/* Next guide hint - only show for in-progress paths when collapsed */}
          {!isCompleted && progress > 0 && nextGuide && !isExpanded && (
            <div className={styles.nextHint}>
              Next: {nextGuide.title}
            </div>
          )}
        </div>

        {/* Actions - fixed position at end */}
        <div className={styles.actions}>
          {!isCompleted && (
            <button
              className={styles.actionButton}
              onClick={handleContinue}
            >
              {getButtonText()}
              <Icon name="arrow-right" size="sm" />
            </button>
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
        {path.description && (
          <p className={styles.description}>{path.description}</p>
        )}

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
                ) : (
                  <Icon name="circle" size="sm" />
                )}
              </span>
              <span className={styles.guideTitle}>{guide.title}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
