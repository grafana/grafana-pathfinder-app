/**
 * Confirm Delete Button
 *
 * A delete button that shows a confirmation modal before executing.
 */

import React, { useState, useCallback } from 'react';
import { IconButton, ConfirmModal, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

const getStyles = (theme: GrafanaTheme2) => ({
  deleteButton: css({
    opacity: 0.7,
    color: theme.colors.error.text,
    transition: 'all 0.15s ease',

    '&:hover': {
      opacity: 1,
      backgroundColor: theme.colors.error.transparent,
    },
  }),
});

export interface ConfirmDeleteButtonProps {
  /** Called when deletion is confirmed */
  onConfirm: () => void;
  /** Optional class name for the button */
  className?: string;
  /** Tooltip text (default: "Delete block") */
  tooltip?: string;
  /** Aria label (default: "Delete") */
  ariaLabel?: string;
  /** Block type name for the confirmation message */
  blockType?: string;
}

/**
 * A delete button that shows a confirmation modal before executing.
 */
export function ConfirmDeleteButton({
  onConfirm,
  className,
  tooltip = 'Delete block',
  ariaLabel = 'Delete',
  blockType = 'block',
}: ConfirmDeleteButtonProps) {
  const styles = useStyles2(getStyles);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsModalOpen(true);
  }, []);

  const handleConfirm = useCallback(() => {
    onConfirm();
    setIsModalOpen(false);
  }, [onConfirm]);

  const handleDismiss = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  return (
    <>
      <IconButton
        name="trash-alt"
        size="md"
        aria-label={ariaLabel}
        onClick={handleClick}
        className={className ?? styles.deleteButton}
        tooltip={tooltip}
        data-testid="block-delete-button"
      />

      <ConfirmModal
        isOpen={isModalOpen}
        title="Delete Block"
        body={`Are you sure you want to delete this ${blockType}? This action cannot be undone.`}
        confirmText="Yes, Delete"
        dismissText="Cancel"
        onConfirm={handleConfirm}
        onDismiss={handleDismiss}
      />
    </>
  );
}

ConfirmDeleteButton.displayName = 'ConfirmDeleteButton';
