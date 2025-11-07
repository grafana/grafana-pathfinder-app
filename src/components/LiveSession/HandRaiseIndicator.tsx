/**
 * Hand Raise Indicator Component
 *
 * Shows the number of raised hands and opens the queue when clicked
 */

import React from 'react';
import { Button, Badge, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';

/**
 * Props for HandRaiseIndicator
 */
interface HandRaiseIndicatorProps {
  /** Number of raised hands */
  count: number;
  /** Callback when indicator is clicked */
  onClick: () => void;
}

/**
 * Hand raise indicator component for presenters
 *
 * Displays a button with badge showing the count of raised hands
 */
export function HandRaiseIndicator({ count, onClick }: HandRaiseIndicatorProps) {
  const styles = useStyles2(getStyles);

  // Only show when there are raised hands
  if (count === 0) {
    return null;
  }

  return (
    <div className={styles.container}>
      <Button size="sm" variant="secondary" onClick={onClick} aria-label="View raised hands">
        <span className={styles.buttonContent}>
          <span className={styles.emoji}>✋</span>
          <Badge text={count.toString()} color="orange" className={styles.badge} />
        </span>
      </Button>
    </div>
  );
}

/**
 * Styles for HandRaiseIndicator
 */
const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'inline-flex',
    alignItems: 'center',
  }),
  buttonContent: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  emoji: css({
    fontSize: '16px',
    lineHeight: 1,
  }),
  badge: css({
    marginLeft: theme.spacing(0.5),
  }),
});

