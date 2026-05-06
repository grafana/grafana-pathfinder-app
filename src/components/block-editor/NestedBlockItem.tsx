/**
 * Nested Block Item
 *
 * Renders blocks inside sections and conditional branches.
 * Uses same layout as root-level BlockItem for consistency.
 */

import React, { useCallback } from 'react';
import { useStyles2, Badge, IconButton, Checkbox } from '@grafana/ui';
import { ConfirmDeleteButton } from './ConfirmDeleteButton';
import { LintBadge } from './LintBadge';
import { getNestedBlockItemStyles } from './BlockList.styles';
import { BLOCK_TYPE_METADATA } from './constants';
import type { BlockType, JsonBlock } from './types';

export interface NestedBlockItemProps {
  block: JsonBlock;
  /** Position index within the container (0-based) */
  index?: number;
  /**
   * JSON path of this nested block in the guide, e.g.
   * `['blocks', 0, 'blocks', 1]` for the second child of the first
   * top-level section. Required for the per-block `<LintBadge>` to render.
   */
  path?: Array<string | number>;
  onEdit?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  /** Whether this block was just dropped (triggers highlight animation) */
  isJustDropped?: boolean;
  /** Whether this block was the last one modified (persistent highlight) */
  isLastModified?: boolean;
  /** Called to preview this block (typically via its parent section) */
  onPreview?: () => void;
  /** Whether this nested block preview is currently open */
  isPreviewActive?: boolean;
}

/**
 * Nested block item component - renders blocks inside sections
 * Uses same layout as root-level BlockItem for consistency
 */
export function NestedBlockItem({
  block,
  index,
  path,
  onEdit,
  onDelete,
  onDuplicate,
  isSelectionMode = false,
  isSelected = false,
  onToggleSelect,
  isJustDropped = false,
  isLastModified = false,
  onPreview,
  isPreviewActive = false,
}: NestedBlockItemProps) {
  const styles = useStyles2(getNestedBlockItemStyles);
  const meta = BLOCK_TYPE_METADATA[block.type as BlockType];

  // Interactive, multistep, and guided blocks can be selected for merging
  const isSelectable =
    isSelectionMode && (block.type === 'interactive' || block.type === 'multistep' || block.type === 'guided');

  // Get preview content - same logic as BlockItem
  const getPreview = (): string => {
    if ('content' in block && typeof block.content === 'string') {
      const firstLine = block.content.split('\n')[0] ?? '';
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
    isLastModified && !isJustDropped && styles.lastModifiedContainer,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={containerClass} data-block-card>
      {/* Selection checkbox — only for selectable block types
          (interactive / multistep / guided). Non-selectable blocks
          render an empty spacer for alignment. */}
      {isSelectionMode &&
        (isSelectable ? (
          <div
            className={styles.selectionCheckbox}
            onClick={handleCheckboxClick}
            title={isSelected ? 'Deselect' : 'Select'}
          >
            <Checkbox value={isSelected} onChange={onToggleSelect} />
          </div>
        ) : (
          <div className={styles.selectionCheckbox} aria-hidden="true" />
        ))}

      {/* Drag handle - visual indicator only (hidden in selection mode) */}
      {!isSelectionMode && (
        <div className={styles.dragHandle} data-drag-handle title="Drag to reorder or move out of section">
          <span style={{ fontSize: '14px', lineHeight: 1 }}>⋮</span>
        </div>
      )}

      {/* Content — single inline row mirroring BlockItem.
          - Sub-type purple badge dropped (action verb is already in
            preview text).
          - Preview is inline; sections render their authored title. */}
      <div className={styles.content}>
        <div className={styles.header}>
          {index !== undefined && <span className={styles.blockNumber}>{index + 1}</span>}
          <span className={styles.icon}>{meta?.icon}</span>
          <Badge text={meta?.name ?? block.type} color="blue" />
          {block.type === 'section' && 'title' in block && typeof block.title === 'string' && block.title ? (
            <span className={styles.sectionTitle} title={block.title}>
              {block.title}
            </span>
          ) : (
            preview && (
              <span className={styles.headlinePreview} title={preview}>
                {preview}
              </span>
            )
          )}
        </div>
      </div>

      {/* Lint badge between content and actions — see BlockItem for rationale. */}
      {path && <LintBadge path={path} />}

      {/* Actions */}
      {/* draggable={false} prevents drag from starting when clicking this area */}
      <div className={styles.actions} draggable={false} onMouseDown={(e) => e.stopPropagation()}>
        {/* Secondary actions — hidden by default, revealed on row hover
            or keyboard focus. Edit stays anchored to the right edge. */}
        <div className={styles.secondaryActions} data-secondary-actions>
          {onPreview && (
            <IconButton
              name={isPreviewActive ? 'eye-slash' : 'eye'}
              size="sm"
              aria-label={
                isPreviewActive
                  ? `Hide preview for ${meta?.name ?? block.type} block`
                  : `Preview ${meta?.name ?? block.type} block`
              }
              onClick={(e) => {
                e.stopPropagation();
                onPreview();
              }}
              className={styles.actionButton}
              tooltip={isPreviewActive ? 'Hide preview' : 'Preview block'}
              data-testid="nested-block-preview-button"
            />
          )}
          <IconButton
            name="copy"
            size="sm"
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
            blockType={meta?.name.toLowerCase() ?? block.type}
          />
        </div>
        {/* Edit is the primary action — always visible, right-anchored. */}
        <IconButton
          name="edit"
          size="sm"
          aria-label="Edit"
          onClick={onEdit}
          className={styles.editButton}
          tooltip="Edit block"
        />
      </div>
    </div>
  );
}

// Add display name for debugging
NestedBlockItem.displayName = 'NestedBlockItem';
