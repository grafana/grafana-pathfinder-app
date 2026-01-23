/**
 * Block List
 *
 * Renders the list of blocks with insert zones between them.
 * Supports drag-and-drop nesting into section blocks.
 */

import React, { useCallback, useState } from 'react';
import { useStyles2, IconButton } from '@grafana/ui';
import { getBlockListStyles } from './block-editor.styles';
import { getDropIndicatorStyles, getNestedStyles, getConditionalStyles } from './BlockList.styles';
import { BlockItem } from './BlockItem';
import { BlockPalette } from './BlockPalette';
import { NestedBlockItem } from './NestedBlockItem';
import { useBlockListDrag } from './hooks/useBlockListDrag';
import type { EditorBlock, BlockType, JsonBlock } from './types';
import {
  isSectionBlock as checkIsSectionBlock,
  isConditionalBlock as checkIsConditionalBlock,
  type JsonSectionBlock,
  type JsonConditionalBlock,
} from '../../types/json-guide.types';

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

  // Use the drag hook for all drag-and-drop state and handlers
  const drag = useBlockListDrag({
    blocks,
    onBlockMove,
    onNestBlock,
    onUnnestBlock,
    onNestedBlockMove,
    onNestBlockInConditional,
    onUnnestBlockFromConditional,
    onConditionalBranchBlockMove,
    onMoveBlockBetweenConditionalBranches,
  });

  // Handle inserting block in section
  const handleInsertInSection = useCallback(
    (type: BlockType, sectionId: string) => {
      if (onInsertBlockInSection) {
        onInsertBlockInSection(type, sectionId);
      }
    },
    [onInsertBlockInSection]
  );

  return (
    <div className={styles.list}>
      {/* Insert zone at the top */}
      {/* When dragging: show drop indicator. When not dragging: show add block on hover (as overlay) */}
      {!(drag.draggedBlockIndex === 0) &&
        (drag.isDragging ? (
          <div
            style={{ padding: '4px 0' }}
            onDragOver={(e) => {
              e.preventDefault();
              if (drag.draggedNestedBlock || drag.draggedConditionalBlock) {
                drag.handleDragOverRootZone(e, 0);
              } else if (drag.draggedBlockId) {
                drag.handleDragOverReorder(e, 0);
              }
            }}
            onDragLeave={() => {
              drag.handleDragLeaveRootZone();
              drag.handleDragLeaveReorder();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (drag.draggedNestedBlock || drag.draggedConditionalBlock) {
                drag.handleDropOnRootZone(0);
              } else if (drag.draggedBlockId) {
                drag.handleDropReorder(0);
              }
            }}
          >
            <DropIndicator
              isActive={drag.dragOverRootZone === 0 || drag.dragOverReorderZone === 0}
              label={drag.draggedNestedBlock || drag.draggedConditionalBlock ? '📤 Move out' : '📍 Move here'}
            />
          </div>
        ) : (
          <div
            className={styles.insertZone}
            onMouseEnter={() => drag.setHoveredInsertIndex(0)}
            onMouseLeave={() => drag.setHoveredInsertIndex(null)}
          >
            <div
              className={`${styles.insertZoneButton} ${drag.hoveredInsertIndex === 0 ? styles.insertZoneButtonVisible : ''}`}
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
          ? (block.block as JsonConditionalBlock).whenTrue.length +
            (block.block as JsonConditionalBlock).whenFalse.length
          : 0;

        return (
          <React.Fragment key={block.id}>
            <div
              draggable
              onDragStart={(e) => drag.handleDragStart(e, block.id, block.block.type, index)}
              onDragEnd={drag.handleDragEnd}
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
                            drag.dragOverConditionalZone?.conditionalId === block.id &&
                            drag.dragOverConditionalZone?.branch === 'whenTrue' &&
                            drag.dragOverConditionalZone?.index === nestedIndex;
                          const isRedundantDropZone =
                            drag.draggedConditionalBlock?.conditionalId === block.id &&
                            drag.draggedConditionalBlock?.branch === 'whenTrue' &&
                            (nestedIndex === drag.draggedConditionalBlock.index ||
                              nestedIndex === drag.draggedConditionalBlock.index + 1);

                          return (
                            <React.Fragment key={`${block.id}-true-${nestedIndex}`}>
                              {/* Drop zone before each nested block */}
                              {drag.isDragging && !isRedundantDropZone && (
                                <div
                                  style={{ padding: '4px 0', marginBottom: '4px' }}
                                  onDragOver={(e) => {
                                    e.preventDefault();
                                    // Accept drags from same conditional (either branch) or root blocks
                                    if (drag.draggedConditionalBlock?.conditionalId === block.id) {
                                      drag.setDragOverConditionalZone({
                                        conditionalId: block.id,
                                        branch: 'whenTrue',
                                        index: nestedIndex,
                                      });
                                    } else if (drag.draggedBlockId) {
                                      const draggedBlock = blocks.find((b) => b.id === drag.draggedBlockId);
                                      if (
                                        draggedBlock?.block.type !== 'section' &&
                                        draggedBlock?.block.type !== 'conditional'
                                      ) {
                                        drag.setDragOverConditionalZone({
                                          conditionalId: block.id,
                                          branch: 'whenTrue',
                                          index: nestedIndex,
                                        });
                                      }
                                    }
                                  }}
                                  onDragLeave={() => drag.setDragOverConditionalZone(null)}
                                  onDrop={(e) => {
                                    e.preventDefault();
                                    if (drag.draggedConditionalBlock?.conditionalId === block.id) {
                                      if (
                                        drag.draggedConditionalBlock.branch === 'whenTrue' &&
                                        onConditionalBranchBlockMove
                                      ) {
                                        // Same branch move
                                        const adjustedTarget =
                                          nestedIndex > drag.draggedConditionalBlock.index
                                            ? nestedIndex - 1
                                            : nestedIndex;
                                        onConditionalBranchBlockMove(
                                          block.id,
                                          'whenTrue',
                                          drag.draggedConditionalBlock.index,
                                          adjustedTarget
                                        );
                                      } else if (
                                        drag.draggedConditionalBlock.branch === 'whenFalse' &&
                                        onMoveBlockBetweenConditionalBranches
                                      ) {
                                        // Cross-branch move from whenFalse to whenTrue
                                        onMoveBlockBetweenConditionalBranches(
                                          block.id,
                                          'whenFalse',
                                          drag.draggedConditionalBlock.index,
                                          'whenTrue',
                                          nestedIndex
                                        );
                                      }
                                    } else if (drag.draggedBlockId && onNestBlockInConditional) {
                                      const draggedBlock = blocks.find((b) => b.id === drag.draggedBlockId);
                                      if (
                                        draggedBlock?.block.type !== 'section' &&
                                        draggedBlock?.block.type !== 'conditional'
                                      ) {
                                        onNestBlockInConditional(
                                          drag.draggedBlockId,
                                          block.id,
                                          'whenTrue',
                                          nestedIndex
                                        );
                                      }
                                    }
                                    drag.setDraggedBlockId(null);
                                    drag.setDraggedBlockIndex(null);
                                    drag.setDraggedConditionalBlock(null);
                                    drag.setDragOverConditionalZone(null);
                                  }}
                                >
                                  <DropIndicator isActive={isDropZoneActive} label="📍 Move here" />
                                </div>
                              )}
                              <div
                                draggable
                                onDragStart={(e) =>
                                  drag.handleConditionalDragStart(e, block.id, 'whenTrue', nestedIndex)
                                }
                                onDragEnd={drag.handleConditionalDragEnd}
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
                    {drag.isDragging &&
                      !(
                        drag.draggedConditionalBlock?.conditionalId === block.id &&
                        drag.draggedConditionalBlock?.branch === 'whenTrue' &&
                        drag.draggedConditionalBlock?.index ===
                          (block.block as JsonConditionalBlock).whenTrue.length - 1
                      ) && (
                        <div
                          style={{ padding: '4px 0', marginTop: '8px' }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            // Accept any valid drag
                            if (drag.draggedConditionalBlock?.conditionalId === block.id || drag.draggedBlockId) {
                              const draggedBlock = drag.draggedBlockId
                                ? blocks.find((b) => b.id === drag.draggedBlockId)
                                : null;
                              if (
                                !draggedBlock ||
                                (draggedBlock.block.type !== 'section' && draggedBlock.block.type !== 'conditional')
                              ) {
                                drag.setDragOverConditionalZone({
                                  conditionalId: block.id,
                                  branch: 'whenTrue',
                                  index: (block.block as JsonConditionalBlock).whenTrue.length,
                                });
                              }
                            }
                          }}
                          onDragLeave={() => drag.setDragOverConditionalZone(null)}
                          onDrop={(e) => {
                            e.preventDefault();
                            const branchLen = (block.block as JsonConditionalBlock).whenTrue.length;
                            if (drag.draggedConditionalBlock?.conditionalId === block.id) {
                              if (drag.draggedConditionalBlock.branch === 'whenTrue' && onConditionalBranchBlockMove) {
                                onConditionalBranchBlockMove(
                                  block.id,
                                  'whenTrue',
                                  drag.draggedConditionalBlock.index,
                                  branchLen
                                );
                              } else if (
                                drag.draggedConditionalBlock.branch === 'whenFalse' &&
                                onMoveBlockBetweenConditionalBranches
                              ) {
                                onMoveBlockBetweenConditionalBranches(
                                  block.id,
                                  'whenFalse',
                                  drag.draggedConditionalBlock.index,
                                  'whenTrue',
                                  branchLen
                                );
                              }
                            } else if (drag.draggedBlockId && onNestBlockInConditional) {
                              const draggedBlock = blocks.find((b) => b.id === drag.draggedBlockId);
                              if (
                                draggedBlock?.block.type !== 'section' &&
                                draggedBlock?.block.type !== 'conditional'
                              ) {
                                onNestBlockInConditional(drag.draggedBlockId, block.id, 'whenTrue', branchLen);
                              }
                            }
                            drag.setDraggedBlockId(null);
                            drag.setDraggedBlockIndex(null);
                            drag.setDraggedConditionalBlock(null);
                            drag.setDragOverConditionalZone(null);
                          }}
                        >
                          <DropIndicator
                            isActive={
                              drag.dragOverConditionalZone?.conditionalId === block.id &&
                              drag.dragOverConditionalZone?.branch === 'whenTrue' &&
                              drag.dragOverConditionalZone?.index ===
                                (block.block as JsonConditionalBlock).whenTrue.length
                            }
                            label="📍 Move here"
                          />
                        </div>
                      )}
                    {/* Add block palette when not dragging */}
                    {!drag.isDragging && (
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
                            drag.dragOverConditionalZone?.conditionalId === block.id &&
                            drag.dragOverConditionalZone?.branch === 'whenFalse' &&
                            drag.dragOverConditionalZone?.index === nestedIndex;
                          const isRedundantDropZone =
                            drag.draggedConditionalBlock?.conditionalId === block.id &&
                            drag.draggedConditionalBlock?.branch === 'whenFalse' &&
                            (nestedIndex === drag.draggedConditionalBlock.index ||
                              nestedIndex === drag.draggedConditionalBlock.index + 1);

                          return (
                            <React.Fragment key={`${block.id}-false-${nestedIndex}`}>
                              {/* Drop zone before each nested block */}
                              {drag.isDragging && !isRedundantDropZone && (
                                <div
                                  style={{ padding: '4px 0', marginBottom: '4px' }}
                                  onDragOver={(e) => {
                                    e.preventDefault();
                                    // Accept drags from same conditional (either branch) or root blocks
                                    if (drag.draggedConditionalBlock?.conditionalId === block.id) {
                                      drag.setDragOverConditionalZone({
                                        conditionalId: block.id,
                                        branch: 'whenFalse',
                                        index: nestedIndex,
                                      });
                                    } else if (drag.draggedBlockId) {
                                      const draggedBlock = blocks.find((b) => b.id === drag.draggedBlockId);
                                      if (
                                        draggedBlock?.block.type !== 'section' &&
                                        draggedBlock?.block.type !== 'conditional'
                                      ) {
                                        drag.setDragOverConditionalZone({
                                          conditionalId: block.id,
                                          branch: 'whenFalse',
                                          index: nestedIndex,
                                        });
                                      }
                                    }
                                  }}
                                  onDragLeave={() => drag.setDragOverConditionalZone(null)}
                                  onDrop={(e) => {
                                    e.preventDefault();
                                    if (drag.draggedConditionalBlock?.conditionalId === block.id) {
                                      if (
                                        drag.draggedConditionalBlock.branch === 'whenFalse' &&
                                        onConditionalBranchBlockMove
                                      ) {
                                        // Same branch move
                                        const adjustedTarget =
                                          nestedIndex > drag.draggedConditionalBlock.index
                                            ? nestedIndex - 1
                                            : nestedIndex;
                                        onConditionalBranchBlockMove(
                                          block.id,
                                          'whenFalse',
                                          drag.draggedConditionalBlock.index,
                                          adjustedTarget
                                        );
                                      } else if (
                                        drag.draggedConditionalBlock.branch === 'whenTrue' &&
                                        onMoveBlockBetweenConditionalBranches
                                      ) {
                                        // Cross-branch move from whenTrue to whenFalse
                                        onMoveBlockBetweenConditionalBranches(
                                          block.id,
                                          'whenTrue',
                                          drag.draggedConditionalBlock.index,
                                          'whenFalse',
                                          nestedIndex
                                        );
                                      }
                                    } else if (drag.draggedBlockId && onNestBlockInConditional) {
                                      const draggedBlock = blocks.find((b) => b.id === drag.draggedBlockId);
                                      if (
                                        draggedBlock?.block.type !== 'section' &&
                                        draggedBlock?.block.type !== 'conditional'
                                      ) {
                                        onNestBlockInConditional(
                                          drag.draggedBlockId,
                                          block.id,
                                          'whenFalse',
                                          nestedIndex
                                        );
                                      }
                                    }
                                    drag.setDraggedBlockId(null);
                                    drag.setDraggedBlockIndex(null);
                                    drag.setDraggedConditionalBlock(null);
                                    drag.setDragOverConditionalZone(null);
                                  }}
                                >
                                  <DropIndicator isActive={isDropZoneActive} label="📍 Move here" />
                                </div>
                              )}
                              <div
                                draggable
                                onDragStart={(e) =>
                                  drag.handleConditionalDragStart(e, block.id, 'whenFalse', nestedIndex)
                                }
                                onDragEnd={drag.handleConditionalDragEnd}
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
                    {drag.isDragging &&
                      !(
                        drag.draggedConditionalBlock?.conditionalId === block.id &&
                        drag.draggedConditionalBlock?.branch === 'whenFalse' &&
                        drag.draggedConditionalBlock?.index ===
                          (block.block as JsonConditionalBlock).whenFalse.length - 1
                      ) && (
                        <div
                          style={{ padding: '4px 0', marginTop: '8px' }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            // Accept any valid drag
                            if (drag.draggedConditionalBlock?.conditionalId === block.id || drag.draggedBlockId) {
                              const draggedBlock = drag.draggedBlockId
                                ? blocks.find((b) => b.id === drag.draggedBlockId)
                                : null;
                              if (
                                !draggedBlock ||
                                (draggedBlock.block.type !== 'section' && draggedBlock.block.type !== 'conditional')
                              ) {
                                drag.setDragOverConditionalZone({
                                  conditionalId: block.id,
                                  branch: 'whenFalse',
                                  index: (block.block as JsonConditionalBlock).whenFalse.length,
                                });
                              }
                            }
                          }}
                          onDragLeave={() => drag.setDragOverConditionalZone(null)}
                          onDrop={(e) => {
                            e.preventDefault();
                            const branchLen = (block.block as JsonConditionalBlock).whenFalse.length;
                            if (drag.draggedConditionalBlock?.conditionalId === block.id) {
                              if (drag.draggedConditionalBlock.branch === 'whenFalse' && onConditionalBranchBlockMove) {
                                onConditionalBranchBlockMove(
                                  block.id,
                                  'whenFalse',
                                  drag.draggedConditionalBlock.index,
                                  branchLen
                                );
                              } else if (
                                drag.draggedConditionalBlock.branch === 'whenTrue' &&
                                onMoveBlockBetweenConditionalBranches
                              ) {
                                onMoveBlockBetweenConditionalBranches(
                                  block.id,
                                  'whenTrue',
                                  drag.draggedConditionalBlock.index,
                                  'whenFalse',
                                  branchLen
                                );
                              }
                            } else if (drag.draggedBlockId && onNestBlockInConditional) {
                              const draggedBlock = blocks.find((b) => b.id === drag.draggedBlockId);
                              if (
                                draggedBlock?.block.type !== 'section' &&
                                draggedBlock?.block.type !== 'conditional'
                              ) {
                                onNestBlockInConditional(drag.draggedBlockId, block.id, 'whenFalse', branchLen);
                              }
                            }
                            drag.setDraggedBlockId(null);
                            drag.setDraggedBlockIndex(null);
                            drag.setDraggedConditionalBlock(null);
                            drag.setDragOverConditionalZone(null);
                          }}
                        >
                          <DropIndicator
                            isActive={
                              drag.dragOverConditionalZone?.conditionalId === block.id &&
                              drag.dragOverConditionalZone?.branch === 'whenFalse' &&
                              drag.dragOverConditionalZone?.index ===
                                (block.block as JsonConditionalBlock).whenFalse.length
                            }
                            label="📍 Move here"
                          />
                        </div>
                      )}
                    {/* Add block palette when not dragging */}
                    {!drag.isDragging && (
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
                        drag.dragOverNestedZone?.sectionId === block.id &&
                        drag.dragOverNestedZone?.index === nestedIndex;
                      // Don't show drop zone if it would result in same position (before dragged item or after it)
                      const isRedundantDropZone =
                        drag.draggedNestedBlock?.sectionId === block.id &&
                        (nestedIndex === drag.draggedNestedBlock.index ||
                          nestedIndex === drag.draggedNestedBlock.index + 1);

                      return (
                        <React.Fragment key={`${block.id}-${nestedIndex}`}>
                          {/* Drop zone before each nested block - accepts both nested reordering and root blocks (but not sections) */}
                          {drag.isDragging && !isRedundantDropZone && (
                            <div
                              style={{
                                padding: '4px 0',
                                marginBottom: '4px',
                              }}
                              onDragOver={(e) => {
                                e.preventDefault();
                                if (drag.draggedNestedBlock) {
                                  drag.handleDragOverNestedReorder(e, block.id, nestedIndex);
                                } else if (drag.draggedBlockId) {
                                  // Check if dragged block is a section - don't allow nesting
                                  const draggedBlock = blocks.find((b) => b.id === drag.draggedBlockId);
                                  if (draggedBlock?.block.type !== 'section') {
                                    drag.setDragOverNestedZone({ sectionId: block.id, index: nestedIndex });
                                  }
                                }
                              }}
                              onDragLeave={() => {
                                drag.handleDragLeaveNestedReorder();
                                drag.setDragOverNestedZone(null);
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                if (drag.draggedNestedBlock) {
                                  drag.handleDropNestedReorder(block.id, nestedIndex);
                                } else if (drag.draggedBlockId && onNestBlock) {
                                  // Check if dragged block is a section - don't allow nesting
                                  const draggedBlock = blocks.find((b) => b.id === drag.draggedBlockId);
                                  if (draggedBlock?.block.type === 'section') {
                                    return;
                                  }
                                  onNestBlock(drag.draggedBlockId, block.id, nestedIndex);
                                  drag.setDraggedBlockId(null);
                                  drag.setDraggedBlockIndex(null);
                                  drag.setDragOverNestedZone(null);
                                }
                              }}
                            >
                              <DropIndicator isActive={isDropZoneActive} label="📍 Move here" />
                            </div>
                          )}
                          <div
                            draggable
                            onDragStart={(e) => drag.handleNestedDragStart(e, block.id, nestedIndex)}
                            onDragEnd={drag.handleNestedDragEnd}
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
                  {drag.draggedNestedBlock &&
                    drag.draggedNestedBlock.sectionId === block.id &&
                    drag.draggedNestedBlock.index !== sectionBlocks.length - 1 && (
                      <div
                        style={{
                          padding: '4px 0',
                          marginBottom: '8px',
                        }}
                        onDragOver={(e) => drag.handleDragOverNestedReorder(e, block.id, sectionBlocks.length)}
                        onDragLeave={drag.handleDragLeaveNestedReorder}
                        onDrop={(e) => {
                          e.preventDefault();
                          drag.handleDropNestedReorder(block.id, sectionBlocks.length);
                        }}
                      >
                        <DropIndicator
                          isActive={
                            drag.dragOverNestedZone?.sectionId === block.id &&
                            drag.dragOverNestedZone?.index === sectionBlocks.length
                          }
                          label="📍 Move here"
                        />
                      </div>
                    )}

                  {/* Drop zone for section - accepts both root blocks and nested blocks from other sections */}
                  <div
                    className={`${nestedStyles.dropZone} ${drag.dragOverSectionId === block.id ? nestedStyles.dropZoneActive : ''}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      drag.handleDragOverSection(e, block.id);
                    }}
                    onDragLeave={drag.handleDragLeaveSection}
                    onDrop={(e) => {
                      e.preventDefault();
                      drag.handleDropOnSection(block.id);
                    }}
                  >
                    {drag.isDragging ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px' }}>
                        {drag.dragOverSectionId === block.id ? (
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
            {!drag.isRootDropZoneRedundant(index + 1) &&
              (drag.isDragging ? (
                <div
                  style={{ padding: '4px 0' }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (drag.draggedNestedBlock || drag.draggedConditionalBlock) {
                      drag.handleDragOverRootZone(e, index + 1);
                    } else if (drag.draggedBlockId) {
                      drag.handleDragOverReorder(e, index + 1);
                    }
                  }}
                  onDragLeave={() => {
                    drag.handleDragLeaveRootZone();
                    drag.handleDragLeaveReorder();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (drag.draggedNestedBlock || drag.draggedConditionalBlock) {
                      drag.handleDropOnRootZone(index + 1);
                    } else if (drag.draggedBlockId) {
                      drag.handleDropReorder(index + 1);
                    }
                  }}
                >
                  <DropIndicator
                    isActive={drag.dragOverRootZone === index + 1 || drag.dragOverReorderZone === index + 1}
                    label={drag.draggedNestedBlock || drag.draggedConditionalBlock ? '📤 Move out' : '📍 Move here'}
                  />
                </div>
              ) : (
                <div
                  className={styles.insertZone}
                  onMouseEnter={() => drag.setHoveredInsertIndex(index + 1)}
                  onMouseLeave={() => drag.setHoveredInsertIndex(null)}
                >
                  <div
                    className={`${styles.insertZoneButton} ${drag.hoveredInsertIndex === index + 1 ? styles.insertZoneButtonVisible : ''}`}
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
