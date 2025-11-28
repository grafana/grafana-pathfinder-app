/**
 * Block List
 *
 * Renders the list of blocks with insert zones between them.
 * Supports drag-and-drop nesting into section blocks.
 */

import React, { useCallback, useState } from 'react';
import { useStyles2, Badge, IconButton } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { getBlockListStyles } from './block-editor.styles';
import { BlockItem } from './BlockItem';
import { BlockPalette } from './BlockPalette';
import { BLOCK_TYPE_METADATA } from './constants';
import type { EditorBlock, BlockType, JsonBlock } from './types';
import { isSectionBlock as checkIsSectionBlock, type JsonSectionBlock } from '../../types/json-guide.types';

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
  }),
  dropZone: css({
    padding: theme.spacing(1.5),
    border: `2px dashed ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    backgroundColor: theme.colors.background.secondary,
    textAlign: 'center',
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    transition: 'all 0.2s ease',
    cursor: 'pointer',
    marginTop: theme.spacing(1),

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

export interface BlockListProps {
  /** List of blocks to render */
  blocks: EditorBlock[];
  /** Currently selected block ID */
  selectedBlockId: string | null;
  /** Called when a block is selected */
  onBlockSelect: (id: string | null) => void;
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
}

// Styles for nested block items - match root BlockItem styling
const getNestedBlockItemStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    alignItems: 'stretch',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
    backgroundColor: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    marginBottom: theme.spacing(1),
    cursor: 'grab',
    transition: 'all 0.15s ease',

    '&:hover': {
      borderColor: theme.colors.border.medium,
      boxShadow: theme.shadows.z1,
    },
  }),
  dragHandle: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    color: theme.colors.text.disabled,
    flexShrink: 0,
    cursor: 'grab',

    '&:hover': {
      color: theme.colors.text.secondary,
    },

    '&:active': {
      cursor: 'grabbing',
    },
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
  moveButton: css({
    opacity: 0.6,
    transition: 'all 0.15s ease',

    '&:hover': {
      opacity: 1,
    },

    '&:disabled': {
      opacity: 0.3,
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
  index,
  sectionId,
  totalBlocks,
  onEdit,
  onDelete,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragEnd,
}: {
  block: JsonBlock;
  index: number;
  sectionId: string;
  totalBlocks: number;
  onEdit?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
}) {
  const styles = useStyles2(getNestedBlockItemStyles);
  const meta = BLOCK_TYPE_METADATA[block.type as BlockType];

  const canMoveUp = index > 0;
  const canMoveDown = index < totalBlocks - 1;

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

  return (
    <div
      className={styles.container}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      {/* Drag handle */}
      <div className={styles.dragHandle} title="Drag to reorder or move out of section">
        <span style={{ fontSize: '14px' }}>⋮⋮</span>
      </div>

      {/* Content - matches BlockItem layout */}
      <div className={styles.content}>
        <div className={styles.header}>
          <span className={styles.icon}>{meta?.icon}</span>
          <Badge text={meta?.name ?? block.type} color="blue" />
          {'action' in block && <Badge text={String(block.action)} color="purple" />}
        </div>
        {preview && (
          <div className={styles.preview} title={preview}>
            {preview}
          </div>
        )}
      </div>

      {/* Actions - grouped like BlockItem */}
      <div className={styles.actions}>
        {/* Move controls */}
        <div className={styles.actionGroup}>
          <IconButton
            name="arrow-up"
            size="md"
            aria-label="Move up"
            onClick={onMoveUp}
            disabled={!canMoveUp}
            className={styles.moveButton}
            tooltip="Move up"
          />
          <IconButton
            name="arrow-down"
            size="md"
            aria-label="Move down"
            onClick={onMoveDown}
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
          <IconButton
            name="trash-alt"
            size="md"
            aria-label="Delete"
            onClick={onDelete}
            className={styles.deleteButton}
            tooltip="Delete block"
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
  selectedBlockId,
  onBlockSelect,
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
}: BlockListProps) {
  const styles = useStyles2(getBlockListStyles);
  const nestedStyles = useStyles2(getNestedStyles);
  const [hoveredInsertIndex, setHoveredInsertIndex] = useState<number | null>(null);
  const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null);
  const [draggedBlockIndex, setDraggedBlockIndex] = useState<number | null>(null);
  const [draggedNestedBlock, setDraggedNestedBlock] = useState<{ sectionId: string; index: number } | null>(null);
  const [dragOverSectionId, setDragOverSectionId] = useState<string | null>(null);
  const [dragOverRootZone, setDragOverRootZone] = useState<number | null>(null);
  const [dragOverReorderZone, setDragOverReorderZone] = useState<number | null>(null);
  const [dragOverNestedZone, setDragOverNestedZone] = useState<{ sectionId: string; index: number } | null>(null);

  const handleBlockClick = useCallback(
    (id: string) => {
      onBlockSelect(id === selectedBlockId ? null : id);
    },
    [onBlockSelect, selectedBlockId]
  );

  const handleMoveUp = useCallback(
    (index: number) => {
      if (index > 0) {
        onBlockMove(index, index - 1);
      }
    },
    [onBlockMove]
  );

  const handleMoveDown = useCallback(
    (index: number) => {
      if (index < blocks.length - 1) {
        onBlockMove(index, index + 1);
      }
    },
    [onBlockMove, blocks.length]
  );

  // Drag start handler for root blocks
  const handleDragStart = useCallback((e: React.DragEvent, blockId: string, blockType: string, index: number) => {
    // Don't allow dragging sections
    if (blockType === 'section') {
      e.preventDefault();
      return;
    }
    setDraggedBlockId(blockId);
    setDraggedBlockIndex(index);
    e.dataTransfer.setData('text/plain', blockId);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  // Drag end handler
  const handleDragEnd = useCallback(() => {
    setDraggedBlockId(null);
    setDraggedBlockIndex(null);
    setDragOverSectionId(null);
    setDragOverReorderZone(null);
  }, []);

  // Drop handler for section drop zones
  const handleDropOnSection = useCallback(
    (sectionId: string) => {
      if (draggedBlockId && onNestBlock) {
        onNestBlock(draggedBlockId, sectionId);
      }
      setDraggedBlockId(null);
      setDragOverSectionId(null);
    },
    [draggedBlockId, onNestBlock]
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
    setDraggedNestedBlock({ sectionId, index: nestedIndex });
    e.dataTransfer.setData('text/plain', `nested:${sectionId}:${nestedIndex}`);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  // Handle nested block drag end
  const handleNestedDragEnd = useCallback(() => {
    setDraggedNestedBlock(null);
    setDragOverSectionId(null);
    setDragOverRootZone(null);
    setDragOverNestedZone(null);
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

  // Handle drop on root zone (unnesting)
  const handleDropOnRootZone = useCallback(
    (insertIndex: number) => {
      if (draggedNestedBlock && onUnnestBlock) {
        onUnnestBlock(`${draggedNestedBlock.sectionId}-${draggedNestedBlock.index}`, draggedNestedBlock.sectionId);
      }
      setDraggedNestedBlock(null);
      setDragOverRootZone(null);
    },
    [draggedNestedBlock, onUnnestBlock]
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

  return (
    <div className={styles.list}>
      {/* Insert zone at the top - serves as drop zone for reordering and unnesting */}
      <div
        className={`${styles.insertZone} ${hoveredInsertIndex === 0 ? styles.insertZoneActive : ''} ${dragOverRootZone === 0 || dragOverReorderZone === 0 ? styles.insertZoneActive : ''}`}
        onMouseEnter={() => setHoveredInsertIndex(0)}
        onMouseLeave={() => setHoveredInsertIndex(null)}
        onDragOver={(e) => {
          if (draggedNestedBlock) {
            handleDragOverRootZone(e, 0);
          } else if (draggedBlockId) {
            handleDragOverReorder(e, 0);
          }
        }}
        onDragLeave={() => {
          handleDragLeaveRootZone();
          handleDragLeaveReorder();
        }}
        onDrop={() => {
          if (draggedNestedBlock) {
            handleDropOnRootZone(0);
          } else if (draggedBlockId) {
            handleDropReorder(0);
          }
        }}
      >
        {draggedNestedBlock ? (
          <div style={{ padding: '8px 16px', textAlign: 'center', color: 'var(--text-secondary)' }}>
            📤 Drop here to move out of section
          </div>
        ) : draggedBlockId ? (
          <div style={{ padding: '8px 16px', textAlign: 'center', color: 'var(--text-secondary)', background: 'var(--background-secondary)', borderRadius: '4px' }}>
            📍 Drop here to move block
          </div>
        ) : (
          <BlockPalette onSelect={onInsertBlock} insertAtIndex={0} compact />
        )}
      </div>

      {blocks.map((block, index) => {
        const isSection = checkIsSectionBlock(block.block);
        const sectionBlocks: JsonBlock[] = isSection ? (block.block as JsonSectionBlock).blocks : [];

        return (
          <React.Fragment key={block.id}>
            <div
              draggable={block.block.type !== 'section'}
              onDragStart={(e) => handleDragStart(e, block.id, block.block.type, index)}
              onDragEnd={handleDragEnd}
              style={{ 
                cursor: block.block.type !== 'section' ? 'grab' : 'default',
                opacity: draggedBlockId === block.id ? 0.5 : 1,
              }}
            >
              <BlockItem
                block={block}
                index={index}
                totalBlocks={blocks.length}
                isSelected={block.id === selectedBlockId}
                onClick={() => handleBlockClick(block.id)}
                onEdit={() => onBlockEdit(block)}
                onDelete={() => onBlockDelete(block.id)}
                onMoveUp={() => handleMoveUp(index)}
                onMoveDown={() => handleMoveDown(index)}
                onDuplicate={() => onBlockDuplicate(block.id)}
              />
            </div>

            {/* Render nested blocks for sections */}
            {isSection && (
              <div className={nestedStyles.nestedContainer}>
                {sectionBlocks.length === 0 ? (
                  <div className={nestedStyles.emptySection}>
                    Drag blocks here or click + Add Block below
                  </div>
                ) : (
                  sectionBlocks.map((nestedBlock: JsonBlock, nestedIndex: number) => (
                    <React.Fragment key={`${block.id}-${nestedIndex}`}>
                      {/* Drop zone before each nested block for reordering */}
                      {draggedNestedBlock && draggedNestedBlock.sectionId === block.id && (
                        <div
                          style={{
                            height: dragOverNestedZone?.sectionId === block.id && dragOverNestedZone?.index === nestedIndex ? '40px' : '8px',
                            background: dragOverNestedZone?.sectionId === block.id && dragOverNestedZone?.index === nestedIndex ? 'var(--primary-transparent)' : 'transparent',
                            border: dragOverNestedZone?.sectionId === block.id && dragOverNestedZone?.index === nestedIndex ? '2px dashed var(--primary-border)' : 'none',
                            borderRadius: '4px',
                            marginBottom: '4px',
                            transition: 'all 0.15s ease',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--text-secondary)',
                            fontSize: '12px',
                          }}
                          onDragOver={(e) => handleDragOverNestedReorder(e, block.id, nestedIndex)}
                          onDragLeave={handleDragLeaveNestedReorder}
                          onDrop={() => handleDropNestedReorder(block.id, nestedIndex)}
                        >
                          {dragOverNestedZone?.sectionId === block.id && dragOverNestedZone?.index === nestedIndex && '📍 Drop here'}
                        </div>
                      )}
                      <div style={{ opacity: draggedNestedBlock?.sectionId === block.id && draggedNestedBlock?.index === nestedIndex ? 0.5 : 1 }}>
                        <NestedBlockItem
                          block={nestedBlock}
                          index={nestedIndex}
                          sectionId={block.id}
                          totalBlocks={sectionBlocks.length}
                          onEdit={() => onNestedBlockEdit?.(block.id, nestedIndex, nestedBlock)}
                          onDelete={() => onNestedBlockDelete?.(block.id, nestedIndex)}
                          onDuplicate={() => onNestedBlockDuplicate?.(block.id, nestedIndex)}
                          onMoveUp={() => onNestedBlockMove?.(block.id, nestedIndex, nestedIndex - 1)}
                          onMoveDown={() => onNestedBlockMove?.(block.id, nestedIndex, nestedIndex + 1)}
                          onDragStart={(e) => handleNestedDragStart(e, block.id, nestedIndex)}
                          onDragEnd={handleNestedDragEnd}
                        />
                      </div>
                    </React.Fragment>
                  ))
                )}

                {/* Drop zone at the end for reordering */}
                {draggedNestedBlock && draggedNestedBlock.sectionId === block.id && (
                  <div
                    style={{
                      height: dragOverNestedZone?.sectionId === block.id && dragOverNestedZone?.index === sectionBlocks.length ? '40px' : '8px',
                      background: dragOverNestedZone?.sectionId === block.id && dragOverNestedZone?.index === sectionBlocks.length ? 'var(--primary-transparent)' : 'transparent',
                      border: dragOverNestedZone?.sectionId === block.id && dragOverNestedZone?.index === sectionBlocks.length ? '2px dashed var(--primary-border)' : 'none',
                      borderRadius: '4px',
                      marginBottom: '8px',
                      transition: 'all 0.15s ease',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--text-secondary)',
                      fontSize: '12px',
                    }}
                    onDragOver={(e) => handleDragOverNestedReorder(e, block.id, sectionBlocks.length)}
                    onDragLeave={handleDragLeaveNestedReorder}
                    onDrop={() => handleDropNestedReorder(block.id, sectionBlocks.length)}
                  >
                    {dragOverNestedZone?.sectionId === block.id && dragOverNestedZone?.index === sectionBlocks.length && '📍 Drop here'}
                  </div>
                )}

                {/* Drop zone for section - accepts both root blocks and nested blocks from other sections */}
                <div
                  className={`${nestedStyles.dropZone} ${dragOverSectionId === block.id ? nestedStyles.dropZoneActive : ''}`}
                  onDragOver={(e) => handleDragOverSection(e, block.id)}
                  onDragLeave={handleDragLeaveSection}
                  onDrop={() => handleDropOnSection(block.id)}
                >
                  {draggedBlockId || draggedNestedBlock ? (
                    <span>📥 Drop here to add to section</span>
                  ) : (
                    <BlockPalette
                      onSelect={(type) => handleInsertInSection(type, block.id)}
                      compact
                    />
                  )}
                </div>
              </div>
            )}

            {/* Insert zone after each block - serves as drop zone for reordering and unnesting */}
            <div
              className={`${styles.insertZone} ${hoveredInsertIndex === index + 1 ? styles.insertZoneActive : ''} ${dragOverRootZone === index + 1 || dragOverReorderZone === index + 1 ? styles.insertZoneActive : ''}`}
              onMouseEnter={() => setHoveredInsertIndex(index + 1)}
              onMouseLeave={() => setHoveredInsertIndex(null)}
              onDragOver={(e) => {
                if (draggedNestedBlock) {
                  handleDragOverRootZone(e, index + 1);
                } else if (draggedBlockId) {
                  handleDragOverReorder(e, index + 1);
                }
              }}
              onDragLeave={() => {
                handleDragLeaveRootZone();
                handleDragLeaveReorder();
              }}
              onDrop={() => {
                if (draggedNestedBlock) {
                  handleDropOnRootZone(index + 1);
                } else if (draggedBlockId) {
                  handleDropReorder(index + 1);
                }
              }}
            >
              {draggedNestedBlock ? (
                <div style={{ padding: '8px 16px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                  📤 Drop here to move out of section
                </div>
              ) : draggedBlockId ? (
                <div style={{ padding: '8px 16px', textAlign: 'center', color: 'var(--text-secondary)', background: 'var(--background-secondary)', borderRadius: '4px' }}>
                  📍 Drop here to move block
                </div>
              ) : (
                <BlockPalette onSelect={onInsertBlock} insertAtIndex={index + 1} compact />
              )}
            </div>
          </React.Fragment>
        );
      })}

      {/* Drag overlay instructions */}
      {draggedBlockId && (
        <div
          style={{
            position: 'fixed',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '8px 16px',
            backgroundColor: 'var(--background-primary)',
            border: '1px solid var(--border-medium)',
            borderRadius: '4px',
            boxShadow: '0 4px 8px rgba(0,0,0,0.2)',
            zIndex: 1000,
            fontSize: '13px',
          }}
        >
          🎯 Drag to a section&apos;s drop zone to nest this block
        </div>
      )}
    </div>
  );
}

// Add display name for debugging
BlockList.displayName = 'BlockList';
