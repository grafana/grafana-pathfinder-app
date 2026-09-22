import React, { useSyncExternalStore } from 'react';
import { css } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';
import type { GrafanaTheme2 } from '@grafana/data';

import { getGuideIndex } from '../../global-state/active-guide-index';
import { subscribeProgress, peekGuidePercentage } from '../../global-state/completion-store';

interface SegmentedGuideProgressBarProps {
  contentKey: string;
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
 * Shows one segment per step/block in the guide, with each segment lighting up
 * as its corresponding step is completed. Reuses the existing progress/completion
 * state from the completion store to maintain a single source of truth.
 *
 * The bar stays at the top of the guide panel as content scrolls, providing
 * persistent visual feedback on progress.
 */
export function SegmentedGuideProgressBar({ contentKey }: SegmentedGuideProgressBarProps): React.ReactElement | null {
  const styles = useStyles2(getStyles);

  // Get the frozen guide index for this content key
  const guideIndex = getGuideIndex(contentKey);
  const totalBlockCount = guideIndex?.index.totalBlockCount ?? 0;

  // Subscribe to progress changes for this content key
  const percentage = useSyncExternalStore(
    React.useCallback((listener: () => void) => subscribeProgress(contentKey, listener), [contentKey]),
    React.useCallback(() => peekGuidePercentage(contentKey), [contentKey]),
    React.useCallback(() => peekGuidePercentage(contentKey), [contentKey])
  );

  // Don't render if there are no blocks to track or no guide index
  if (totalBlockCount === 0 || !guideIndex) {
    return null;
  }

  // Derive completed position from percentage
  // If 100% complete, all segments are done
  // Otherwise, calculate how many segments should be lit up
  const completedPosition = percentage === 100 ? totalBlockCount : Math.round((percentage / 100) * totalBlockCount);

  return (
    <div
      className={styles.stickyContainer}
      role="progressbar"
      aria-valuenow={completedPosition}
      aria-valuemax={totalBlockCount}
      aria-label={`Guide progress: ${completedPosition} of ${totalBlockCount} steps completed`}
    >
      <div className={styles.progressSegments}>
        {Array.from({ length: totalBlockCount }, (_, index) => {
          const position = index + 1; // Positions are 1-indexed
          const isDone = position <= completedPosition;
          return (
            <div key={position} className={styles.progressSegment} data-segment-state={isDone ? 'done' : 'upcoming'} />
          );
        })}
      </div>
    </div>
  );
}
