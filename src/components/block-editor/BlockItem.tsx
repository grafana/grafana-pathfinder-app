/**
 * Block Item
 *
 * Individual block wrapper with drag handle, type indicator, preview, and actions.
 */

import React, { useCallback, useMemo } from 'react';
import { IconButton, useStyles2, Badge } from '@grafana/ui';
import { getBlockItemStyles } from './block-editor.styles';
import { ConfirmDeleteButton } from './ConfirmDeleteButton';
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
  /** Called when edit is requested */
  onEdit: () => void;
  /** Called when delete is requested */
  onDelete: () => void;
  /** Called to duplicate the block */
  onDuplicate: () => void;
  /** Called when record is requested (sections only) */
  onRecord?: () => void;
  /** Whether recording is active for this section */
  isRecording?: boolean;
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
  onEdit,
  onDelete,
  onDuplicate,
  onRecord,
  isRecording = false,
}: BlockItemProps) {
  const styles = useStyles2(getBlockItemStyles);
  const blockType = block.block.type as BlockType;
  const meta = BLOCK_TYPE_METADATA[blockType];
  const preview = useMemo(() => getBlockPreview(block.block), [block.block]);

  const isSection = isSectionBlock(block.block);
  // Keep these for potential future use, suppress unused warnings
  void index;
  void totalBlocks;

  const handleEdit = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onEdit();
    },
    [onEdit]
  );

  const handleDuplicate = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDuplicate();
    },
    [onDuplicate]
  );

  const handleRecord = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onRecord?.();
    },
    [onRecord]
  );

  const containerClass = [styles.container, isSection && styles.sectionContainer].filter(Boolean).join(' ');

  return (
    <div className={containerClass}>
      {/* Drag handle - visual indicator */}
      <div className={styles.dragHandle} title="Drag to reorder">
        <span style={{ fontSize: '12px' }}>⋮⋮</span>
      </div>

      {/* Content */}
      <div className={styles.content}>
        <div className={styles.header}>
          <span className={styles.typeIcon}>{meta.icon}</span>
          <Badge text={meta.name} color="blue" />
          {isInteractiveBlock(block.block) && (
            <Badge text={block.block.action.charAt(0).toUpperCase() + block.block.action.slice(1)} color="purple" />
          )}
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

      {/* Actions */}
      {/* draggable={false} prevents drag from starting when clicking this area */}
      <div className={styles.actions} draggable={false} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.actionGroup}>
          {/* Record button for sections */}
          {isSection && onRecord && (
            <IconButton
              name={isRecording ? 'square-shape' : 'circle'}
              size="md"
              aria-label={isRecording ? 'Stop recording' : 'Record into section'}
              onClick={handleRecord}
              className={isRecording ? styles.recordingButton : styles.recordButton}
              tooltip={isRecording ? 'Stop recording' : 'Record into section'}
            />
          )}
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
          <ConfirmDeleteButton
            onConfirm={onDelete}
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
BlockItem.displayName = 'BlockItem';
