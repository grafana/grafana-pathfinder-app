/**
 * Fixed overlay used as a modal backdrop. Renders only when visible; click closes.
 */

import React from 'react';

export interface ModalBackdropProps {
  /** When true, the backdrop is rendered and blocks interaction with content behind it */
  visible: boolean;
  /** Called when the backdrop is clicked (e.g. to close the modal) */
  onClose: () => void;
}

export function ModalBackdrop({ visible, onClose }: ModalBackdropProps) {
  if (!visible) {
    return null;
  }

  return (
    <div
      role="presentation"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        zIndex: 9999,
      }}
      onClick={onClose}
    />
  );
}
