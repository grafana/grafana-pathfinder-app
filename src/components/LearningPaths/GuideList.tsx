import React, { useId } from 'react';
import { useStyles2, Icon } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { cx } from '@emotion/css';

import type { PathGuide } from '../../types/learning-paths.types';
import { getGuideListStyles } from './learning-paths.styles';

export interface GuideListProps {
  guides: PathGuide[];
  isLoading?: boolean;
  className?: string;
  /**
   * Opt-in cover-page treatment: every unlocked row becomes a
   * `data-journey-start` click target, and the current row gets the accent
   * card, play icon, and "Up next" label. Only the cover page's `contentRef`
   * subtree listens for `data-journey-start` (link-handler.hook.ts); My
   * Learning's LearningPathCard has no such listener, so it leaves this off.
   */
  enableRowLinks?: boolean;
}

function rowAccessibleName(guide: PathGuide): string {
  if (guide.completed) {
    return `${guide.title}, ${t('coverPage.rowStatusCompleted', 'completed')}`;
  }
  if (guide.isCurrent) {
    return `${guide.title}, ${t('coverPage.rowStatusUpNext', 'up next')}`;
  }
  return guide.title;
}

// Read by link-handler.hook.ts as `row_state`; keep in sync with its allowlist.
function rowState(guide: PathGuide): 'completed' | 'up_next' | 'ahead' {
  if (guide.completed) {
    return 'completed';
  }
  return guide.isCurrent ? 'up_next' : 'ahead';
}

export function GuideList({ guides, isLoading = false, className, enableRowLinks = false }: GuideListProps) {
  const styles = useStyles2(getGuideListStyles);
  const listId = useId();

  return (
    <div className={cx(styles.list, className)}>
      {isLoading ? (
        <div className={styles.guideItem}>
          <Icon name="fa fa-spinner" size="sm" />
          <span>{t('myLearning.loadingGuides', 'Loading guides...')}</span>
        </div>
      ) : (
        guides.map((guide, index) => {
          const isRowLink = enableRowLinks && !guide.locked && guide.url != null;
          const showCurrentChrome = guide.isCurrent && enableRowLinks;
          const hasMeta = guide.locked || typeof guide.estimatedMinutes === 'number';
          const descriptionId = `${listId}-${index}-description`;
          const metaId = `${listId}-${index}-meta`;
          const describedBy = [guide.description && descriptionId, hasMeta && metaId].filter(Boolean).join(' ');
          return (
            <div
              key={guide.id}
              className={cx(
                styles.guideItem,
                guide.isCurrent && styles.guideItemCurrent,
                isRowLink && styles.guideItemClickable,
                showCurrentChrome && styles.guideItemCurrentCard,
                guide.locked && styles.guideItemLocked
              )}
              // Same attribute contract as the cover page's CTA button, picked
              // up by the shared click handler on contentRef's container
              // (link-handler.hook.ts) rather than a React onClick here, so
              // keyboard activation dispatches a real click via `.click()`.
              {...(isRowLink
                ? {
                    'data-journey-start': 'true',
                    'data-milestone-url': guide.url,
                    // guide.id is a React-key-only fallback for some producers;
                    // only a real manifest id may become the click-target id.
                    ...(guide.guideId != null && { 'data-milestone-id': guide.guideId }),
                    'data-interaction-location': 'module_row_click',
                    'data-row-state': rowState(guide),
                    role: 'button',
                    tabIndex: 0,
                    'aria-label': rowAccessibleName(guide),
                    ...(describedBy && { 'aria-describedby': describedBy }),
                    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.currentTarget.click();
                      }
                    },
                  }
                : {})}
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
                ) : showCurrentChrome ? (
                  <Icon name="play" size="md" />
                ) : (
                  <Icon name="circle" size="md" />
                )}
              </span>
              <span className={styles.guideTextGroup}>
                <span>{guide.title}</span>
                {guide.description && (
                  <span id={descriptionId} className={styles.guideDescription}>
                    {guide.description}
                  </span>
                )}
                {hasMeta && (
                  <span id={metaId} className={styles.guideMeta}>
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
              {showCurrentChrome && <span className={styles.guideUpNext}>{t('coverPage.upNext', 'Up next')}</span>}
              {isRowLink && <Icon name="angle-right" size="md" className={styles.guideChevron} />}
            </div>
          );
        })
      )}
    </div>
  );
}
