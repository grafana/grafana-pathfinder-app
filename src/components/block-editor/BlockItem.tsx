/**
 * Block Item
 *
 * Individual block wrapper with drag handle, type indicator, preview, and actions.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { IconButton, useStyles2, Badge, Checkbox } from '@grafana/ui';
import { getBlockItemStyles } from './block-editor.styles';
import { AuthorNoteModal } from './AuthorNoteModal';
import { ConfirmDeleteButton } from './ConfirmDeleteButton';
import { LintBadge } from './LintBadge';
import { BLOCK_TYPE_METADATA } from './constants';
import type { EditorBlock, BlockType } from './types';
import {
  isSectionBlock,
  isInteractiveBlock,
  isMultistepBlock,
  isGuidedBlock,
  isConditionalBlock,
} from '../../types/json-guide.types';
import { getBlockPreview } from './utils';
import { testIds } from '../../constants/testIds';

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
  /** Whether selection mode is active */
  isSelectionMode?: boolean;
  /** Whether this block is selected */
  isSelected?: boolean;
  /** Called to toggle selection */
  onToggleSelect?: () => void;
  /** Whether this block can be collapsed (sections/conditionals) */
  isCollapsible?: boolean;
  /** Whether the block is currently collapsed */
  isCollapsed?: boolean;
  /** Called to toggle collapse state */
  onToggleCollapse?: () => void;
  /** Number of child blocks (for tooltip) */
  childCount?: number;
  /** Whether this block was just dropped (triggers highlight animation) */
  isJustDropped?: boolean;
  /** Whether this block was the last one modified (persistent highlight) */
  isLastModified?: boolean;
  /** Called to preview this block */
  onPreview?: () => void;
  /** Whether this block preview is currently open */
  isPreviewActive?: boolean;
  /** Save a new author-only note onto this block. */
  onAuthorNoteChange?: (note: string) => void;
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
  isSelectionMode = false,
  isSelected = false,
  onToggleSelect,
  isCollapsible = false,
  isCollapsed = false,
  onToggleCollapse,
  childCount = 0,
  isJustDropped = false,
  isLastModified = false,
  onPreview,
  isPreviewActive = false,
  onAuthorNoteChange,
}: BlockItemProps) {
  const styles = useStyles2(getBlockItemStyles);
  const blockType = block.block.type as BlockType;
  const meta = BLOCK_TYPE_METADATA[blockType] ?? {
    type: blockType,
    icon: '❓',
    grafanaIcon: 'question-circle',
    name: blockType || 'Unknown',
    description: 'Unknown block type',
  };
  const preview = useMemo(() => getBlockPreview(block.block), [block.block]);

  const isSection = isSectionBlock(block.block);
  const isConditional = isConditionalBlock(block.block);
  void totalBlocks;

  // Author-note modal state. Lives at the row level so it can read /
  // write the block's `authorNote` via the parent-supplied callback.
  const [isNoteModalOpen, setNoteModalOpen] = useState(false);
  const currentAuthorNote = block.block.authorNote ?? '';

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

  const handleToggleSelect = useCallback(() => {
    onToggleSelect?.();
  }, [onToggleSelect]);

  const handleCheckboxClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      handleToggleSelect();
    },
    [handleToggleSelect]
  );

  const handleToggleCollapse = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleCollapse?.();
    },
    [onToggleCollapse]
  );

  // Allow selection of interactive, multistep, and guided blocks (for merging)
  const isSelectable =
    isSelectionMode && (isInteractiveBlock(block.block) || isMultistepBlock(block.block) || isGuidedBlock(block.block));

  const containerClass = [
    styles.container,
    (isSection || isConditional) && styles.sectionContainer,
    isSelected && styles.selectedContainer,
    isJustDropped && styles.justDroppedContainer,
    isLastModified && !isJustDropped && styles.lastModifiedContainer,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={containerClass} data-block-card>
      {/* Selection checkbox — only for selectable block types
          (interactive / multistep / guided). Non-selectable blocks
          render an empty spacer of the same width so the row
          alignment stays consistent across the list. */}
      {isSelectionMode &&
        (isSelectable ? (
          <div
            className={styles.selectionCheckbox}
            onClick={handleCheckboxClick}
            title={isSelected ? 'Deselect' : 'Select'}
          >
            <Checkbox value={isSelected} onChange={handleToggleSelect} />
          </div>
        ) : (
          <div className={styles.selectionCheckbox} aria-hidden="true" />
        ))}

      {/* Drag handle - visual indicator (hidden in selection mode) */}
      {!isSelectionMode && (
        <div className={styles.dragHandle} data-drag-handle title="Drag to reorder">
          <span style={{ fontSize: '14px', lineHeight: 1 }}>⋮</span>
        </div>
      )}

      {/* Content — single inline row.
          - Sections render their authored title (if any) instead of preview.
          - Interactive/input blocks no longer render a separate sub-type
            badge; the action verb already appears in the preview.
          - Conditional blocks keep their orange/green meta badges. */}
      <div className={styles.content}>
        <div className={styles.header}>
          <span className={styles.blockNumber}>{index + 1}</span>
          <span className={styles.typeIcon}>{meta.icon}</span>
          <Badge text={meta.name} color="blue" />
          {isSectionBlock(block.block) && block.block.title ? (
            <span className={styles.sectionTitle} title={block.block.title}>
              {block.block.title}
            </span>
          ) : (
            preview && (
              <span className={styles.headlinePreview} title={preview}>
                {preview}
              </span>
            )
          )}
          {isConditionalBlock(block.block) && (
            <>
              <Badge
                text={`${block.block.conditions.length} condition${block.block.conditions.length !== 1 ? 's' : ''}`}
                color="orange"
              />
              {block.block.display === 'section' && <Badge text="Section" color="green" />}
            </>
          )}
        </div>
      </div>

      {/* Lint badge sits between the content and the actions so a long
          preview can use the full middle column without the badge
          competing for primary text width. */}
      <LintBadge path={['blocks', index]} />

      {/* Actions */}
      {/* draggable={false} prevents drag from starting when clicking this area */}
      {/* `onPointerDown` stop is required — `@dnd-kit` listens on pointer
          events (separate from mouse events), so the existing
          `onMouseDown` stop alone wasn't preventing the SortableBlock
          drag listener from arming when an action button was clicked. */}
      <div
        className={styles.actions}
        draggable={false}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Secondary actions — hidden by default, revealed on row hover or
            keyboard focus via the parent container's data-attribute
            selectors. They sit *before* Edit so the always-visible Edit
            button stays anchored to the right edge of every row. Delete
            is rendered first (leftmost) so the destructive action stays
            furthest from Edit, reducing misclick risk. */}
        <div className={styles.secondaryActions} data-secondary-actions>
          <ConfirmDeleteButton
            onConfirm={onDelete}
            className={styles.deleteButton}
            tooltip="Delete block"
            ariaLabel="Delete"
            blockType={meta.name.toLowerCase()}
          />
          {isSection && onRecord && (
            <IconButton
              name={isRecording ? 'square-shape' : 'circle'}
              size="sm"
              aria-label={isRecording ? 'Stop recording' : 'Record into section'}
              onClick={handleRecord}
              className={isRecording ? styles.recordingButton : styles.recordButton}
              tooltip={isRecording ? 'Stop recording' : 'Record into section'}
            />
          )}
          {onPreview && (
            <IconButton
              name={isPreviewActive ? 'eye-slash' : 'eye'}
              size="sm"
              aria-label={isPreviewActive ? `Hide preview for ${meta.name} block` : `Preview ${meta.name} block`}
              onClick={(e) => {
                e.stopPropagation();
                onPreview();
              }}
              className={styles.actionButton}
              tooltip={isPreviewActive ? 'Hide preview' : 'Preview block'}
              data-testid="block-preview-button"
            />
          )}
          <IconButton
            name="copy"
            size="sm"
            aria-label="Duplicate block"
            onClick={handleDuplicate}
            className={styles.actionButton}
            tooltip="Duplicate block"
            data-testid={testIds.blockEditor.duplicateButton}
          />
          {/* Author note (unset case) — hover-revealed alongside the other
              secondary actions. When a note IS set, the same button is
              rendered outside this hover-gated container so it stays
              visible at rest as the "note exists" indicator. */}
          {onAuthorNoteChange && !currentAuthorNote && (
            <IconButton
              name="comment-alt"
              size="sm"
              aria-label="Add author note"
              onClick={(e) => {
                e.stopPropagation();
                setNoteModalOpen(true);
              }}
              className={styles.actionButton}
              tooltip="Add author note"
              data-testid="pathfinder-block-editor-author-note-button"
            />
          )}
        </div>
        {/* Author note (set case) — always-visible because it doubles as
            the indicator that a note exists; tooltip carries the note
            text so authors can peek without opening the modal. */}
        {onAuthorNoteChange && currentAuthorNote && (
          <IconButton
            name="comment-alt"
            size="sm"
            aria-label={`Author note: ${currentAuthorNote}`}
            onClick={(e) => {
              e.stopPropagation();
              setNoteModalOpen(true);
            }}
            className={styles.actionButton}
            tooltip={currentAuthorNote}
            data-testid="pathfinder-block-editor-author-note-button"
          />
        )}
        {/* Edit is the primary action — always visible, right-anchored. */}
        <IconButton
          name="edit"
          size="sm"
          aria-label="Edit block"
          onClick={handleEdit}
          className={styles.editButton}
          tooltip="Edit block"
          data-testid={testIds.blockEditor.editButton}
        />
      </div>

      {/* Collapse toggle for sections/conditionals */}
      {isCollapsible && (
        <IconButton
          name="angle-down"
          size="md"
          className={`${styles.collapseButton} ${isCollapsed ? styles.collapseButtonRotated : ''}`}
          onClick={handleToggleCollapse}
          tooltip={isCollapsed ? `Expand (${childCount} ${childCount === 1 ? 'block' : 'blocks'})` : 'Collapse'}
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? 'Expand' : 'Collapse'}
        />
      )}

      {onAuthorNoteChange && (
        <AuthorNoteModal
          isOpen={isNoteModalOpen}
          initialNote={currentAuthorNote}
          onSave={onAuthorNoteChange}
          onClose={() => setNoteModalOpen(false)}
        />
      )}
    </div>
  );
}

// Add display name for debugging
BlockItem.displayName = 'BlockItem';
