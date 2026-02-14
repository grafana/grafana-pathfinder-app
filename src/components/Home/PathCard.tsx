/**
 * Path card
 *
 * Displays a single learning path with its guide list.
 * Each guide is a clickable button that opens the guide in the sidebar.
 */

import React from 'react';
import { Icon, useStyles2 } from '@grafana/ui';
import { cx } from '@emotion/css';

import { getPathCardStyles } from './path-card.styles';
import { getGuideEstimate } from './home.utils';
import type { LearningPath, PathGuide } from '../../types/learning-paths.types';

// ============================================================================
// TYPES
// ============================================================================

export interface PathCardProps {
  path: LearningPath;
  guides: PathGuide[];
  progress: number;
  completed: boolean;
  onOpenGuide: (guideId: string, title: string) => void;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function PathCard({ path, guides, progress, completed, onOpenGuide }: PathCardProps) {
  const styles = useStyles2(getPathCardStyles);

  return (
    <div className={cx(styles.pathCard, completed && styles.pathCardCompleted)} data-testid={`path-card-${path.id}`}>
      {/* Card header */}
      <div className={styles.pathCardHeader}>
        <div className={cx(styles.pathIconWrap, completed && styles.pathIconWrapCompleted)}>
          <Icon name={completed ? 'check-circle' : (path.icon as any) || 'book'} size="lg" />
        </div>

        <div className={styles.pathContent}>
          <h2 className={cx(styles.pathTitle, completed && styles.pathTitleCompleted)}>{path.title}</h2>
          <p className={styles.pathDescription}>{path.description}</p>

          <div className={styles.pathMeta}>
            {path.estimatedMinutes && <span>{path.estimatedMinutes} min</span>}
            {path.estimatedMinutes && <span className={styles.metaDot}>&middot;</span>}
            <span>
              {guides.filter((g) => g.completed).length}/{guides.length} guides
            </span>
            <span className={styles.metaDot}>&middot;</span>
            <span>{progress}%</span>
          </div>

          {/* Progress bar */}
          <div className={styles.progressBarTrack} style={{ marginTop: 8 }}>
            <div
              className={cx(styles.progressBarFill, completed && styles.progressBarFillCompleted)}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Guide list */}
      <div className={styles.guideList}>
        {guides.map((guide) => (
          <button
            key={guide.id}
            className={cx(
              styles.guideItem,
              guide.completed && styles.guideItemCompleted,
              guide.isCurrent && styles.guideItemCurrent
            )}
            onClick={() => onOpenGuide(guide.id, guide.title)}
            data-testid={`guide-item-${guide.id}`}
          >
            <span
              className={cx(
                styles.guideIcon,
                guide.completed && styles.guideIconCompleted,
                guide.isCurrent && styles.guideIconCurrent,
                !guide.completed && !guide.isCurrent && styles.guideIconPending
              )}
            >
              <Icon name={guide.completed ? 'check-circle' : guide.isCurrent ? 'play' : 'circle'} size="md" />
            </span>
            <span className={styles.guideTitle}>{guide.title}</span>
            <span className={styles.guideTime}>{getGuideEstimate(guide.id)} min</span>
          </button>
        ))}
      </div>
    </div>
  );
}
