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
              guide.isCurrent && styles.guideItemCurrentCard,
              guide.locked && styles.guideItemLocked,
              guide.description && styles.guideItemWithDescription
            )}
            // The current row is the only clickable one — data-journey-start is
            // the same attribute contract the cover page's own CTA button uses,
            // picked up by the shared global click handler (link-handler.hook.ts).
            {...(guide.isCurrent && guide.url ? { 'data-journey-start': 'true', 'data-milestone-url': guide.url } : {})}
          >
            <span
              className={cx(
                styles.guideIconBadge,
                guide.completed && styles.guideIconBadgeCompleted,
                guide.isCurrent && styles.guideIconBadgeCurrent,
                (guide.locked || (!guide.completed && !guide.isCurrent)) && styles.guideIconBadgeLocked
              )}
            >
              {guide.completed ? (
                <Icon name="check" size="md" />
              ) : guide.locked ? (
                <Icon name="lock" size="md" />
              ) : guide.isCurrent ? (
                <Icon name="play" size="md" />
              ) : (
                <Icon name="circle" size="md" />
              )}
            </span>
            <span className={styles.guideTextGroup}>
              <span className={styles.guideTitle}>{guide.title}</span>
              {guide.description && <span className={styles.guideDescription}>{guide.description}</span>}
              {(guide.locked || typeof guide.estimatedMinutes === 'number') && (
                <span className={styles.guideMeta}>
                  {typeof guide.estimatedMinutes === 'number' && (
                    <>
                      <Icon name="clock-nine" size="sm" />
                      {t('coverPage.estimatedMinutes', '{{count}} min', { count: guide.estimatedMinutes })}
                    </>
                  )}
                  {typeof guide.estimatedMinutes === 'number' && guide.locked && <span aria-hidden="true">·</span>}
                  {guide.locked && t('coverPage.locked', 'Locked')}
                </span>
              )}
            </span>
            {guide.isCurrent && <span className={styles.guideUpNext}>{t('coverPage.upNext', 'Up next')}</span>}
          </div>
        ))
      )}
    </div>
  );
}
