/**
 * Streak Indicator Component
 *
 * Displays the current learning streak with fire animation.
 * Shows "at risk" state when streak might be lost.
 */

import React from 'react';
import { useStyles2, Tooltip } from '@grafana/ui';
import { cx } from '@emotion/css';

import type { StreakInfo } from '../../types/learning-paths.types';
import { getStreakIndicatorStyles } from './learning-paths.styles';
import { getStreakMessage, getNextMilestone, getMilestoneProgress } from '../../learning-paths';

interface StreakIndicatorProps {
  streakInfo: StreakInfo;
}

/**
 * Streak indicator with fire icon and day count
 */
export function StreakIndicator({ streakInfo }: StreakIndicatorProps) {
  const styles = useStyles2(getStreakIndicatorStyles);

  // Don't show if no streak activity
  if (streakInfo.days === 0 && !streakInfo.isAtRisk) {
    return null;
  }

  const message = getStreakMessage(streakInfo);
  const nextMilestone = getNextMilestone(streakInfo.days);
  const milestoneProgress = getMilestoneProgress(streakInfo.days);

  const tooltipContent = nextMilestone
    ? `${message}\n${milestoneProgress}% to ${nextMilestone}-day milestone`
    : message;

  return (
    <Tooltip content={tooltipContent} placement="bottom">
      <div className={styles.container}>
        <span className={cx(styles.fireIcon, !streakInfo.isActiveToday && styles.fireIconInactive)}>🔥</span>
        <span className={cx(styles.text, streakInfo.isAtRisk && styles.textAtRisk)}>{streakInfo.days}</span>
      </div>
    </Tooltip>
  );
}
