/**
 * Progress Ring Component
 *
 * Circular progress indicator with gradient stroke and smooth animations.
 * Shows completion percentage in the center, or a checkmark when complete.
 */

import React, { useMemo } from 'react';
import { useStyles2, Icon } from '@grafana/ui';
import { cx, css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

import type { ProgressRingProps } from '../../types/learning-paths.types';
import { getProgressRingStyles, getColorPalette } from './learning-paths.styles';

/**
 * Circular progress ring with gradient stroke
 */
export function ProgressRing({
  progress,
  size = 48,
  strokeWidth = 4,
  isCompleted = false,
  showPercentage = true,
}: ProgressRingProps) {
  const styles = useStyles2(getProgressRingStyles);
  const colors = useStyles2(getColorPalette);
  const checkmarkStyles = useStyles2(getCheckmarkStyles);

  // Calculate SVG parameters
  const { radius, circumference, dashOffset, gradientId } = useMemo(() => {
    const r = (size - strokeWidth) / 2;
    const c = 2 * Math.PI * r;
    const clampedProgress = Math.max(0, Math.min(100, progress));
    const offset = c - (clampedProgress / 100) * c;
    const id = `progress-gradient-${Math.random().toString(36).substr(2, 9)}`;

    return {
      radius: r,
      circumference: c,
      dashOffset: offset,
      gradientId: id,
    };
  }, [size, strokeWidth, progress]);

  const center = size / 2;

  // Determine stroke color based on completion
  const strokeColor = isCompleted ? colors.success : `url(#${gradientId})`;

  return (
    <div
      className={cx(styles.container, isCompleted && styles.completed)}
      style={{ width: size, height: size }}
    >
      <svg className={styles.svg} width={size} height={size}>
        {/* Gradient definition */}
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={colors.pathAccent} />
            <stop offset="100%" stopColor={isCompleted ? colors.success : '#4ECDC4'} />
          </linearGradient>
        </defs>

        {/* Background track */}
        <circle
          className={styles.track}
          cx={center}
          cy={center}
          r={radius}
          strokeWidth={strokeWidth}
        />

        {/* Progress arc */}
        <circle
          className={styles.progress}
          cx={center}
          cy={center}
          r={radius}
          strokeWidth={strokeWidth}
          stroke={strokeColor}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>

      {/* Show checkmark when complete, percentage otherwise */}
      {showPercentage && (
        isCompleted ? (
          <span className={checkmarkStyles.checkmark}>
            <Icon name="check" size="lg" />
          </span>
        ) : (
          <span className={styles.percentage}>
            {Math.round(progress)}%
          </span>
        )
      )}
    </div>
  );
}

// Checkmark styles for completed state
const getCheckmarkStyles = (theme: GrafanaTheme2) => {
  const colors = getColorPalette(theme);
  return {
    checkmark: css({
      position: 'absolute',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: colors.success,
      fontWeight: 'bold',
    }),
  };
};
