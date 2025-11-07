/**
 * Hand Raise Queue Component
 *
 * Displays a modal showing the queue of raised hands
 */

import React, { useEffect, useRef } from 'react';
import { useStyles2, IconButton } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import type { HandRaiseInfo } from '../../types/collaboration.types';

/**
 * Props for HandRaiseQueue
 */
interface HandRaiseQueueProps {
  /** List of raised hands */
  handRaises: HandRaiseInfo[];
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback to close the modal */
  onClose: () => void;
  /** Reference to the anchor element for positioning */
  anchorRef: React.RefObject<HTMLElement>;
}

/**
 * Format timestamp to relative time string
 */
const formatRelativeTime = (timestamp: number): string => {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  
  if (seconds < 60) {
    return 'just now';
  }
  
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

/**
 * Hand raise queue modal component
 *
 * Displays a dropdown-style modal showing the list of attendees with raised hands
 */
export function HandRaiseQueue({ handRaises, isOpen, onClose, anchorRef }: HandRaiseQueueProps) {
  const styles = useStyles2(getStyles);
  const modalRef = useRef<HTMLDivElement>(null);

  // Close modal when clicking outside
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (
        modalRef.current &&
        !modalRef.current.contains(event.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose, anchorRef]);

  if (!isOpen) {
    return null;
  }

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div ref={modalRef} className={styles.modal}>
        <div className={styles.header}>
          <h4 className={styles.title}>Raised Hands</h4>
          <IconButton name="times" size="md" onClick={onClose} aria-label="Close" tooltip="Close" />
        </div>
        <div className={styles.content}>
          {handRaises.length === 0 ? (
            <div className={styles.emptyState}>No raised hands</div>
          ) : (
            <div className={styles.list}>
              {handRaises.map((handRaise) => (
                <div key={handRaise.attendeeId} className={styles.listItem}>
                  <span className={styles.attendeeName}>{handRaise.attendeeName}</span>
                  <span className={styles.timestamp}>{formatRelativeTime(handRaise.raisedAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * Styles for HandRaiseQueue
 */
const getStyles = (theme: GrafanaTheme2) => ({
  backdrop: css({
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    zIndex: 9998,
  }),
  modal: css({
    position: 'fixed',
    top: '80px',
    right: theme.spacing(2),
    width: '320px',
    maxHeight: '400px',
    backgroundColor: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    boxShadow: theme.shadows.z3,
    zIndex: 9999,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  }),
  header: css({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing(2),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  title: css({
    margin: 0,
    fontSize: theme.typography.h5.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  content: css({
    flex: 1,
    overflow: 'auto',
    padding: theme.spacing(1),
  }),
  list: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
  }),
  listItem: css({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing(1.5),
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    '&:hover': {
      backgroundColor: theme.colors.emphasize(theme.colors.background.secondary, 0.03),
    },
  }),
  attendeeName: css({
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
  }),
  timestamp: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  emptyState: css({
    padding: theme.spacing(3),
    textAlign: 'center',
    color: theme.colors.text.secondary,
    fontSize: theme.typography.body.fontSize,
  }),
});

