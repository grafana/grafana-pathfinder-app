/**
 * Confirm Delete Button
 *
 * A compact delete button that requires two clicks to confirm deletion.
 * First click shows confirmation state, second click performs the delete.
 * Auto-resets after a timeout if not confirmed.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { IconButton, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

const CONFIRM_TIMEOUT_MS = 3000;

const getStyles = (theme: GrafanaTheme2) => ({
  // Normal delete button state
  deleteButton: css({
    opacity: 0.7,
    color: theme.colors.error.text,
    transition: 'all 0.15s ease',

    '&:hover': {
      opacity: 1,
      backgroundColor: theme.colors.error.transparent,
    },
  }),

  // Confirming state - more prominent
  confirmButton: css({
    opacity: 1,
    color: theme.colors.error.contrastText,
    backgroundColor: theme.colors.error.main,
    borderRadius: theme.shape.radius.default,
    transition: 'all 0.15s ease',
    // Slightly larger hit area in confirm state
    padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,

    '&:hover': {
      backgroundColor: theme.colors.error.shade,
    },
  }),

  // Text shown in confirm state
  confirmText: css({
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    whiteSpace: 'nowrap',
  }),
});

export interface ConfirmDeleteButtonProps {
  /** Called when deletion is confirmed (after two clicks) */
  onConfirm: () => void;
  /** Optional class name for the button */
  className?: string;
  /** Tooltip text (default: "Delete block") */
  tooltip?: string;
  /** Aria label (default: "Delete") */
  ariaLabel?: string;
}

/**
 * A delete button that requires confirmation before executing.
 *
 * - First click: Shows "Delete?" confirmation state
 * - Second click: Executes the delete action
 * - Auto-resets after 3 seconds if not confirmed
 */
export function ConfirmDeleteButton({
  onConfirm,
  className,
  tooltip = 'Delete block',
  ariaLabel = 'Delete',
}: ConfirmDeleteButtonProps) {
  const styles = useStyles2(getStyles);
  const [isPendingConfirm, setIsPendingConfirm] = useState(false);

  // REACT: cleanup timeout on unmount (R1)
  useEffect(() => {
    if (!isPendingConfirm) {
      return;
    }

    const timer = setTimeout(() => {
      setIsPendingConfirm(false);
    }, CONFIRM_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [isPendingConfirm]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();

      if (isPendingConfirm) {
        // Second click - confirm deletion
        onConfirm();
        setIsPendingConfirm(false);
      } else {
        // First click - enter confirmation state
        setIsPendingConfirm(true);
      }
    },
    [isPendingConfirm, onConfirm]
  );

  if (isPendingConfirm) {
    return (
      <button
        type="button"
        className={`${styles.confirmButton} ${className ?? ''}`}
        onClick={handleClick}
        aria-label="Confirm delete"
        title="Click again to confirm deletion"
      >
        <span className={styles.confirmText}>Delete?</span>
      </button>
    );
  }

  return (
    <IconButton
      name="trash-alt"
      size="md"
      aria-label={ariaLabel}
      onClick={handleClick}
      className={className ?? styles.deleteButton}
      tooltip={tooltip}
    />
  );
}

// Add display name for debugging
ConfirmDeleteButton.displayName = 'ConfirmDeleteButton';
