/**
 * Confirm Delete Button
 *
 * A delete button that shows a confirmation modal before executing.
 */

import React, { useState, useCallback } from 'react';
import { IconButton, ConfirmModal } from '@grafana/ui';
import { testIds } from '../../constants/testIds';

export interface ConfirmDeleteButtonProps {
  /** Called when deletion is confirmed */
  onConfirm: () => void;
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
  tooltip = 'Delete block',
  ariaLabel = 'Delete',
  blockType = 'block',
}: ConfirmDeleteButtonProps) {
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
        variant="destructive"
        tooltip={tooltip}
        data-testid={testIds.blockEditor.deleteButton}
      />

      <ConfirmModal
        isOpen={isModalOpen}
        title="Delete Block"
        body={`Are you sure you want to delete this ${blockType}? This action cannot be undone.`}
        confirmText="Yes, Delete"
        dismissText="Cancel"
        onConfirm={handleConfirm}
        onDismiss={handleDismiss}
        confirmVariant="destructive"
      />
    </>
  );
}

ConfirmDeleteButton.displayName = 'ConfirmDeleteButton';
