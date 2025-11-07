/**
 * Hand Raise Button Component
 *
 * Toggle button for attendees to raise/lower their hand in live sessions
 */

import React from 'react';
import { Button, Tooltip, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';

/**
 * Props for HandRaiseButton
 */
interface HandRaiseButtonProps {
  /** Current hand raise state */
  isRaised: boolean;
  /** Callback when button is toggled */
  onToggle: (isRaised: boolean) => void;
}

/**
 * Hand raise button component for attendees
 *
 * Displays a button that toggles between raised and lowered hand states
 */
export function HandRaiseButton({ isRaised, onToggle }: HandRaiseButtonProps) {
  const styles = useStyles2(getStyles);
  const handleClick = () => {
    onToggle(!isRaised);
  };

  return (
    <Tooltip content={isRaised ? 'Lower hand' : 'Raise hand'} placement="bottom">
      <Button
        size="sm"
        variant={isRaised ? 'primary' : 'secondary'}
        onClick={handleClick}
        aria-label={isRaised ? 'Lower hand' : 'Raise hand'}
        className={styles.button}
      >
        <span className={styles.emoji}>✋</span>
      </Button>
    </Tooltip>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  button: css({
    minWidth: 'auto',
  }),
  emoji: css({
    fontSize: '16px',
    lineHeight: 1,
  }),
});

