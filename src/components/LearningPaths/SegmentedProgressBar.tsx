import React from 'react';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';

export type ProgressSegmentState = 'done' | 'current' | 'upcoming';

export function SegmentedProgressBar({
  segments,
  highContrast = false,
  currentColor = 'warning',
}: {
  segments: ProgressSegmentState[];
  highContrast?: boolean;
  currentColor?: 'warning' | 'primary';
}) {
  const styles = useStyles2(getStyles);
  return (
    <div className={styles.track} aria-hidden="true">
      {segments.map((state, index) => (
        <div
          key={index}
          className={cx(
            styles.segment,
            highContrast && state === 'upcoming' && styles.contrastSegment,
            currentColor === 'primary' && styles.primaryCurrent
          )}
          data-segment-state={state}
        />
      ))}
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  track: css({ display: 'flex', gap: theme.spacing(0.5), width: '100%' }),
  contrastSegment: css({ backgroundColor: theme.colors.border.medium }),
  primaryCurrent: css({ '&[data-segment-state="current"]': { backgroundColor: theme.colors.text.primary } }),
  segment: css({
    flex: 1,
    minWidth: 0,
    height: theme.spacing(0.375),
    borderRadius: theme.shape.radius.default,
    backgroundColor: theme.colors.background.secondary,
    transition: 'background-color 0.2s ease',
    '&[data-segment-state="done"]': { backgroundColor: theme.colors.success.main },
    '&[data-segment-state="current"]': { backgroundColor: theme.colors.warning.main },
  }),
});
