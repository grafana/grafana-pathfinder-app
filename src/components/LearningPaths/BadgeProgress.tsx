import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';

import type { BadgeProgressInfo } from './badge-utils';

export function BadgeProgress({
  progress,
  ariaLabel,
  showCount = true,
}: {
  progress: BadgeProgressInfo;
  ariaLabel?: string;
  showCount?: boolean;
}) {
  const styles = useStyles2(getStyles);
  const percentage = Math.max(0, Math.min(100, progress.percentage));
  return (
    <div className={styles.container}>
      <div
        className={styles.track}
        role="progressbar"
        aria-label={ariaLabel}
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.current}
      >
        <div className={styles.fill} style={{ width: `${percentage}%` }} />
      </div>
      {showCount && (
        <span className={styles.count}>
          {progress.current}/{progress.total}
        </span>
      )}
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    width: '100%',
    minWidth: 0,
    flexShrink: 0,
  }),
  track: css({
    display: 'block',
    width: '100%',
    height: theme.spacing(0.75),
    flexShrink: 0,
    borderRadius: theme.shape.radius.pill,
    background: theme.colors.border.weak,
    overflow: 'hidden',
  }),
  fill: css({
    display: 'block',
    height: '100%',
    borderRadius: 'inherit',
    background: `linear-gradient(90deg, ${theme.isDark ? '#8B7CF6' : '#6C63FF'}, ${theme.colors.primary.main})`,
    transition: 'width 0.3s ease',
  }),
  count: css({ ...theme.typography.sm, color: theme.colors.text.secondary, fontVariantNumeric: 'tabular-nums' }),
});
