/**
 * Block Palette
 *
 * A centered modal showing all available block types.
 * Users click the + Add Block button to add new blocks to their guide.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Icon, Portal, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { BLOCK_TYPE_METADATA, BLOCK_TYPE_ORDER } from './constants';
import type { BlockType, OnBlockTypeSelect } from './types';

// Styles for the palette modal
const getPaletteModalStyles = (theme: GrafanaTheme2) => ({
  trigger: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(1),
    width: '100%',
    padding: theme.spacing(1.5),
    border: `2px dashed ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    backgroundColor: 'transparent',
    color: theme.colors.text.secondary,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.fontWeightMedium,

    '&:hover': {
      borderColor: theme.colors.primary.border,
      backgroundColor: theme.colors.action.hover,
      color: theme.colors.text.primary,
    },
  }),
  triggerCompact: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(0.5),
    padding: `${theme.spacing(0.75)} ${theme.spacing(1.5)}`,
    border: `1px dashed ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    backgroundColor: 'transparent',
    color: theme.colors.text.secondary,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    fontSize: theme.typography.bodySmall.fontSize,

    '&:hover': {
      borderColor: theme.colors.primary.border,
      backgroundColor: theme.colors.action.hover,
      color: theme.colors.text.primary,
    },
  }),
  overlay: css({
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 10000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    animation: 'fadeIn 0.15s ease',
    '@keyframes fadeIn': {
      from: { opacity: 0 },
      to: { opacity: 1 },
    },
  }),
  modal: css({
    backgroundColor: theme.colors.background.primary,
    borderRadius: theme.shape.radius.default,
    boxShadow: theme.shadows.z3,
    maxWidth: '500px',
    width: '90%',
    maxHeight: '80vh',
    overflow: 'hidden',
    animation: 'slideUp 0.2s ease',
    '@keyframes slideUp': {
      from: { transform: 'translateY(20px)', opacity: 0 },
      to: { transform: 'translateY(0)', opacity: 1 },
    },
  }),
  header: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing(2),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  title: css({
    fontSize: theme.typography.h4.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    margin: 0,
  }),
  closeButton: css({
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: theme.spacing(0.5),
    color: theme.colors.text.secondary,
    borderRadius: theme.shape.radius.default,
    transition: 'all 0.15s ease',

    '&:hover': {
      backgroundColor: theme.colors.action.hover,
      color: theme.colors.text.primary,
    },
  }),
  content: css({
    padding: theme.spacing(2),
    overflowY: 'auto',
    maxHeight: 'calc(80vh - 60px)',
  }),
  grid: css({
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: theme.spacing(1.5),
  }),
  item: css({
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(1.5),
    padding: theme.spacing(1.5),
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    backgroundColor: theme.colors.background.secondary,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    textAlign: 'left',

    '&:hover': {
      borderColor: theme.colors.primary.border,
      backgroundColor: theme.colors.action.hover,
      transform: 'translateY(-2px)',
      boxShadow: theme.shadows.z1,
    },
  }),
  itemIcon: css({
    fontSize: '24px',
    width: '36px',
    height: '36px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    backgroundColor: theme.colors.background.canvas,
    borderRadius: theme.shape.radius.default,
  }),
  itemContent: css({
    flex: 1,
    minWidth: 0,
  }),
  itemName: css({
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    marginBottom: theme.spacing(0.25),
  }),
  itemDescription: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    lineHeight: 1.4,
  }),
});

export interface BlockPaletteProps {
  /** Called when a block type is selected */
  onSelect: OnBlockTypeSelect;
  /** Index to insert the block at (for inline add buttons) */
  insertAtIndex?: number;
  /** Whether to use compact styling (for inline buttons) */
  compact?: boolean;
  /** Block types to exclude from the palette */
  excludeTypes?: BlockType[];
}

/**
 * Block palette modal for adding new blocks
 */
export function BlockPalette({ onSelect, insertAtIndex, compact = false, excludeTypes = [] }: BlockPaletteProps) {
  const styles = useStyles2(getPaletteModalStyles);
  const [isOpen, setIsOpen] = useState(false);

  // Filter out excluded types
  const availableTypes = BLOCK_TYPE_ORDER.filter((type) => !excludeTypes.includes(type));

  // Handle escape key to close
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Handle trigger click
  const handleTriggerClick = useCallback(() => {
    setIsOpen(true);
  }, []);

  // Handle overlay click (close)
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      setIsOpen(false);
    }
  }, []);

  // Handle block type selection
  const handleSelect = useCallback(
    (type: BlockType) => {
      onSelect(type, insertAtIndex);
      setIsOpen(false);
    },
    [onSelect, insertAtIndex]
  );

  return (
    <>
      <button
        className={compact ? styles.triggerCompact : styles.trigger}
        onClick={handleTriggerClick}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <Icon name="plus" size={compact ? 'sm' : 'md'} />
        <span>Add Block</span>
      </button>

      {isOpen && (
        <Portal>
          <div className={styles.overlay} onClick={handleOverlayClick}>
            <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Add Block">
              <div className={styles.header}>
                <h3 className={styles.title}>Add Block</h3>
                <button
                  className={styles.closeButton}
                  onClick={() => setIsOpen(false)}
                  aria-label="Close"
                  type="button"
                >
                  <Icon name="times" size="lg" />
                </button>
              </div>
              <div className={styles.content}>
                <div className={styles.grid}>
                  {availableTypes.map((type) => {
                    const meta = BLOCK_TYPE_METADATA[type];
                    return (
                      <button key={type} className={styles.item} onClick={() => handleSelect(type)} type="button">
                        <span className={styles.itemIcon}>{meta.icon}</span>
                        <div className={styles.itemContent}>
                          <div className={styles.itemName}>{meta.name}</div>
                          <div className={styles.itemDescription}>{meta.description}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}

// Add display name for debugging
BlockPalette.displayName = 'BlockPalette';
