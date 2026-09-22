import React from 'react';
import { css } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';
import type { GrafanaTheme2 } from '@grafana/data';

import { useStepProgressCounts } from '../../hooks/useStepProgressFromEvents';

interface SegmentedGuideProgressBarProps {
  /**
   * Whether a guide is currently active in this surface. Passed through to the
   * progress subscription so the bar clears its value when the guide is torn
   * down (rather than lingering with a stale count).
   */
  hasActiveGuide: boolean;
}

const getStyles = (theme: GrafanaTheme2) => ({
  stickyContainer: css({
    position: 'sticky',
    top: 0,
    zIndex: 2,
    backgroundColor: theme.colors.background.canvas,
    padding: theme.spacing(0.5, 1),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  progressSegments: css({
    display: 'flex',
    gap: theme.spacing(0.5),
    width: '100%',
  }),
  progressSegment: css({
    flex: 1,
    height: '3px',
    borderRadius: '2px',
    backgroundColor: theme.colors.background.secondary,
    transition: 'background-color 0.2s ease',
    '&[data-segment-state="done"]': {
      backgroundColor: theme.colors.success.main,
    },
  }),
});

/**
 * Sticky segmented progress bar for guides.
 *
 * Shows one segment per user-facing step in the guide — the same unit the
 * "Step N of M" chip counts — and lights up exactly the completed steps. It
 * reads from the shared `pathfinder-step-progress` signal (via
 * `useStepProgressCounts`), the single source of truth that also drives the
 * header chip, so the bar can never disagree with the numbered steps the reader
 * sees. It deliberately does NOT count raw content blocks: a guide with 14
 * steps renders 14 segments, and completing step 1 lights exactly one.
 *
 * The bar stays at the top of the guide panel as content scrolls, providing
 * persistent visual feedback on progress.
 */
export function SegmentedGuideProgressBar({
  hasActiveGuide,
}: SegmentedGuideProgressBarProps): React.ReactElement | null {
  const styles = useStyles2(getStyles);
  const counts = useStepProgressCounts(hasActiveGuide);

  // No progress observed yet (or no active guide / no steps): render nothing.
  if (!counts || counts.total === 0) {
    return null;
  }

  const { done, total } = counts;

  return (
    <div
      className={styles.stickyContainer}
      role="progressbar"
      aria-valuenow={done}
      aria-valuemax={total}
      aria-label={`Guide progress: ${done} of ${total} steps completed`}
    >
      <div className={styles.progressSegments}>
        {Array.from({ length: total }, (_, index) => {
          const position = index + 1; // Positions are 1-indexed
          const isDone = position <= done;
          return (
            <div key={position} className={styles.progressSegment} data-segment-state={isDone ? 'done' : 'upcoming'} />
          );
        })}
      </div>
    </div>
  );
}
