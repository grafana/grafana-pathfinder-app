/**
 * The universal "Mark complete" control at the foot of every guide and every
 * milestone.
 *
 * Unconditional by design (`docs/design/COMPLETION-MODEL.md`, decision 2): it
 * renders whether or not the guide has interactive content, so a reader who
 * does not see it can tell that from a bug. A guide whose only completion
 * evidence is this click is the majority of the published library, and until
 * this control shipped those guides could not reach 100% at all.
 *
 * Clicking it produces two separate things, and the split is deliberate:
 *   - `mark-guide-complete` evidence, persisted per content key, which the
 *     arithmetic in `lib/guide-stats/progress.ts` already understands.
 *   - the durable completion record, via the surface-neutral emitter the
 *     auto-complete route uses (`onMarkComplete`), so a marked guide records
 *     the same fact as a finished one.
 *
 * The `markCompleteClicked` analytics event is a third, distinct thing: a
 * completion rate that stays high while clicks stay near zero is the failure
 * mode this model has to be able to see, and it is invisible without an event
 * of its own.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Icon, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css, keyframes } from '@emotion/css';
import { t } from '@grafana/i18n';

import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { guideCompletionMarkStorage, interactiveCompletionStorage } from '../../lib/user-storage';
import { logger } from '../../lib/logging';
import { getContentKey } from '../../global-state/content-key';
import { isPreviewContentKey, getGuideProgress, subscribeProgress } from '../../global-state/completion-store';
import { dispatchProgress } from '../../global-state/progress-events';
import { testIds } from '../../constants/testIds';

/**
 * Whether the reader is at the foot of a standalone guide or of a milestone
 * inside a path. It changes the label and the analytics discriminator; it never
 * changes whether the control renders.
 */
export type MarkCompleteContext = 'guide' | 'milestone';

export interface MarkCompleteFooterProps {
  context: MarkCompleteContext;
  /**
   * The surface's completion emitter — the same callback the auto-complete
   * route fires when a guide reaches 100%. Deduplicated by the caller, so a
   * marked guide that later auto-completes still records once.
   */
  onMarkComplete?: () => void;
  /** Advance to the next milestone. Absent when there is nowhere to continue to. */
  onContinue?: () => void;
}

const CELEBRATION_MS = 1400;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

export function MarkCompleteFooter({ context, onMarkComplete, onContinue }: MarkCompleteFooterProps) {
  const styles = useStyles2(getStyles);
  const [contentKey] = useState(getContentKey);
  const [marked, setMarked] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [percentage, setPercentage] = useState(() => getGuideProgress(contentKey).percentage);
  const celebrationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void guideCompletionMarkStorage.get(contentKey).then((existing) => {
      if (!cancelled && existing) {
        setMarked(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [contentKey]);

  useEffect(
    () =>
      subscribeProgress(contentKey, () => {
        setPercentage(getGuideProgress(contentKey).percentage);
      }),
    [contentKey]
  );

  useEffect(
    () => () => {
      if (celebrationTimer.current) {
        clearTimeout(celebrationTimer.current);
      }
    },
    []
  );

  const handleClick = useCallback(() => {
    if (marked) {
      return;
    }
    setMarked(true);

    reportAppInteraction(UserInteraction.MarkCompleteClicked, {
      interaction_location: 'content_footer',
      completion_context: context,
      completion_percentage_before: percentage,
    });

    // The completion write must not wait on the celebration: a reader who
    // navigates away mid-animation still completed the guide.
    onMarkComplete?.();

    if (!isPreviewContentKey(contentKey)) {
      void guideCompletionMarkStorage.set(contentKey, true).catch((error) => {
        logger.warn('Failed to persist guide completion mark', { error });
      });
      // Temporary until the completion store derives the percentage from the
      // mark; today nothing else would move the guide to 100%.
      void interactiveCompletionStorage.set(contentKey, 100);
      dispatchProgress({ kind: 'guide', contentKey, percentage: 100, hasProgress: true });
    }

    // Reduced motion means no dwell either — continuing is the reader's
    // intent, and holding them for an animation they asked not to see is the
    // same delay with none of the reward.
    if (prefersReducedMotion()) {
      onContinue?.();
      return;
    }

    setCelebrating(true);
    celebrationTimer.current = setTimeout(() => {
      setCelebrating(false);
      onContinue?.();
    }, CELEBRATION_MS);
  }, [marked, context, percentage, contentKey, onMarkComplete, onContinue]);

  const displayPercentage = marked ? 100 : percentage;
  const label =
    context === 'milestone' && onContinue
      ? t('markComplete.milestoneButton', 'Mark complete and continue')
      : t('markComplete.guideButton', 'Mark complete');

  return (
    <div className={styles.footer} data-testid={testIds.markComplete.footer}>
      <div className={styles.progress}>
        <div className={styles.track}>
          <div className={styles.fill} style={{ width: `${displayPercentage}%` }} />
        </div>
        <span className={styles.percentage} data-testid={testIds.markComplete.percentage}>
          {t('markComplete.percentComplete', '{{percent}}% complete', { percent: displayPercentage })}
        </span>
      </div>

      {marked ? (
        <div className={celebrating ? styles.celebration : styles.completed}>
          <Icon name="check-circle" />
          <span>{t('markComplete.completed', 'Completed')}</span>
        </div>
      ) : (
        <Button
          variant="primary"
          icon="check"
          size="md"
          onClick={handleClick}
          data-testid={testIds.markComplete.button}
        >
          {label}
        </Button>
      )}
    </div>
  );
}

const pop = keyframes`
  0% { transform: scale(0.85); opacity: 0.4; }
  55% { transform: scale(1.12); }
  100% { transform: scale(1); opacity: 1; }
`;

function getStyles(theme: GrafanaTheme2) {
  const completedBase = {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    color: theme.colors.success.text,
    fontWeight: theme.typography.fontWeightMedium,
  } as const;

  return {
    footer: css({
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing(2),
      flexWrap: 'wrap',
      marginTop: theme.spacing(3),
      paddingTop: theme.spacing(2),
      borderTop: `1px solid ${theme.colors.border.weak}`,
    }),
    progress: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
      flex: '1 1 160px',
      minWidth: 0,
    }),
    track: css({
      flex: 1,
      minWidth: 0,
      height: '4px',
      borderRadius: theme.shape.radius.pill,
      backgroundColor: theme.colors.background.secondary,
      overflow: 'hidden',
    }),
    fill: css({
      height: '100%',
      backgroundColor: theme.colors.success.main,
      transition: 'width 600ms ease-out',
      '@media (prefers-reduced-motion: reduce)': {
        transition: 'none',
      },
    }),
    percentage: css({
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      whiteSpace: 'nowrap',
    }),
    completed: css(completedBase),
    celebration: css(completedBase, {
      animation: `${pop} 500ms ease-out`,
      '@media (prefers-reduced-motion: reduce)': {
        animation: 'none',
      },
    }),
  };
}
