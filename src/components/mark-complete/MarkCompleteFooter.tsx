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

import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button, Icon, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css, keyframes } from '@emotion/css';
import { t } from '@grafana/i18n';

import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { guideCompletionMarkStorage, interactiveCompletionStorage } from '../../lib/user-storage';
import { logger } from '../../lib/logging';
import { StorageEvents } from '../../lib/event-names';
import { resolveGuideContentKey } from '../../global-state/guide-content-key';
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
   * The rendered content's URL. Not itself the storage key — a journey's
   * `content.url` carries a `/content.json` suffix the rest of the progress
   * system does not — but it identifies the guide, so a change to it
   * re-resolves the key even when the footer is not remounted.
   */
  contentUrl?: string;
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

export function MarkCompleteFooter({ context, contentUrl, onMarkComplete, onContinue }: MarkCompleteFooterProps) {
  const styles = useStyles2(getStyles);
  // Tagged with the guide it was read for, so a guide change re-arms the
  // control by derivation rather than by resetting state in an effect.
  const [mark, setMark] = useState<{ readFor: string | undefined; marked: boolean } | null>(null);
  const [clearedCount, setClearedCount] = useState(0);
  const [celebrating, setCelebrating] = useState(false);
  const celebrationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completedRef = useRef<HTMLDivElement>(null);
  const claimFocusRef = useRef(false);

  const percentage = useSyncExternalStore(
    useCallback(
      (listener: () => void) => subscribeProgress(resolveGuideContentKey(contentUrl), listener),
      [contentUrl]
    ),
    useCallback(() => getGuideProgress(resolveGuideContentKey(contentUrl)).percentage, [contentUrl])
  );

  // Both producers of the content key publish it from a layout effect — the
  // panel's active tab URL and this renderer's own override — so resolving it
  // during render would latch the previous milestone's key for the whole life
  // of this one.
  useEffect(() => {
    let cancelled = false;
    const settle = (marked: boolean) => {
      if (!cancelled) {
        setMark({ readFor: contentUrl, marked });
      }
    };
    guideCompletionMarkStorage
      .get(resolveGuideContentKey(contentUrl))
      .then((existing) => settle(existing === true))
      .catch((error) => {
        logger.warn('Failed to read guide completion mark', { error });
        settle(false);
      });
    return () => {
      cancelled = true;
    };
  }, [contentUrl, clearedCount]);

  // A bulk reset clears the mark without remounting this footer, so the read
  // has to re-run on the signal every reset path already emits — otherwise the
  // control stays on "Completed" for a guide that no longer carries a mark.
  useEffect(() => {
    const handleCleared = (event: Event) => {
      const clearedKey = (event as CustomEvent).detail?.contentKey;
      if (clearedKey === '*' || clearedKey === resolveGuideContentKey(contentUrl)) {
        setClearedCount((count) => count + 1);
      }
    };
    window.addEventListener(StorageEvents.InteractiveProgressCleared, handleCleared);
    return () => {
      window.removeEventListener(StorageEvents.InteractiveProgressCleared, handleCleared);
    };
  }, [contentUrl]);

  useEffect(
    () => () => {
      if (celebrationTimer.current) {
        clearTimeout(celebrationTimer.current);
        celebrationTimer.current = null;
      }
    },
    [contentUrl]
  );

  useEffect(() => {
    if (claimFocusRef.current && completedRef.current) {
      claimFocusRef.current = false;
      completedRef.current.focus();
    }
  });

  // `hydrated` is what makes "never twice" structural rather than a race: until
  // the stored mark has been read, a return visit cannot be told from a first
  // one.
  const hydrated = mark !== null && mark.readFor === contentUrl;
  const marked = hydrated && mark.marked;

  const handleClick = useCallback(() => {
    if (!hydrated || marked) {
      return;
    }
    const contentKey = resolveGuideContentKey(contentUrl);
    // The button the reader just activated is about to unmount, and React
    // would drop focus to `document.body`. A return visit that hydrates an
    // existing mark must not steal focus, so only a click claims it.
    claimFocusRef.current = true;
    setMark({ readFor: contentUrl, marked: true });

    // The completion write must not wait on the celebration: a reader who
    // navigates away mid-animation still completed the guide.
    onMarkComplete?.();

    // A block-editor preview is an author iterating, not a reader: it persists
    // nothing and it stays out of the click stream, because that stream exists
    // to measure whether real readers use the control.
    if (!isPreviewContentKey(contentKey)) {
      reportAppInteraction(UserInteraction.MarkCompleteClicked, {
        interaction_location: 'content_footer',
        completion_context: context,
        completion_percentage_before: percentage,
      });
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
  }, [hydrated, marked, context, percentage, contentUrl, onMarkComplete, onContinue]);

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
        <div
          ref={completedRef}
          role="status"
          tabIndex={-1}
          className={celebrating ? styles.celebration : styles.completed}
          data-testid={testIds.markComplete.completed}
        >
          <Icon name="check-circle" />
          <span>
            {t('markComplete.completed', 'Completed')}
            {' \u2014 '}
            {t('markComplete.percentComplete', '{{percent}}% complete', { percent: displayPercentage })}
          </span>
        </div>
      ) : (
        <Button
          variant="primary"
          icon="check"
          size="md"
          disabled={!hydrated}
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
    completed: css(completedBase, {
      '&:focus-visible': {
        outline: `2px solid ${theme.colors.primary.border}`,
        outlineOffset: theme.spacing(0.5),
      },
    }),
    celebration: css(completedBase, {
      animation: `${pop} 500ms ease-out`,
      '@media (prefers-reduced-motion: reduce)': {
        animation: 'none',
      },
    }),
  };
}
