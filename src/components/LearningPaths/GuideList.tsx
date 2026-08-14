import React from 'react';
import { useStyles2, Icon } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { cx } from '@emotion/css';

import type { PathGuide } from '../../types/learning-paths.types';
import { getGuideListStyles } from './learning-paths.styles';

export interface GuideListProps {
  guides: PathGuide[];
  isLoading?: boolean;
  className?: string;
}

export function GuideList({ guides, isLoading = false, className }: GuideListProps) {
  const styles = useStyles2(getGuideListStyles);

  return (
    <div className={cx(styles.list, className)}>
      {isLoading ? (
        <div className={styles.guideItem}>
          <Icon name="fa fa-spinner" size="sm" />
          <span className={styles.guideTitle}>{t('myLearning.loadingGuides', 'Loading guides...')}</span>
        </div>
      ) : (
        guides.map((guide) => (
          <div
            key={guide.id}
            className={cx(
              styles.guideItem,
              guide.isCurrent && styles.guideItemCurrent,
              guide.description && styles.guideItemWithDescription
            )}
          >
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
            <span className={styles.guideTextGroup}>
              <span className={styles.guideTitle}>{guide.title}</span>
              {guide.description && <span className={styles.guideDescription}>{guide.description}</span>}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
