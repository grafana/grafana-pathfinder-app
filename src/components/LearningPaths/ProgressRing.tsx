import React, { useMemo, useId } from 'react';
import { useStyles2, Icon } from '@grafana/ui';
import { cx, css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

import type { ProgressRingProps } from '../../types/learning-paths.types';
import { getProgressRingStyles, getColorPalette } from './learning-paths.styles';

export function ProgressRing({
  progress,
  size = 48,
  strokeWidth = 4,
  isCompleted = false,
  showPercentage = true,
  ariaLabel,
}: ProgressRingProps) {
  const styles = useStyles2(getProgressRingStyles);
  const colors = useStyles2(getColorPalette);
  const checkmarkStyles = useStyles2(getCheckmarkStyles);

  const uniqueId = useId();

  const { radius, circumference, dashOffset, gradientId } = useMemo(() => {
    const r = (size - strokeWidth) / 2;
    const c = 2 * Math.PI * r;
    const clampedProgress = Math.max(0, Math.min(100, progress));
    const offset = c - (clampedProgress / 100) * c;

    return {
      radius: r,
      circumference: c,
      dashOffset: offset,
      gradientId: `progress-gradient-${uniqueId}`,
    };
  }, [size, strokeWidth, progress, uniqueId]);

  const center = size / 2;

  const strokeColor = isCompleted ? colors.ringSuccess : `url(#${gradientId})`;

  return (
    <div
      className={styles.container}
      style={{ width: size, height: size }}
      {...(ariaLabel != null && { role: 'img', 'aria-label': ariaLabel })}
    >
      <svg className={styles.svg} width={size} height={size}>
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={colors.pathAccent} />
            <stop offset="100%" stopColor="#4ECDC4" />
          </linearGradient>
        </defs>

        <circle className={styles.track} cx={center} cy={center} r={radius} strokeWidth={strokeWidth} />

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

      {showPercentage &&
        (isCompleted ? (
          <span className={checkmarkStyles.checkmark}>
            <Icon name="check" size={size <= 32 ? 'md' : 'lg'} />
          </span>
        ) : (
          <span className={cx(styles.percentage, size <= 32 && checkmarkStyles.compactPercentage)}>
            {Math.round(progress)}%
          </span>
        ))}
    </div>
  );
}

const getCheckmarkStyles = (theme: GrafanaTheme2) => {
  return {
    compactPercentage: css({ fontSize: 10 }),
    checkmark: css({
      position: 'absolute',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: theme.colors.success.text,
      fontWeight: 'bold',
    }),
  };
};
