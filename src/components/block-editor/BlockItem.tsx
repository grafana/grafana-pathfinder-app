/**
 * Block Item
 *
 * Individual block wrapper with drag handle, type indicator, preview, and actions.
 */

import React, { useCallback, useMemo } from 'react';
import { IconButton, useStyles2, Badge } from '@grafana/ui';
import { getBlockItemStyles } from './block-editor.styles';
import { BLOCK_TYPE_METADATA } from './constants';
import type { EditorBlock, BlockType } from './types';
import {
  isMarkdownBlock,
  isHtmlBlock,
  isImageBlock,
  isVideoBlock,
  isSectionBlock,
  isInteractiveBlock,
  isMultistepBlock,
  isGuidedBlock,
} from '../../types/json-guide.types';

export interface BlockItemProps {
  /** The block to render */
  block: EditorBlock;
  /** Index in the list */
  index: number;
  /** Total number of blocks */
  totalBlocks: number;
  /** Whether this block is selected */
  isSelected: boolean;
  /** Called when block is clicked */
  onClick: () => void;
  /** Called when edit is requested */
  onEdit: () => void;
  /** Called when delete is requested */
  onDelete: () => void;
  /** Called to move the block up */
  onMoveUp: () => void;
  /** Called to move the block down */
  onMoveDown: () => void;
  /** Called to duplicate the block */
  onDuplicate: () => void;
}

/**
 * Get a preview string for a block
 */
function getBlockPreview(block: EditorBlock['block']): string {
  if (isMarkdownBlock(block)) {
    // Show first line of content, truncated
    const firstLine = block.content.split('\n')[0];
    return firstLine.slice(0, 60) + (firstLine.length > 60 ? '...' : '');
  }
  if (isHtmlBlock(block)) {
    // Strip HTML tags and show text
    const text = block.content.replace(/<[^>]+>/g, ' ').trim();
    return text.slice(0, 60) + (text.length > 60 ? '...' : '');
  }
  if (isImageBlock(block)) {
    return block.alt || block.src;
  }
  if (isVideoBlock(block)) {
    return block.title || block.src;
  }
  if (isSectionBlock(block)) {
    return block.title || block.id || `${block.blocks.length} blocks`;
  }
  if (isInteractiveBlock(block)) {
    return `${block.action}: ${block.reftarget}`;
  }
  if (isMultistepBlock(block)) {
    return `${block.steps.length} steps`;
  }
  if (isGuidedBlock(block)) {
    return `${block.steps.length} guided steps`;
  }
  return '';
}

/**
 * Block item component
 */
export function BlockItem({
  block,
  index,
  totalBlocks,
  isSelected,
  onClick,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  onDuplicate,
}: BlockItemProps) {
  const styles = useStyles2(getBlockItemStyles);
  const blockType = block.block.type as BlockType;
  const meta = BLOCK_TYPE_METADATA[blockType];
  const preview = useMemo(() => getBlockPreview(block.block), [block.block]);

  const isSection = isSectionBlock(block.block);
  const canMoveUp = index > 0;
  const canMoveDown = index < totalBlocks - 1;

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClick();
    },
    [onClick]
  );

  const handleEdit = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onEdit();
    },
    [onEdit]
  );

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDelete();
    },
    [onDelete]
  );

  const handleMoveUp = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onMoveUp();
    },
    [onMoveUp]
  );

  const handleMoveDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onMoveDown();
    },
    [onMoveDown]
  );

  const handleDuplicate = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDuplicate();
    },
    [onDuplicate]
  );

  const containerClass = [
    styles.container,
    isSelected && styles.containerSelected,
    isSection && styles.sectionContainer,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={containerClass}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {/* Drag handle */}
      <div className={styles.dragHandle} title="Drag to reorder">
        <span style={{ fontSize: '14px' }}>⋮⋮</span>
      </div>

      {/* Content */}
      <div className={styles.content}>
        <div className={styles.header}>
          <span className={styles.typeIcon}>{meta.icon}</span>
          <Badge text={meta.name} color="blue" className={styles.typeBadge} />
          {isInteractiveBlock(block.block) && <Badge text={block.block.action} color="purple" />}
          {isSectionBlock(block.block) && block.block.title && (
            <span style={{ marginLeft: '8px', fontWeight: 500 }}>{block.block.title}</span>
          )}
        </div>
        {preview && (
          <div className={styles.preview} title={preview}>
            {preview}
          </div>
        )}
      </div>

      {/* Actions - grouped for clarity */}
      <div className={styles.actions}>
        {/* Move controls */}
        <div className={styles.actionGroup}>
          <IconButton
            name="arrow-up"
            size="md"
            aria-label="Move up"
            onClick={handleMoveUp}
            disabled={!canMoveUp}
            className={styles.moveButton}
            tooltip="Move up"
          />
          <IconButton
            name="arrow-down"
            size="md"
            aria-label="Move down"
            onClick={handleMoveDown}
            disabled={!canMoveDown}
            className={styles.moveButton}
            tooltip="Move down"
          />
        </div>

        {/* Primary actions */}
        <div className={styles.actionGroup}>
          <IconButton
            name="edit"
            size="md"
            aria-label="Edit"
            onClick={handleEdit}
            className={styles.editButton}
            tooltip="Edit block"
          />
          <IconButton
            name="copy"
            size="md"
            aria-label="Duplicate"
            onClick={handleDuplicate}
            className={styles.actionButton}
            tooltip="Duplicate block"
          />
          <IconButton
            name="trash-alt"
            size="md"
            aria-label="Delete"
            onClick={handleDelete}
            className={styles.deleteButton}
            tooltip="Delete block"
          />
        </div>
      </div>
    </div>
  );
}

// Add display name for debugging
BlockItem.displayName = 'BlockItem';
