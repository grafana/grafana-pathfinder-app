/**
 * Nested Block Item
 *
 * Renders blocks inside sections and conditional branches.
 * Uses same layout as root-level BlockItem for consistency.
 */

import React, { useCallback } from 'react';
import { useStyles2, Badge, IconButton, Checkbox } from '@grafana/ui';
import { ConfirmDeleteButton } from './ConfirmDeleteButton';
import { getNestedBlockItemStyles } from './BlockList.styles';
import { BLOCK_TYPE_METADATA } from './constants';
import type { BlockType, JsonBlock } from './types';

export interface NestedBlockItemProps {
  block: JsonBlock;
  onEdit?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  /** Whether this block was just dropped (triggers highlight animation) */
  isJustDropped?: boolean;
}

/**
 * Nested block item component - renders blocks inside sections
 * Uses same layout as root-level BlockItem for consistency
 */
export function NestedBlockItem({
  block,
  onEdit,
  onDelete,
  onDuplicate,
  isSelectionMode = false,
  isSelected = false,
  onToggleSelect,
  isJustDropped = false,
}: NestedBlockItemProps) {
  const styles = useStyles2(getNestedBlockItemStyles);
  const meta = BLOCK_TYPE_METADATA[block.type as BlockType];

  // Interactive, multistep, and guided blocks can be selected for merging
  const isSelectable =
    isSelectionMode && (block.type === 'interactive' || block.type === 'multistep' || block.type === 'guided');

  // Get preview content - same logic as BlockItem
  const getPreview = (): string => {
    if ('content' in block && typeof block.content === 'string') {
      const firstLine = block.content.split('\n')[0];
      return firstLine.slice(0, 60) + (firstLine.length > 60 ? '...' : '');
    }
    if ('reftarget' in block && typeof block.reftarget === 'string') {
      return `${(block as { action?: string }).action || ''}: ${block.reftarget}`;
    }
    if ('src' in block && typeof block.src === 'string') {
      return block.src;
    }
    return '';
  };

  const preview = getPreview();

  const handleCheckboxClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleSelect?.();
    },
    [onToggleSelect]
  );

  const containerClass = [
    styles.container,
    isSelected && styles.selectedContainer,
    isJustDropped && styles.justDroppedContainer,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={containerClass}>
      {/* Selection checkbox (only for interactive blocks in selection mode) */}
      {isSelectionMode && (
        <div
          className={styles.selectionCheckbox}
          onClick={handleCheckboxClick}
          title={
            isSelectable
              ? isSelected
                ? 'Deselect'
                : 'Select'
              : 'Only interactive, multistep, and guided blocks can be selected'
          }
        >
          <Checkbox value={isSelected} disabled={!isSelectable} onChange={onToggleSelect} />
        </div>
      )}

      {/* Drag handle - visual indicator only (hidden in selection mode) */}
      {!isSelectionMode && (
        <div className={styles.dragHandle} title="Drag to reorder or move out of section">
          <span style={{ fontSize: '12px' }}>⋮⋮</span>
        </div>
      )}

      {/* Content - matches BlockItem layout */}
      <div className={styles.content}>
        <div className={styles.header}>
          <span className={styles.icon}>{meta?.icon}</span>
          <Badge text={meta?.name ?? block.type} color="blue" />
          {'action' in block && (
            <Badge text={String(block.action).charAt(0).toUpperCase() + String(block.action).slice(1)} color="purple" />
          )}
        </div>
        {preview && (
          <div className={styles.preview} title={preview}>
            {preview}
          </div>
        )}
      </div>

      {/* Actions */}
      {/* draggable={false} prevents drag from starting when clicking this area */}
      <div className={styles.actions} draggable={false} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.actionGroup}>
          <IconButton
            name="edit"
            size="md"
            aria-label="Edit"
            onClick={onEdit}
            className={styles.editButton}
            tooltip="Edit block"
          />
          <IconButton
            name="copy"
            size="md"
            aria-label="Duplicate"
            onClick={onDuplicate}
            className={styles.actionButton}
            tooltip="Duplicate block"
          />
          <ConfirmDeleteButton
            onConfirm={onDelete ?? (() => {})}
            className={styles.deleteButton}
            tooltip="Delete block"
            ariaLabel="Delete"
            blockType={meta.name.toLowerCase()}
          />
        </div>
      </div>
    </div>
  );
}

// Add display name for debugging
NestedBlockItem.displayName = 'NestedBlockItem';
