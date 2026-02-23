/**
 * Notification Modals
 *
 * Proper modal dialogs for user notifications instead of system alerts/confirms
 */

import React from 'react';
import { Modal, Button } from '@grafana/ui';

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string | React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: 'primary' | 'destructive';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText = 'OK',
  cancelText = 'Cancel',
  variant = 'primary',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <Modal title={title} isOpen={isOpen} onDismiss={onCancel}>
      <div style={{ marginBottom: '24px' }}>
        {typeof message === 'string' ? <p style={{ whiteSpace: 'pre-line' }}>{message}</p> : message}
      </div>
      <Modal.ButtonRow>
        <Button variant="secondary" onClick={onCancel}>
          {cancelText}
        </Button>
        <Button variant={variant} onClick={onConfirm}>
          {confirmText}
        </Button>
      </Modal.ButtonRow>
    </Modal>
  );
}

export interface AlertModalProps {
  isOpen: boolean;
  title: string;
  message: string | React.ReactNode;
  severity?: 'info' | 'success' | 'warning' | 'error';
  buttonText?: string;
  onClose: () => void;
}

export function AlertModal({ isOpen, title, message, severity = 'info', buttonText = 'OK', onClose }: AlertModalProps) {
  // Map severity to button variant
  const getButtonVariant = () => {
    switch (severity) {
      case 'error':
        return 'destructive';
      case 'success':
        return 'primary';
      default:
        return 'secondary';
    }
  };

  return (
    <Modal title={title} isOpen={isOpen} onDismiss={onClose}>
      <div style={{ marginBottom: '24px' }}>
        {typeof message === 'string' ? <p style={{ whiteSpace: 'pre-line' }}>{message}</p> : message}
      </div>
      <Modal.ButtonRow>
        <Button variant={getButtonVariant()} onClick={onClose}>
          {buttonText}
        </Button>
      </Modal.ButtonRow>
    </Modal>
  );
}
