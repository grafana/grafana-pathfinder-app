import React, { useId } from 'react';
import { useStyles2, Icon, Badge } from '@grafana/ui';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { t } from '@grafana/i18n';

import type { PathGuide } from '../../types/learning-paths.types';
import { getGuideListStyles } from './learning-paths.styles';
import { getLearningCardInteractionStyles } from '../LearningContentCard/learning-card-interaction.styles';

export interface GuideListProps {
  fullPage?: boolean;
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

export function GuideList({
  guides,
  isLoading = false,
  className,
  enableRowLinks = false,
  fullPage = false,
}: GuideListProps) {
  const compactStyles = useStyles2(getGuideListStyles);
  const fullPageStyles = useStyles2(getFullPageStyles);
  const styles = fullPage ? { ...compactStyles, ...fullPageStyles } : compactStyles;
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
                guide.locked && styles.guideItemLocked,
                fullPage && guide.completed && fullPageStyles.guideItemCompleted
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
              <div className={styles.guideTextGroup}>
                {fullPage ? (
                  <div className={fullPageStyles.guideTitleRow}>
                    <span className={fullPageStyles.guideTitle}>{guide.title}</span>
                    {showCurrentChrome && (
                      <Badge
                        text={t('coverPage.upNext', 'Up next')}
                        color="orange"
                        className={fullPageStyles.upNextBadge}
                      />
                    )}
                  </div>
                ) : (
                  <span>{guide.title}</span>
                )}
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
              </div>
              {showCurrentChrome && !fullPage && (
                <span className={styles.guideUpNext}>{t('coverPage.upNext', 'Up next')}</span>
              )}
              {isRowLink && <Icon name="angle-right" size="md" className={styles.guideChevron} />}
            </div>
          );
        })
      )}
    </div>
  );
}

const getFullPageStyles = (theme: GrafanaTheme2) => ({
  list: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(1) }),
  guideItem: css({
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(1.5),
    padding: theme.spacing(1.5),
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.md,
    background: theme.colors.background.primary,
    color: theme.colors.text.primary,
    ...theme.typography.base,
  }),
  guideItemCompleted: css({ color: theme.colors.text.secondary }),
  guideTitleRow: css({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: theme.spacing(1) }),
  guideTitle: css({ ...theme.typography.base, fontWeight: theme.typography.fontWeightMedium }),
  guideTextGroup: css({ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, gap: theme.spacing(0.25) }),
  upNextBadge: css({
    background: theme.colors.warning.transparent,
    color: theme.colors.warning.text,
    borderColor: theme.colors.warning.border,
  }),
  guideIconBadge: css({
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    alignSelf: 'flex-start',
    borderRadius: theme.shape.radius.md,
  }),
  guideIconBadgeLocked: css({ background: theme.colors.background.secondary, color: theme.colors.text.secondary }),
  guideIconBadgeCompleted: css({ background: theme.colors.success.transparent, color: theme.colors.success.text }),
  guideItemCurrent: css({ color: theme.colors.text.primary }),
  guideItemCurrentCard: css({ borderColor: theme.colors.border.medium }),
  guideItemClickable: css({ cursor: 'pointer', ...getLearningCardInteractionStyles(theme) }),
  guideIconBadgeCurrent: css({
    background: theme.colors.text.primary,
    color: theme.colors.background.primary,
  }),
  guideDescription: css({
    ...theme.typography.base,
    color: theme.colors.text.secondary,
    marginTop: 0,
  }),
  guideUpNext: css({
    ...theme.typography.bodySmall,
    color: theme.colors.text.secondary,
    whiteSpace: 'nowrap',
    '@media (max-width: 600px)': { display: 'none' },
  }),
});
