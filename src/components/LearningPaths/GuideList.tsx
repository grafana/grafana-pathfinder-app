/**
 * Guide list
 *
 * Renders an ordered list of a learning path's guides/milestones with a
 * per-item completion icon. Shared by the My Learning card expander and the
 * cover-page table of contents so both read identically.
 */

import React from 'react';
import { useStyles2, Icon } from '@grafana/ui';
import { cx } from '@emotion/css';

import type { PathGuide } from '../../types/learning-paths.types';
import { getLearningPathCardStyles } from './learning-paths.styles';

export interface GuideListProps {
  guides: PathGuide[];
  /** Shows a spinner row instead of the list while guides resolve. */
  isLoading?: boolean;
  loadingLabel?: string;
}

export function GuideList({ guides, isLoading = false, loadingLabel = 'Loading guides...' }: GuideListProps) {
  const styles = useStyles2(getLearningPathCardStyles);

  return (
    <div className={styles.guideList}>
      {isLoading ? (
        <div className={styles.guideItem}>
          <Icon name="fa fa-spinner" size="sm" />
          <span className={styles.guideTitle}>{loadingLabel}</span>
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
  );
}
