/**
 * Block List
 *
 * Renders the list of blocks with insert zones between them.
 * Supports drag-and-drop nesting into section blocks.
 */

import React, { useCallback, useState, useRef } from 'react';
import { useStyles2, Badge, IconButton, Checkbox } from '@grafana/ui';
import { ConfirmDeleteButton } from './ConfirmDeleteButton';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { getBlockListStyles } from './block-editor.styles';
import { BlockItem } from './BlockItem';
import { BlockPalette } from './BlockPalette';
import { BLOCK_TYPE_METADATA } from './constants';
import type { EditorBlock, BlockType, JsonBlock } from './types';
import {
  isSectionBlock as checkIsSectionBlock,
  isConditionalBlock as checkIsConditionalBlock,
  type JsonSectionBlock,
  type JsonConditionalBlock,
} from '../../types/json-guide.types';

// Drop indicator styles
const getDropIndicatorStyles = (theme: GrafanaTheme2) => ({
  container: css({
    position: 'relative',
    padding: theme.spacing(0.5),
    transition: 'all 0.15s ease',
  }),
  line: css({
    height: '4px',
    backgroundColor: theme.colors.primary.main,
    borderRadius: '2px',
    boxShadow: `0 0 8px ${theme.colors.primary.main}`,
    transition: 'all 0.15s ease',
  }),
  lineInactive: css({
    height: '2px',
    backgroundColor: theme.colors.border.medium,
    boxShadow: 'none',
  }),
  label: css({
    position: 'absolute',
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    padding: `${theme.spacing(0.5)} ${theme.spacing(1.5)}`,
    backgroundColor: theme.colors.primary.main,
    color: theme.colors.primary.contrastText,
    borderRadius: theme.shape.radius.pill,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    whiteSpace: 'nowrap',
    boxShadow: theme.shadows.z2,
    zIndex: 1,
  }),
});

/**
 * Visual drop indicator component - shows a blue line where the drop will happen
 */
function DropIndicator({ isActive, label }: { isActive: boolean; label: string }) {
  const styles = useStyles2(getDropIndicatorStyles);

  return (
    <div className={styles.container}>
      <div className={`${styles.line} ${!isActive ? styles.lineInactive : ''}`} />
      {isActive && <div className={styles.label}>{label}</div>}
    </div>
  );
}

// Additional styles for nested blocks
const getNestedStyles = (theme: GrafanaTheme2) => ({
  nestedContainer: css({
    marginLeft: theme.spacing(3),
    paddingLeft: theme.spacing(2),
    borderLeft: `3px solid ${theme.colors.primary.border}`,
    marginTop: theme.spacing(0.5),
    marginBottom: theme.spacing(0.5),
    backgroundColor: theme.isDark ? 'rgba(74, 144, 226, 0.03)' : 'rgba(74, 144, 226, 0.02)',
    borderRadius: `0 ${theme.shape.radius.default} ${theme.shape.radius.default} 0`,
    overflow: 'hidden',
    transition: 'max-height 0.2s ease-out, opacity 0.2s ease-out, padding 0.2s ease-out',
  }),
  nestedContainerCollapsed: css({
    maxHeight: '0 !important',
    padding: '0 !important',
    marginTop: '0 !important',
    marginBottom: '0 !important',
    opacity: 0,
    overflow: 'hidden',
  }),
  dropZone: css({
    minHeight: '56px',
    border: `2px dashed ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    backgroundColor: theme.colors.background.secondary,
    color: theme.colors.text.secondary,
    transition: 'all 0.2s ease',
    cursor: 'pointer',
    marginTop: theme.spacing(1),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',

    '&:hover': {
      borderColor: theme.colors.primary.border,
      backgroundColor: theme.colors.action.hover,
      color: theme.colors.text.primary,
    },
  }),
  dropZoneActive: css({
    borderColor: theme.colors.primary.main,
    backgroundColor: theme.colors.primary.transparent,
    color: theme.colors.primary.text,
    minHeight: '60px',
    border: `3px solid ${theme.colors.primary.main}`,
    boxShadow: `0 0 12px ${theme.colors.primary.transparent}`,
  }),
  nestedBlockItem: css({
    marginBottom: theme.spacing(1),
  }),
  emptySection: css({
    padding: theme.spacing(2),
    textAlign: 'center',
    color: theme.colors.text.secondary,
    fontStyle: 'italic',
  }),
  dragOverlay: css({
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }),
  dragInstructions: css({
    padding: theme.spacing(2, 4),
    backgroundColor: theme.colors.background.primary,
    borderRadius: theme.shape.radius.default,
    boxShadow: theme.shadows.z3,
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.text.primary,
  }),
});

// Styles for conditional block branches
const getConditionalStyles = (theme: GrafanaTheme2) => ({
  conditionalContainer: css({
    marginLeft: theme.spacing(3),
    marginTop: theme.spacing(0.5),
    marginBottom: theme.spacing(0.5),
    overflow: 'hidden',
    transition: 'max-height 0.2s ease-out, opacity 0.2s ease-out',
  }),
  conditionalContainerCollapsed: css({
    maxHeight: '0 !important',
    marginTop: '0 !important',
    marginBottom: '0 !important',
    opacity: 0,
    overflow: 'hidden',
  }),
  branchContainer: css({
    padding: theme.spacing(1),
    borderRadius: theme.shape.radius.default,
    marginBottom: theme.spacing(1),
  }),
  trueBranch: css({
    borderLeft: `3px solid ${theme.colors.success.border}`,
    backgroundColor: theme.isDark ? 'rgba(34, 166, 113, 0.05)' : 'rgba(34, 166, 113, 0.03)',
    paddingLeft: theme.spacing(2),
  }),
  falseBranch: css({
    borderLeft: `3px solid ${theme.colors.warning.border}`,
    backgroundColor: theme.isDark ? 'rgba(255, 152, 48, 0.05)' : 'rgba(255, 152, 48, 0.03)',
    paddingLeft: theme.spacing(2),
  }),
  branchHeader: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(1),
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  branchHeaderTrue: css({
    color: theme.colors.success.text,
  }),
  branchHeaderFalse: css({
    color: theme.colors.warning.text,
  }),
  branchIcon: css({
    fontSize: '14px',
  }),
  emptyBranch: css({
    padding: theme.spacing(1.5),
    textAlign: 'center',
    color: theme.colors.text.secondary,
    fontStyle: 'italic',
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  conditionsBadge: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing(1),
    fontFamily: theme.typography.fontFamilyMonospace,
    padding: theme.spacing(0.5, 1),
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    display: 'inline-block',
  }),
  recordButton: css({
    marginLeft: 'auto',
    color: theme.colors.text.secondary,
    '&:hover': {
      color: theme.colors.error.text,
    },
  }),
  recordingButton: css({
    marginLeft: 'auto',
    color: theme.colors.error.main,
    animation: 'pulse 1s ease-in-out infinite',
  }),
});

export interface BlockListProps {
  /** List of blocks to render */
  blocks: EditorBlock[];
  /** Called when a block edit is requested */
  onBlockEdit: (block: EditorBlock) => void;
  /** Called when a block delete is requested */
  onBlockDelete: (id: string) => void;
  /** Called to move a block */
  onBlockMove: (fromIndex: number, toIndex: number) => void;
  /** Called to duplicate a block */
  onBlockDuplicate: (id: string) => string | null;
  /** Called when a new block should be inserted */
  onInsertBlock: (type: BlockType, index?: number) => void;
  /** Called to nest a block into a section */
  onNestBlock?: (blockId: string, sectionId: string, insertIndex?: number) => void;
  /** Called to unnest a block from a section */
  onUnnestBlock?: (nestedBlockId: string, sectionId: string) => void;
  /** Called to insert a block directly into a section */
  onInsertBlockInSection?: (type: BlockType, sectionId: string, index?: number) => void;
  /** Called to edit a nested block */
  onNestedBlockEdit?: (sectionId: string, nestedIndex: number, block: JsonBlock) => void;
  /** Called to delete a nested block */
  onNestedBlockDelete?: (sectionId: string, nestedIndex: number) => void;
  /** Called to duplicate a nested block */
  onNestedBlockDuplicate?: (sectionId: string, nestedIndex: number) => void;
  /** Called to move a nested block within its section */
  onNestedBlockMove?: (sectionId: string, fromIndex: number, toIndex: number) => void;
  /** Called to start/stop recording into a section */
  onSectionRecord?: (sectionId: string) => void;
  /** ID of section currently being recorded into (if any) */
  recordingIntoSection?: string | null;
  /** Called to start/stop recording into a conditional branch */
  onConditionalBranchRecord?: (conditionalId: string, branch: 'whenTrue' | 'whenFalse') => void;
  /** Branch currently being recorded into (if any) */
  recordingIntoConditionalBranch?: { conditionalId: string; branch: 'whenTrue' | 'whenFalse' } | null;
  /** Whether selection mode is active */
  isSelectionMode?: boolean;
  /** IDs of currently selected blocks */
  selectedBlockIds?: Set<string>;
  /** Called to toggle selection of a block */
  onToggleBlockSelection?: (blockId: string) => void;
  // ---- Conditional block handlers ----
  /** Called to insert a block into a conditional branch */
  onInsertBlockInConditional?: (
    type: BlockType,
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    index?: number
  ) => void;
  /** Called to edit a block within a conditional branch */
  onConditionalBranchBlockEdit?: (
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    nestedIndex: number,
    block: JsonBlock
  ) => void;
  /** Called to delete a block from a conditional branch */
  onConditionalBranchBlockDelete?: (
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    nestedIndex: number
  ) => void;
  /** Called to duplicate a block within a conditional branch */
  onConditionalBranchBlockDuplicate?: (
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    nestedIndex: number
  ) => void;
  /** Called to move a block within a conditional branch */
  onConditionalBranchBlockMove?: (
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    fromIndex: number,
    toIndex: number
  ) => void;
  /** Called to nest a root block into a conditional branch */
  onNestBlockInConditional?: (
    blockId: string,
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    insertIndex?: number
  ) => void;
  /** Called to unnest a block from a conditional branch */
  onUnnestBlockFromConditional?: (
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    nestedIndex: number,
    insertAtRootIndex?: number
  ) => void;
  /** Called to move a block between conditional branches */
  onMoveBlockBetweenConditionalBranches?: (
    conditionalId: string,
    fromBranch: 'whenTrue' | 'whenFalse',
    fromIndex: number,
    toBranch: 'whenTrue' | 'whenFalse',
    toIndex?: number
  ) => void;
}

// Styles for nested block items - match root BlockItem styling
const getNestedBlockItemStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1.5),
    backgroundColor: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    transition: 'all 0.15s ease',
    minHeight: '52px',

    '&:hover': {
      borderColor: theme.colors.border.medium,
      boxShadow: theme.shadows.z1,
    },
  }),
  selectedContainer: css({
    borderColor: theme.colors.primary.border,
    backgroundColor: theme.colors.primary.transparent,
    boxShadow: `0 0 0 1px ${theme.colors.primary.border}`,
  }),
  selectionCheckbox: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    flexShrink: 0,
    cursor: 'pointer',
  }),
  dragHandle: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    color: theme.colors.text.disabled,
    flexShrink: 0,
    pointerEvents: 'none', // Don't block drag events - parent handles dragging
  }),
  content: css({
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
  }),
  header: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  icon: css({
    fontSize: '16px',
    flexShrink: 0,
  }),
  preview: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '100%',
    fontFamily: theme.typography.fontFamilyMonospace,
  }),
  actions: css({
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: theme.spacing(1.5),
    flexShrink: 0,
    padding: theme.spacing(0.5),
  }),
  actionGroup: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
  }),
  actionButton: css({
    opacity: 0.7,
    transition: 'all 0.15s ease',

    '&:hover': {
      opacity: 1,
      backgroundColor: theme.colors.action.hover,
    },
  }),
  editButton: css({
    color: theme.colors.primary.text,
    backgroundColor: theme.colors.primary.transparent,
    borderRadius: theme.shape.radius.default,
    transition: 'all 0.15s ease',

    '&:hover': {
      backgroundColor: theme.colors.primary.shade,
      color: theme.colors.primary.contrastText,
    },
  }),
  deleteButton: css({
    opacity: 0.7,
    color: theme.colors.error.text,
    transition: 'all 0.15s ease',

    '&:hover': {
      opacity: 1,
      backgroundColor: theme.colors.error.transparent,
    },
  }),
});

/**
 * Nested block item component - renders blocks inside sections
 * Uses same layout as root-level BlockItem for consistency
 */
function NestedBlockItem({
  block,
  onEdit,
  onDelete,
  onDuplicate,
  isSelectionMode = false,
  isSelected = false,
  onToggleSelect,
}: {
  block: JsonBlock;
  onEdit?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
}) {
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

  const containerClass = [styles.container, isSelected && styles.selectedContainer].filter(Boolean).join(' ');

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

/**
 * Block list component with insert zones
 */
export function BlockList({
  blocks,
  onBlockEdit,
  onBlockDelete,
  onBlockMove,
  onBlockDuplicate,
  onInsertBlock,
  onNestBlock,
  onUnnestBlock,
  onInsertBlockInSection,
  onNestedBlockEdit,
  onNestedBlockDelete,
  onNestedBlockDuplicate,
  onNestedBlockMove,
  onSectionRecord,
  recordingIntoSection,
  onConditionalBranchRecord,
  recordingIntoConditionalBranch,
  isSelectionMode = false,
  selectedBlockIds = new Set(),
  onToggleBlockSelection,
  onInsertBlockInConditional,
  onConditionalBranchBlockEdit,
  onConditionalBranchBlockDelete,
  onConditionalBranchBlockDuplicate,
  onConditionalBranchBlockMove,
  onNestBlockInConditional,
  onUnnestBlockFromConditional,
  onMoveBlockBetweenConditionalBranches,
}: BlockListProps) {
  const styles = useStyles2(getBlockListStyles);
  const nestedStyles = useStyles2(getNestedStyles);
  const conditionalStyles = useStyles2(getConditionalStyles);

  // Collapse state for sections and conditional blocks
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  // Toggle collapse state for a section or conditional block
  const toggleCollapse = useCallback((blockId: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) {
        next.delete(blockId);
      } else {
        next.add(blockId);
      }
      return next;
    });
  }, []);
  const [hoveredInsertIndex, setHoveredInsertIndex] = useState<number | null>(null);
  const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null);
  const [draggedBlockIndex, setDraggedBlockIndex] = useState<number | null>(null);
  const [draggedNestedBlock, setDraggedNestedBlock] = useState<{ sectionId: string; index: number } | null>(null);
  const [draggedConditionalBlock, setDraggedConditionalBlock] = useState<{
    conditionalId: string;
    branch: 'whenTrue' | 'whenFalse';
    index: number;
  } | null>(null);
  const [dragOverSectionId, setDragOverSectionId] = useState<string | null>(null);
  const [dragOverRootZone, setDragOverRootZone] = useState<number | null>(null);
  const [dragOverReorderZone, setDragOverReorderZone] = useState<number | null>(null);
  const [dragOverNestedZone, setDragOverNestedZone] = useState<{ sectionId: string; index: number } | null>(null);
  const [dragOverConditionalZone, setDragOverConditionalZone] = useState<{
    conditionalId: string;
    branch: 'whenTrue' | 'whenFalse';
    index: number;
  } | null>(null);

  // Use refs to track drag state without causing re-renders during drag start
  const dragStateRef = useRef<{
    rootBlockId: string | null;
    rootBlockIndex: number | null;
    nestedBlock: { sectionId: string; index: number } | null;
    conditionalBlock: { conditionalId: string; branch: 'whenTrue' | 'whenFalse'; index: number } | null;
  }>({ rootBlockId: null, rootBlockIndex: null, nestedBlock: null, conditionalBlock: null });

  // Drag start handler for root blocks (including sections)
  const handleDragStart = useCallback((e: React.DragEvent, blockId: string, blockType: string, index: number) => {
    // Set up drag data FIRST - before any state changes
    e.dataTransfer.setData('text/plain', `${blockType}:${blockId}`);
    e.dataTransfer.dropEffect = 'move';
    e.dataTransfer.effectAllowed = 'move';

    // Store in ref immediately (no re-render)
    dragStateRef.current = { rootBlockId: blockId, rootBlockIndex: index, nestedBlock: null, conditionalBlock: null };

    // Defer state update to next frame to avoid re-render during drag start
    requestAnimationFrame(() => {
      setDraggedBlockId(blockId);
      setDraggedBlockIndex(index);
    });
  }, []);

  // Drag end handler
  const handleDragEnd = useCallback(() => {
    dragStateRef.current = { rootBlockId: null, rootBlockIndex: null, nestedBlock: null, conditionalBlock: null };
    setDraggedBlockId(null);
    setDraggedBlockIndex(null);
    setDragOverSectionId(null);
    setDragOverReorderZone(null);
  }, []);

  // Drop handler for section drop zones - don't allow nesting sections
  const handleDropOnSection = useCallback(
    (sectionId: string) => {
      // Check if the dragged block is a section (can't nest sections)
      const draggedBlock = blocks.find((b) => b.id === draggedBlockId);
      if (draggedBlock?.block.type === 'section') {
        setDraggedBlockId(null);
        setDragOverSectionId(null);
        return;
      }

      if (draggedBlockId && onNestBlock) {
        onNestBlock(draggedBlockId, sectionId);
      }
      setDraggedBlockId(null);
      setDragOverSectionId(null);
    },
    [draggedBlockId, onNestBlock, blocks]
  );

  // Drag over handler
  const handleDragOverSection = useCallback((e: React.DragEvent, sectionId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverSectionId(sectionId);
  }, []);

  // Drag leave handler
  const handleDragLeaveSection = useCallback(() => {
    setDragOverSectionId(null);
  }, []);

  // Handle inserting block in section
  const handleInsertInSection = useCallback(
    (type: BlockType, sectionId: string) => {
      if (onInsertBlockInSection) {
        onInsertBlockInSection(type, sectionId);
      }
    },
    [onInsertBlockInSection]
  );

  // Handle nested block drag start
  const handleNestedDragStart = useCallback((e: React.DragEvent, sectionId: string, nestedIndex: number) => {
    // Set up drag data FIRST - before any state changes
    e.dataTransfer.setData('text/plain', `nested:${sectionId}:${nestedIndex}`);
    e.dataTransfer.dropEffect = 'move';
    e.dataTransfer.effectAllowed = 'move';

    // Store in ref immediately (no re-render)
    dragStateRef.current = {
      rootBlockId: null,
      rootBlockIndex: null,
      nestedBlock: { sectionId, index: nestedIndex },
      conditionalBlock: null,
    };

    // Defer state update to next frame to avoid re-render during drag start
    requestAnimationFrame(() => {
      setDraggedNestedBlock({ sectionId, index: nestedIndex });
    });
  }, []);

  // Handle nested block drag end
  const handleNestedDragEnd = useCallback(() => {
    dragStateRef.current = { rootBlockId: null, rootBlockIndex: null, nestedBlock: null, conditionalBlock: null };
    setDraggedNestedBlock(null);
    setDragOverSectionId(null);
    setDragOverRootZone(null);
    setDragOverNestedZone(null);
  }, []);

  // Handle conditional branch block drag start
  const handleConditionalDragStart = useCallback(
    (e: React.DragEvent, conditionalId: string, branch: 'whenTrue' | 'whenFalse', nestedIndex: number) => {
      e.dataTransfer.setData('text/plain', `conditional:${conditionalId}:${branch}:${nestedIndex}`);
      e.dataTransfer.dropEffect = 'move';
      e.dataTransfer.effectAllowed = 'move';

      // Store in ref immediately (no re-render)
      dragStateRef.current = {
        rootBlockId: null,
        rootBlockIndex: null,
        nestedBlock: null,
        conditionalBlock: { conditionalId, branch, index: nestedIndex },
      };

      // Defer state update to next frame to avoid re-render during drag start
      requestAnimationFrame(() => {
        setDraggedConditionalBlock({ conditionalId, branch, index: nestedIndex });
      });
    },
    []
  );

  // Handle conditional branch block drag end
  const handleConditionalDragEnd = useCallback(() => {
    dragStateRef.current = { rootBlockId: null, rootBlockIndex: null, nestedBlock: null, conditionalBlock: null };
    setDraggedConditionalBlock(null);
    setDragOverConditionalZone(null);
    setDragOverRootZone(null);
  }, []);

  // Handle drag over for reordering within a section
  const handleDragOverNestedReorder = useCallback((e: React.DragEvent, sectionId: string, targetIndex: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverNestedZone({ sectionId, index: targetIndex });
  }, []);

  // Handle drag leave for nested reordering
  const handleDragLeaveNestedReorder = useCallback(() => {
    setDragOverNestedZone(null);
  }, []);

  // Handle drop for reordering within a section
  const handleDropNestedReorder = useCallback(
    (sectionId: string, targetIndex: number) => {
      if (
        draggedNestedBlock &&
        draggedNestedBlock.sectionId === sectionId &&
        draggedNestedBlock.index !== targetIndex &&
        onNestedBlockMove
      ) {
        // Adjust target index if dropping after the dragged item
        const adjustedTarget = targetIndex > draggedNestedBlock.index ? targetIndex - 1 : targetIndex;
        onNestedBlockMove(sectionId, draggedNestedBlock.index, adjustedTarget);
      }
      setDraggedNestedBlock(null);
      setDragOverNestedZone(null);
    },
    [draggedNestedBlock, onNestedBlockMove]
  );

  // Handle drop on root zone (unnesting from section or conditional)
  const handleDropOnRootZone = useCallback(
    (insertIndex: number) => {
      if (draggedNestedBlock && onUnnestBlock) {
        onUnnestBlock(`${draggedNestedBlock.sectionId}-${draggedNestedBlock.index}`, draggedNestedBlock.sectionId);
      } else if (draggedConditionalBlock && onUnnestBlockFromConditional) {
        onUnnestBlockFromConditional(
          draggedConditionalBlock.conditionalId,
          draggedConditionalBlock.branch,
          draggedConditionalBlock.index,
          insertIndex
        );
      }
      setDraggedNestedBlock(null);
      setDraggedConditionalBlock(null);
      setDragOverRootZone(null);
    },
    [draggedNestedBlock, draggedConditionalBlock, onUnnestBlock, onUnnestBlockFromConditional]
  );

  // Handle drag over root zone
  const handleDragOverRootZone = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverRootZone(index);
  }, []);

  // Handle drag leave root zone
  const handleDragLeaveRootZone = useCallback(() => {
    setDragOverRootZone(null);
  }, []);

  // Handle drag over for reordering root blocks
  const handleDragOverReorder = useCallback((e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverReorderZone(targetIndex);
  }, []);

  // Handle drag leave for reordering
  const handleDragLeaveReorder = useCallback(() => {
    setDragOverReorderZone(null);
  }, []);

  // Handle drop for reordering root blocks
  const handleDropReorder = useCallback(
    (targetIndex: number) => {
      if (draggedBlockId && draggedBlockIndex !== null && draggedBlockIndex !== targetIndex) {
        // Adjust target index if dropping after the dragged item
        const adjustedTarget = targetIndex > draggedBlockIndex ? targetIndex - 1 : targetIndex;
        onBlockMove(draggedBlockIndex, adjustedTarget);
      }
      setDraggedBlockId(null);
      setDraggedBlockIndex(null);
      setDragOverReorderZone(null);
    },
    [draggedBlockId, draggedBlockIndex, onBlockMove]
  );

  // Check if any drag operation is active
  const isDragging = draggedBlockId !== null || draggedNestedBlock !== null || draggedConditionalBlock !== null;

  // Check if a root drop zone would be redundant (same position as dragged block)
  const isRootDropZoneRedundant = (zoneIndex: number) => {
    if (draggedBlockIndex === null) {
      return false;
    }
    // Zone at draggedBlockIndex or draggedBlockIndex + 1 would result in same position
    return zoneIndex === draggedBlockIndex || zoneIndex === draggedBlockIndex + 1;
  };

  return (
    <div className={styles.list}>
      {/* Insert zone at the top */}
      {/* When dragging: show drop indicator. When not dragging: show add block on hover (as overlay) */}
      {!(draggedBlockIndex === 0) &&
        (isDragging ? (
          <div
            style={{ padding: '4px 0' }}
            onDragOver={(e) => {
              e.preventDefault();
              if (draggedNestedBlock || draggedConditionalBlock) {
                handleDragOverRootZone(e, 0);
              } else if (draggedBlockId) {
                handleDragOverReorder(e, 0);
              }
            }}
            onDragLeave={() => {
              handleDragLeaveRootZone();
              handleDragLeaveReorder();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (draggedNestedBlock || draggedConditionalBlock) {
                handleDropOnRootZone(0);
              } else if (draggedBlockId) {
                handleDropReorder(0);
              }
            }}
          >
            <DropIndicator
              isActive={dragOverRootZone === 0 || dragOverReorderZone === 0}
              label={draggedNestedBlock || draggedConditionalBlock ? '📤 Move out' : '📍 Move here'}
            />
          </div>
        ) : (
          <div
            className={styles.insertZone}
            onMouseEnter={() => setHoveredInsertIndex(0)}
            onMouseLeave={() => setHoveredInsertIndex(null)}
          >
            <div
              className={`${styles.insertZoneButton} ${hoveredInsertIndex === 0 ? styles.insertZoneButtonVisible : ''}`}
            >
              <BlockPalette onSelect={onInsertBlock} insertAtIndex={0} compact />
            </div>
          </div>
        ))}

      {blocks.map((block, index) => {
        const isSection = checkIsSectionBlock(block.block);
        const isConditional = checkIsConditionalBlock(block.block);
        const sectionBlocks: JsonBlock[] = isSection ? (block.block as JsonSectionBlock).blocks : [];
        const conditionalChildCount = isConditional
          ? (block.block as JsonConditionalBlock).whenTrue.length + (block.block as JsonConditionalBlock).whenFalse.length
          : 0;

        return (
          <React.Fragment key={block.id}>
            <div
              draggable
              onDragStart={(e) => handleDragStart(e, block.id, block.block.type, index)}
              onDragEnd={handleDragEnd}
              style={{ cursor: 'grab' }}
            >
              <BlockItem
                block={block}
                index={index}
                totalBlocks={blocks.length}
                onEdit={() => onBlockEdit(block)}
                onDelete={() => onBlockDelete(block.id)}
                onDuplicate={() => onBlockDuplicate(block.id)}
                onRecord={isSection && onSectionRecord ? () => onSectionRecord(block.id) : undefined}
                isRecording={isSection && recordingIntoSection === block.id}
                isSelectionMode={isSelectionMode}
                isSelected={selectedBlockIds.has(block.id)}
                onToggleSelect={onToggleBlockSelection ? () => onToggleBlockSelection(block.id) : undefined}
                isCollapsible={isSection || isConditional}
                isCollapsed={collapsedSections.has(block.id)}
                onToggleCollapse={() => toggleCollapse(block.id)}
                childCount={isSection ? sectionBlocks.length : conditionalChildCount}
              />
            </div>

            {/* Render conditional block branches */}
            {checkIsConditionalBlock(block.block) && (
              <>
                {/* Conditional container - hidden when collapsed */}
                <div
                  className={`${conditionalStyles.conditionalContainer} ${collapsedSections.has(block.id) ? conditionalStyles.conditionalContainerCollapsed : ''}`}
                >
                  {/* Conditions badge */}
                  <div className={conditionalStyles.conditionsBadge}>
                    Conditions: {(block.block as JsonConditionalBlock).conditions.join(', ')}
                  </div>

                  {/* True branch - when conditions pass */}
                <div className={`${conditionalStyles.branchContainer} ${conditionalStyles.trueBranch}`}>
                  <div className={`${conditionalStyles.branchHeader} ${conditionalStyles.branchHeaderTrue}`}>
                    <span className={conditionalStyles.branchIcon}>✓</span>
                    <span>When conditions pass</span>
                    {onConditionalBranchRecord && (
                      <IconButton
                        name={
                          recordingIntoConditionalBranch?.conditionalId === block.id &&
                          recordingIntoConditionalBranch?.branch === 'whenTrue'
                            ? 'square-shape'
                            : 'circle'
                        }
                        size="sm"
                        aria-label={
                          recordingIntoConditionalBranch?.conditionalId === block.id &&
                          recordingIntoConditionalBranch?.branch === 'whenTrue'
                            ? 'Stop recording'
                            : 'Record into branch'
                        }
                        onClick={() => onConditionalBranchRecord(block.id, 'whenTrue')}
                        className={
                          recordingIntoConditionalBranch?.conditionalId === block.id &&
                          recordingIntoConditionalBranch?.branch === 'whenTrue'
                            ? conditionalStyles.recordingButton
                            : conditionalStyles.recordButton
                        }
                        tooltip={
                          recordingIntoConditionalBranch?.conditionalId === block.id &&
                          recordingIntoConditionalBranch?.branch === 'whenTrue'
                            ? 'Stop recording'
                            : 'Record into branch'
                        }
                      />
                    )}
                  </div>
                  {(block.block as JsonConditionalBlock).whenTrue.length === 0 ? (
                    <div className={conditionalStyles.emptyBranch}>Drag blocks here or click + Add block below</div>
                  ) : (
                    (block.block as JsonConditionalBlock).whenTrue.map(
                      (nestedBlock: JsonBlock, nestedIndex: number) => {
                        const isDropZoneActive =
                          dragOverConditionalZone?.conditionalId === block.id &&
                          dragOverConditionalZone?.branch === 'whenTrue' &&
                          dragOverConditionalZone?.index === nestedIndex;
                        const isRedundantDropZone =
                          draggedConditionalBlock?.conditionalId === block.id &&
                          draggedConditionalBlock?.branch === 'whenTrue' &&
                          (nestedIndex === draggedConditionalBlock.index ||
                            nestedIndex === draggedConditionalBlock.index + 1);

                        return (
                          <React.Fragment key={`${block.id}-true-${nestedIndex}`}>
                            {/* Drop zone before each nested block */}
                            {isDragging && !isRedundantDropZone && (
                              <div
                                style={{ padding: '4px 0', marginBottom: '4px' }}
                                onDragOver={(e) => {
                                  e.preventDefault();
                                  // Accept drags from same conditional (either branch) or root blocks
                                  if (draggedConditionalBlock?.conditionalId === block.id) {
                                    setDragOverConditionalZone({
                                      conditionalId: block.id,
                                      branch: 'whenTrue',
                                      index: nestedIndex,
                                    });
                                  } else if (draggedBlockId) {
                                    const draggedBlock = blocks.find((b) => b.id === draggedBlockId);
                                    if (
                                      draggedBlock?.block.type !== 'section' &&
                                      draggedBlock?.block.type !== 'conditional'
                                    ) {
                                      setDragOverConditionalZone({
                                        conditionalId: block.id,
                                        branch: 'whenTrue',
                                        index: nestedIndex,
                                      });
                                    }
                                  }
                                }}
                                onDragLeave={() => setDragOverConditionalZone(null)}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  if (draggedConditionalBlock?.conditionalId === block.id) {
                                    if (draggedConditionalBlock.branch === 'whenTrue' && onConditionalBranchBlockMove) {
                                      // Same branch move
                                      const adjustedTarget =
                                        nestedIndex > draggedConditionalBlock.index ? nestedIndex - 1 : nestedIndex;
                                      onConditionalBranchBlockMove(
                                        block.id,
                                        'whenTrue',
                                        draggedConditionalBlock.index,
                                        adjustedTarget
                                      );
                                    } else if (
                                      draggedConditionalBlock.branch === 'whenFalse' &&
                                      onMoveBlockBetweenConditionalBranches
                                    ) {
                                      // Cross-branch move from whenFalse to whenTrue
                                      onMoveBlockBetweenConditionalBranches(
                                        block.id,
                                        'whenFalse',
                                        draggedConditionalBlock.index,
                                        'whenTrue',
                                        nestedIndex
                                      );
                                    }
                                  } else if (draggedBlockId && onNestBlockInConditional) {
                                    const draggedBlock = blocks.find((b) => b.id === draggedBlockId);
                                    if (
                                      draggedBlock?.block.type !== 'section' &&
                                      draggedBlock?.block.type !== 'conditional'
                                    ) {
                                      onNestBlockInConditional(draggedBlockId, block.id, 'whenTrue', nestedIndex);
                                    }
                                  }
                                  setDraggedBlockId(null);
                                  setDraggedBlockIndex(null);
                                  setDraggedConditionalBlock(null);
                                  setDragOverConditionalZone(null);
                                }}
                              >
                                <DropIndicator isActive={isDropZoneActive} label="📍 Move here" />
                              </div>
                            )}
                            <div
                              draggable
                              onDragStart={(e) => handleConditionalDragStart(e, block.id, 'whenTrue', nestedIndex)}
                              onDragEnd={handleConditionalDragEnd}
                              style={{ cursor: 'grab', marginBottom: '8px' }}
                            >
                              <NestedBlockItem
                                block={nestedBlock}
                                onEdit={() =>
                                  onConditionalBranchBlockEdit?.(block.id, 'whenTrue', nestedIndex, nestedBlock)
                                }
                                onDelete={() => onConditionalBranchBlockDelete?.(block.id, 'whenTrue', nestedIndex)}
                                onDuplicate={() =>
                                  onConditionalBranchBlockDuplicate?.(block.id, 'whenTrue', nestedIndex)
                                }
                                isSelectionMode={isSelectionMode}
                                isSelected={selectedBlockIds.has(`${block.id}-true-${nestedIndex}`)}
                                onToggleSelect={
                                  onToggleBlockSelection
                                    ? () => onToggleBlockSelection(`${block.id}-true-${nestedIndex}`)
                                    : undefined
                                }
                              />
                            </div>
                          </React.Fragment>
                        );
                      }
                    )
                  )}
                  {/* Drop indicator at end of branch - show for any draggable block except if it's already last in this branch */}
                  {isDragging &&
                    !(
                      draggedConditionalBlock?.conditionalId === block.id &&
                      draggedConditionalBlock?.branch === 'whenTrue' &&
                      draggedConditionalBlock?.index === (block.block as JsonConditionalBlock).whenTrue.length - 1
                    ) && (
                      <div
                        style={{ padding: '4px 0', marginTop: '8px' }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          // Accept any valid drag
                          if (draggedConditionalBlock?.conditionalId === block.id || draggedBlockId) {
                            const draggedBlock = draggedBlockId ? blocks.find((b) => b.id === draggedBlockId) : null;
                            if (
                              !draggedBlock ||
                              (draggedBlock.block.type !== 'section' && draggedBlock.block.type !== 'conditional')
                            ) {
                              setDragOverConditionalZone({
                                conditionalId: block.id,
                                branch: 'whenTrue',
                                index: (block.block as JsonConditionalBlock).whenTrue.length,
                              });
                            }
                          }
                        }}
                        onDragLeave={() => setDragOverConditionalZone(null)}
                        onDrop={(e) => {
                          e.preventDefault();
                          const branchLen = (block.block as JsonConditionalBlock).whenTrue.length;
                          if (draggedConditionalBlock?.conditionalId === block.id) {
                            if (draggedConditionalBlock.branch === 'whenTrue' && onConditionalBranchBlockMove) {
                              onConditionalBranchBlockMove(
                                block.id,
                                'whenTrue',
                                draggedConditionalBlock.index,
                                branchLen
                              );
                            } else if (
                              draggedConditionalBlock.branch === 'whenFalse' &&
                              onMoveBlockBetweenConditionalBranches
                            ) {
                              onMoveBlockBetweenConditionalBranches(
                                block.id,
                                'whenFalse',
                                draggedConditionalBlock.index,
                                'whenTrue',
                                branchLen
                              );
                            }
                          } else if (draggedBlockId && onNestBlockInConditional) {
                            const draggedBlock = blocks.find((b) => b.id === draggedBlockId);
                            if (draggedBlock?.block.type !== 'section' && draggedBlock?.block.type !== 'conditional') {
                              onNestBlockInConditional(draggedBlockId, block.id, 'whenTrue', branchLen);
                            }
                          }
                          setDraggedBlockId(null);
                          setDraggedBlockIndex(null);
                          setDraggedConditionalBlock(null);
                          setDragOverConditionalZone(null);
                        }}
                      >
                        <DropIndicator
                          isActive={
                            dragOverConditionalZone?.conditionalId === block.id &&
                            dragOverConditionalZone?.branch === 'whenTrue' &&
                            dragOverConditionalZone?.index === (block.block as JsonConditionalBlock).whenTrue.length
                          }
                          label="📍 Move here"
                        />
                      </div>
                    )}
                  {/* Add block palette when not dragging */}
                  {!isDragging && (
                    <div className={nestedStyles.dropZone} style={{ marginTop: '8px' }}>
                      <BlockPalette
                        onSelect={(type) => onInsertBlockInConditional?.(type, block.id, 'whenTrue')}
                        excludeTypes={['section', 'conditional']}
                        embedded
                      />
                    </div>
                  )}
                </div>

                {/* False branch - when conditions fail */}
                <div className={`${conditionalStyles.branchContainer} ${conditionalStyles.falseBranch}`}>
                  <div className={`${conditionalStyles.branchHeader} ${conditionalStyles.branchHeaderFalse}`}>
                    <span className={conditionalStyles.branchIcon}>✗</span>
                    <span>When conditions fail</span>
                    {onConditionalBranchRecord && (
                      <IconButton
                        name={
                          recordingIntoConditionalBranch?.conditionalId === block.id &&
                          recordingIntoConditionalBranch?.branch === 'whenFalse'
                            ? 'square-shape'
                            : 'circle'
                        }
                        size="sm"
                        aria-label={
                          recordingIntoConditionalBranch?.conditionalId === block.id &&
                          recordingIntoConditionalBranch?.branch === 'whenFalse'
                            ? 'Stop recording'
                            : 'Record into branch'
                        }
                        onClick={() => onConditionalBranchRecord(block.id, 'whenFalse')}
                        className={
                          recordingIntoConditionalBranch?.conditionalId === block.id &&
                          recordingIntoConditionalBranch?.branch === 'whenFalse'
                            ? conditionalStyles.recordingButton
                            : conditionalStyles.recordButton
                        }
                        tooltip={
                          recordingIntoConditionalBranch?.conditionalId === block.id &&
                          recordingIntoConditionalBranch?.branch === 'whenFalse'
                            ? 'Stop recording'
                            : 'Record into branch'
                        }
                      />
                    )}
                  </div>
                  {(block.block as JsonConditionalBlock).whenFalse.length === 0 ? (
                    <div className={conditionalStyles.emptyBranch}>Drag blocks here or click + Add block below</div>
                  ) : (
                    (block.block as JsonConditionalBlock).whenFalse.map(
                      (nestedBlock: JsonBlock, nestedIndex: number) => {
                        const isDropZoneActive =
                          dragOverConditionalZone?.conditionalId === block.id &&
                          dragOverConditionalZone?.branch === 'whenFalse' &&
                          dragOverConditionalZone?.index === nestedIndex;
                        const isRedundantDropZone =
                          draggedConditionalBlock?.conditionalId === block.id &&
                          draggedConditionalBlock?.branch === 'whenFalse' &&
                          (nestedIndex === draggedConditionalBlock.index ||
                            nestedIndex === draggedConditionalBlock.index + 1);

                        return (
                          <React.Fragment key={`${block.id}-false-${nestedIndex}`}>
                            {/* Drop zone before each nested block */}
                            {isDragging && !isRedundantDropZone && (
                              <div
                                style={{ padding: '4px 0', marginBottom: '4px' }}
                                onDragOver={(e) => {
                                  e.preventDefault();
                                  // Accept drags from same conditional (either branch) or root blocks
                                  if (draggedConditionalBlock?.conditionalId === block.id) {
                                    setDragOverConditionalZone({
                                      conditionalId: block.id,
                                      branch: 'whenFalse',
                                      index: nestedIndex,
                                    });
                                  } else if (draggedBlockId) {
                                    const draggedBlock = blocks.find((b) => b.id === draggedBlockId);
                                    if (
                                      draggedBlock?.block.type !== 'section' &&
                                      draggedBlock?.block.type !== 'conditional'
                                    ) {
                                      setDragOverConditionalZone({
                                        conditionalId: block.id,
                                        branch: 'whenFalse',
                                        index: nestedIndex,
                                      });
                                    }
                                  }
                                }}
                                onDragLeave={() => setDragOverConditionalZone(null)}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  if (draggedConditionalBlock?.conditionalId === block.id) {
                                    if (
                                      draggedConditionalBlock.branch === 'whenFalse' &&
                                      onConditionalBranchBlockMove
                                    ) {
                                      // Same branch move
                                      const adjustedTarget =
                                        nestedIndex > draggedConditionalBlock.index ? nestedIndex - 1 : nestedIndex;
                                      onConditionalBranchBlockMove(
                                        block.id,
                                        'whenFalse',
                                        draggedConditionalBlock.index,
                                        adjustedTarget
                                      );
                                    } else if (
                                      draggedConditionalBlock.branch === 'whenTrue' &&
                                      onMoveBlockBetweenConditionalBranches
                                    ) {
                                      // Cross-branch move from whenTrue to whenFalse
                                      onMoveBlockBetweenConditionalBranches(
                                        block.id,
                                        'whenTrue',
                                        draggedConditionalBlock.index,
                                        'whenFalse',
                                        nestedIndex
                                      );
                                    }
                                  } else if (draggedBlockId && onNestBlockInConditional) {
                                    const draggedBlock = blocks.find((b) => b.id === draggedBlockId);
                                    if (
                                      draggedBlock?.block.type !== 'section' &&
                                      draggedBlock?.block.type !== 'conditional'
                                    ) {
                                      onNestBlockInConditional(draggedBlockId, block.id, 'whenFalse', nestedIndex);
                                    }
                                  }
                                  setDraggedBlockId(null);
                                  setDraggedBlockIndex(null);
                                  setDraggedConditionalBlock(null);
                                  setDragOverConditionalZone(null);
                                }}
                              >
                                <DropIndicator isActive={isDropZoneActive} label="📍 Move here" />
                              </div>
                            )}
                            <div
                              draggable
                              onDragStart={(e) => handleConditionalDragStart(e, block.id, 'whenFalse', nestedIndex)}
                              onDragEnd={handleConditionalDragEnd}
                              style={{ cursor: 'grab', marginBottom: '8px' }}
                            >
                              <NestedBlockItem
                                block={nestedBlock}
                                onEdit={() =>
                                  onConditionalBranchBlockEdit?.(block.id, 'whenFalse', nestedIndex, nestedBlock)
                                }
                                onDelete={() => onConditionalBranchBlockDelete?.(block.id, 'whenFalse', nestedIndex)}
                                onDuplicate={() =>
                                  onConditionalBranchBlockDuplicate?.(block.id, 'whenFalse', nestedIndex)
                                }
                                isSelectionMode={isSelectionMode}
                                isSelected={selectedBlockIds.has(`${block.id}-false-${nestedIndex}`)}
                                onToggleSelect={
                                  onToggleBlockSelection
                                    ? () => onToggleBlockSelection(`${block.id}-false-${nestedIndex}`)
                                    : undefined
                                }
                              />
                            </div>
                          </React.Fragment>
                        );
                      }
                    )
                  )}
                  {/* Drop indicator at end of branch - show for any draggable block except if it's already last in this branch */}
                  {isDragging &&
                    !(
                      draggedConditionalBlock?.conditionalId === block.id &&
                      draggedConditionalBlock?.branch === 'whenFalse' &&
                      draggedConditionalBlock?.index === (block.block as JsonConditionalBlock).whenFalse.length - 1
                    ) && (
                      <div
                        style={{ padding: '4px 0', marginTop: '8px' }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          // Accept any valid drag
                          if (draggedConditionalBlock?.conditionalId === block.id || draggedBlockId) {
                            const draggedBlock = draggedBlockId ? blocks.find((b) => b.id === draggedBlockId) : null;
                            if (
                              !draggedBlock ||
                              (draggedBlock.block.type !== 'section' && draggedBlock.block.type !== 'conditional')
                            ) {
                              setDragOverConditionalZone({
                                conditionalId: block.id,
                                branch: 'whenFalse',
                                index: (block.block as JsonConditionalBlock).whenFalse.length,
                              });
                            }
                          }
                        }}
                        onDragLeave={() => setDragOverConditionalZone(null)}
                        onDrop={(e) => {
                          e.preventDefault();
                          const branchLen = (block.block as JsonConditionalBlock).whenFalse.length;
                          if (draggedConditionalBlock?.conditionalId === block.id) {
                            if (draggedConditionalBlock.branch === 'whenFalse' && onConditionalBranchBlockMove) {
                              onConditionalBranchBlockMove(
                                block.id,
                                'whenFalse',
                                draggedConditionalBlock.index,
                                branchLen
                              );
                            } else if (
                              draggedConditionalBlock.branch === 'whenTrue' &&
                              onMoveBlockBetweenConditionalBranches
                            ) {
                              onMoveBlockBetweenConditionalBranches(
                                block.id,
                                'whenTrue',
                                draggedConditionalBlock.index,
                                'whenFalse',
                                branchLen
                              );
                            }
                          } else if (draggedBlockId && onNestBlockInConditional) {
                            const draggedBlock = blocks.find((b) => b.id === draggedBlockId);
                            if (draggedBlock?.block.type !== 'section' && draggedBlock?.block.type !== 'conditional') {
                              onNestBlockInConditional(draggedBlockId, block.id, 'whenFalse', branchLen);
                            }
                          }
                          setDraggedBlockId(null);
                          setDraggedBlockIndex(null);
                          setDraggedConditionalBlock(null);
                          setDragOverConditionalZone(null);
                        }}
                      >
                        <DropIndicator
                          isActive={
                            dragOverConditionalZone?.conditionalId === block.id &&
                            dragOverConditionalZone?.branch === 'whenFalse' &&
                            dragOverConditionalZone?.index === (block.block as JsonConditionalBlock).whenFalse.length
                          }
                          label="📍 Move here"
                        />
                      </div>
                    )}
                  {/* Add block palette when not dragging */}
                  {!isDragging && (
                    <div className={nestedStyles.dropZone} style={{ marginTop: '8px' }}>
                      <BlockPalette
                        onSelect={(type) => onInsertBlockInConditional?.(type, block.id, 'whenFalse')}
                        excludeTypes={['section', 'conditional']}
                        embedded
                      />
                    </div>
                  )}
                </div>
              </div>
              </>
            )}

            {/* Render nested blocks for sections */}
            {isSection && (
              <>
                {/* Nested container - hidden when collapsed */}
                <div
                  className={`${nestedStyles.nestedContainer} ${collapsedSections.has(block.id) ? nestedStyles.nestedContainerCollapsed : ''}`}
                >
                  {sectionBlocks.length === 0 ? (
                    <div className={nestedStyles.emptySection}>Drag blocks here or click + Add Block below</div>
                  ) : (
                  sectionBlocks.map((nestedBlock: JsonBlock, nestedIndex: number) => {
                    const isDropZoneActive =
                      dragOverNestedZone?.sectionId === block.id && dragOverNestedZone?.index === nestedIndex;
                    // Don't show drop zone if it would result in same position (before dragged item or after it)
                    const isRedundantDropZone =
                      draggedNestedBlock?.sectionId === block.id &&
                      (nestedIndex === draggedNestedBlock.index || nestedIndex === draggedNestedBlock.index + 1);

                    return (
                      <React.Fragment key={`${block.id}-${nestedIndex}`}>
                        {/* Drop zone before each nested block - accepts both nested reordering and root blocks (but not sections) */}
                        {isDragging && !isRedundantDropZone && (
                          <div
                            style={{
                              padding: '4px 0',
                              marginBottom: '4px',
                            }}
                            onDragOver={(e) => {
                              e.preventDefault();
                              if (draggedNestedBlock) {
                                handleDragOverNestedReorder(e, block.id, nestedIndex);
                              } else if (draggedBlockId) {
                                // Check if dragged block is a section - don't allow nesting
                                const draggedBlock = blocks.find((b) => b.id === draggedBlockId);
                                if (draggedBlock?.block.type !== 'section') {
                                  setDragOverNestedZone({ sectionId: block.id, index: nestedIndex });
                                }
                              }
                            }}
                            onDragLeave={() => {
                              handleDragLeaveNestedReorder();
                              setDragOverNestedZone(null);
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              if (draggedNestedBlock) {
                                handleDropNestedReorder(block.id, nestedIndex);
                              } else if (draggedBlockId && onNestBlock) {
                                // Check if dragged block is a section - don't allow nesting
                                const draggedBlock = blocks.find((b) => b.id === draggedBlockId);
                                if (draggedBlock?.block.type === 'section') {
                                  return;
                                }
                                onNestBlock(draggedBlockId, block.id, nestedIndex);
                                setDraggedBlockId(null);
                                setDraggedBlockIndex(null);
                                setDragOverNestedZone(null);
                              }
                            }}
                          >
                            <DropIndicator isActive={isDropZoneActive} label="📍 Move here" />
                          </div>
                        )}
                        <div
                          draggable
                          onDragStart={(e) => handleNestedDragStart(e, block.id, nestedIndex)}
                          onDragEnd={handleNestedDragEnd}
                          style={{ cursor: 'grab', marginBottom: '8px' }}
                        >
                          <NestedBlockItem
                            block={nestedBlock}
                            onEdit={() => onNestedBlockEdit?.(block.id, nestedIndex, nestedBlock)}
                            onDelete={() => onNestedBlockDelete?.(block.id, nestedIndex)}
                            onDuplicate={() => onNestedBlockDuplicate?.(block.id, nestedIndex)}
                            isSelectionMode={isSelectionMode}
                            isSelected={selectedBlockIds.has(`${block.id}-nested-${nestedIndex}`)}
                            onToggleSelect={
                              onToggleBlockSelection
                                ? () => onToggleBlockSelection(`${block.id}-nested-${nestedIndex}`)
                                : undefined
                            }
                          />
                        </div>
                      </React.Fragment>
                    );
                  })
                )}

                {/* Drop zone at the end for reordering - hide if dragged item is last */}
                {draggedNestedBlock &&
                  draggedNestedBlock.sectionId === block.id &&
                  draggedNestedBlock.index !== sectionBlocks.length - 1 && (
                    <div
                      style={{
                        padding: '4px 0',
                        marginBottom: '8px',
                      }}
                      onDragOver={(e) => handleDragOverNestedReorder(e, block.id, sectionBlocks.length)}
                      onDragLeave={handleDragLeaveNestedReorder}
                      onDrop={(e) => {
                        e.preventDefault();
                        handleDropNestedReorder(block.id, sectionBlocks.length);
                      }}
                    >
                      <DropIndicator
                        isActive={
                          dragOverNestedZone?.sectionId === block.id &&
                          dragOverNestedZone?.index === sectionBlocks.length
                        }
                        label="📍 Move here"
                      />
                    </div>
                  )}

                {/* Drop zone for section - accepts both root blocks and nested blocks from other sections */}
                <div
                  className={`${nestedStyles.dropZone} ${dragOverSectionId === block.id ? nestedStyles.dropZoneActive : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    handleDragOverSection(e, block.id);
                  }}
                  onDragLeave={handleDragLeaveSection}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDropOnSection(block.id);
                  }}
                >
                  {isDragging ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px' }}>
                      {dragOverSectionId === block.id ? (
                        <>
                          <span style={{ fontSize: '20px' }}>📥</span>
                          <span style={{ fontWeight: 500 }}>Release to add to this section</span>
                        </>
                      ) : (
                        <>
                          <span style={{ fontSize: '16px' }}>📥</span>
                          <span>Drop here to add to section</span>
                        </>
                      )}
                    </div>
                  ) : (
                    <BlockPalette
                      onSelect={(type) => handleInsertInSection(type, block.id)}
                      excludeTypes={['section', 'conditional']}
                      embedded
                    />
                  )}
                </div>
              </div>
              </>
            )}

            {/* Insert zone after each block */}
            {/* When dragging: show drop indicator. When not dragging: show add block on hover (as overlay) */}
            {!isRootDropZoneRedundant(index + 1) &&
              (isDragging ? (
                <div
                  style={{ padding: '4px 0' }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (draggedNestedBlock || draggedConditionalBlock) {
                      handleDragOverRootZone(e, index + 1);
                    } else if (draggedBlockId) {
                      handleDragOverReorder(e, index + 1);
                    }
                  }}
                  onDragLeave={() => {
                    handleDragLeaveRootZone();
                    handleDragLeaveReorder();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (draggedNestedBlock || draggedConditionalBlock) {
                      handleDropOnRootZone(index + 1);
                    } else if (draggedBlockId) {
                      handleDropReorder(index + 1);
                    }
                  }}
                >
                  <DropIndicator
                    isActive={dragOverRootZone === index + 1 || dragOverReorderZone === index + 1}
                    label={draggedNestedBlock || draggedConditionalBlock ? '📤 Move out' : '📍 Move here'}
                  />
                </div>
              ) : (
                <div
                  className={styles.insertZone}
                  onMouseEnter={() => setHoveredInsertIndex(index + 1)}
                  onMouseLeave={() => setHoveredInsertIndex(null)}
                >
                  <div
                    className={`${styles.insertZoneButton} ${hoveredInsertIndex === index + 1 ? styles.insertZoneButtonVisible : ''}`}
                  >
                    <BlockPalette onSelect={onInsertBlock} insertAtIndex={index + 1} compact />
                  </div>
                </div>
              ))}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// Add display name for debugging
BlockList.displayName = 'BlockList';
