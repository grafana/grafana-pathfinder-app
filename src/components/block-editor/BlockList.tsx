/**
 * Block List
 *
 * Renders the list of blocks with drag-and-drop reordering using @dnd-kit.
 * Supports nesting into section blocks and conditional branches.
 */

import React, { useCallback, useState, useMemo, useRef, useEffect } from 'react';
import { useStyles2 } from '@grafana/ui';
// @dnd-kit
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  MeasuringStrategy,
  UniqueIdentifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { getBlockListStyles } from './block-editor.styles';
import { getNestedStyles, getConditionalStyles } from './BlockList.styles';
import { BlockItem } from './BlockItem';
import { BlockPalette } from './BlockPalette';
import { SortableBlock, DroppableInsertZone, DragData } from './dnd-helpers';
import { SectionNestedBlocks } from './SectionNestedBlocks';
import { ConditionalBranches } from './ConditionalBranches';
import type { EditorBlock, BlockType, JsonBlock } from './types';
import {
  isSectionBlock as checkIsSectionBlock,
  isConditionalBlock as checkIsConditionalBlock,
  type JsonSectionBlock,
  type JsonConditionalBlock,
} from '../../types/json-guide.types';

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
  onUnnestBlock?: (nestedBlockId: string, sectionId: string, insertAtRootIndex?: number) => void;
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
  /** Called to move a block from one section to another */
  onMoveBlockBetweenSections?: (
    fromSectionId: string,
    fromIndex: number,
    toSectionId: string,
    toIndex?: number
  ) => void;
}

/**
 * Block list component with @dnd-kit drag-and-drop
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
  onMoveBlockBetweenSections,
}: BlockListProps) {
  const styles = useStyles2(getBlockListStyles);
  const nestedStyles = useStyles2(getNestedStyles);
  const conditionalStyles = useStyles2(getConditionalStyles);

  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [activeDropZone, setActiveDropZone] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const [hoveredInsertIndex, setHoveredInsertIndex] = useState<number | null>(null);
  const autoExpandTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 8 },
  });
  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
  });
  const sensors = useSensors(pointerSensor, keyboardSensor);
  const activeSensors = useMemo(() => (isSelectionMode ? [] : sensors), [isSelectionMode, sensors]);

  const rootBlockIds = useMemo(() => blocks.map((b) => b.id), [blocks]);

  /**
   * Parses drag data from a sortable item ID.
   *
   * ID Format Constraints:
   * - Root blocks: use block.id directly
   * - Nested blocks: `{sectionId}-nested-{index}` (e.g., "section-1-nested-0")
   * - Conditional blocks: `{conditionalId}-{true|false}-{index}` (e.g., "cond-1-true-0")
   *
   * LIMITATION: Section/conditional IDs must NOT contain "-nested-" or end with
   * "-true" or "-false" followed by a dash and number, as these patterns are
   * used to identify nested/conditional blocks via regex parsing.
   */
  const getDragData = useCallback((id: UniqueIdentifier): DragData | null => {
    const idStr = String(id);
    
    const rootIndex = blocks.findIndex((b) => b.id === idStr);
    if (rootIndex >= 0) {
      return {
        type: 'root',
        blockType: blocks[rootIndex].block.type,
        index: rootIndex,
      };
    }

    const nestedMatch = idStr.match(/^(.+)-nested-(\d+)$/);
    if (nestedMatch) {
      const [, sectionId, indexStr] = nestedMatch;
      const sectionBlock = blocks.find((b) => b.id === sectionId);
      if (sectionBlock && checkIsSectionBlock(sectionBlock.block)) {
        const nestedBlocks = (sectionBlock.block as JsonSectionBlock).blocks;
        const nestedIndex = parseInt(indexStr, 10);
        if (nestedIndex < nestedBlocks.length) {
          return {
            type: 'nested',
            blockType: nestedBlocks[nestedIndex].type,
            index: nestedIndex,
            sectionId,
          };
        }
      }
    }

    const conditionalMatch = idStr.match(/^(.+)-(true|false)-(\d+)$/);
    if (conditionalMatch) {
      const [, conditionalId, branchStr, indexStr] = conditionalMatch;
      const branch = branchStr === 'true' ? 'whenTrue' : 'whenFalse';
      const conditionalBlock = blocks.find((b) => b.id === conditionalId);
      if (conditionalBlock && checkIsConditionalBlock(conditionalBlock.block)) {
        return {
          type: 'conditional',
          blockType: (conditionalBlock.block as JsonConditionalBlock)[branch][parseInt(indexStr, 10)]?.type || 'unknown',
          index: parseInt(indexStr, 10),
          conditionalId,
          branch,
        };
      }
    }

    return null;
  }, [blocks]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { over } = event;
    if (!over) {
      setActiveDropZone(null);
      if (autoExpandTimeoutRef.current) {
        clearTimeout(autoExpandTimeoutRef.current);
        autoExpandTimeoutRef.current = null;
      }
      return;
    }

    const overId = String(over.id);
    setActiveDropZone(overId);

    if (overId.startsWith('section-drop-') || overId.startsWith('conditional-')) {
      const blockId = overId.replace('section-drop-', '').replace(/^conditional-(true|false)-/, '');
      if (collapsedSections.has(blockId)) {
        if (autoExpandTimeoutRef.current) {
          clearTimeout(autoExpandTimeoutRef.current);
        }
        autoExpandTimeoutRef.current = setTimeout(() => {
          setCollapsedSections((prev) => {
            const next = new Set(prev);
            next.delete(blockId);
            return next;
          });
        }, 500);
      }
    }
  }, [collapsedSections]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setActiveDropZone(null);

    if (autoExpandTimeoutRef.current) {
      clearTimeout(autoExpandTimeoutRef.current);
      autoExpandTimeoutRef.current = null;
    }

    if (!over) {
      return;
    }

    // Use @dnd-kit's data prop directly instead of parsing IDs
    const activeData = active.data.current as DragData | undefined;
    if (!activeData) {
      return;
    }

    // Defensive: verify source block still exists for root blocks
    if (activeData.type === 'root') {
      const blockExists = blocks.some((b) => b.id === String(active.id));
      if (!blockExists) {
        return;
      }
    }

    // Defensive: verify section still exists for nested blocks
    if (activeData.type === 'nested' && activeData.sectionId) {
      const sectionExists = blocks.some((b) => b.id === activeData.sectionId);
      if (!sectionExists) {
        return;
      }
    }

    // Defensive: verify conditional still exists for conditional blocks
    if (activeData.type === 'conditional' && activeData.conditionalId) {
      const conditionalExists = blocks.some((b) => b.id === activeData.conditionalId);
      if (!conditionalExists) {
        return;
      }
    }

    const overId = String(over.id);

    // Handle section insert zones: section-insert-{sectionId}-{index}
    if (overId.startsWith('section-insert-')) {
      const match = overId.match(/^section-insert-(.+)-(\d+)$/);
      if (match) {
        const [, sectionId, indexStr] = match;
        const insertIndex = parseInt(indexStr, 10);

        // Guard against nesting sections/conditionals
        if (activeData.blockType === 'section' || activeData.blockType === 'conditional') {
          return;
        }

        if (activeData.type === 'root' && onNestBlock) {
          const rootBlock = blocks.find((b) => b.id === String(active.id));
          if (rootBlock) {
            onNestBlock(rootBlock.id, sectionId, insertIndex);
          }
        } else if (activeData.type === 'nested' && activeData.sectionId && activeData.sectionId !== sectionId && onMoveBlockBetweenSections) {
          // Moving from one section to another at specific index
          onMoveBlockBetweenSections(activeData.sectionId, activeData.index, sectionId, insertIndex);
        } else if (activeData.type === 'nested' && activeData.sectionId && activeData.sectionId === sectionId && onNestedBlockMove) {
          // Reordering within same section
          if (activeData.index !== insertIndex && activeData.index !== insertIndex - 1) {
            // Adjust target index if moving down (after removing from source position)
            const adjustedIndex = activeData.index < insertIndex ? insertIndex - 1 : insertIndex;
            onNestedBlockMove(sectionId, activeData.index, adjustedIndex);
          }
        }
      }
      return;
    }

    // Handle conditional insert zones: conditional-insert-{true|false}-{conditionalId}-{index}
    if (overId.startsWith('conditional-insert-')) {
      const match = overId.match(/^conditional-insert-(true|false)-(.+)-(\d+)$/);
      if (match) {
        const [, branchStr, conditionalId, indexStr] = match;
        const branch = branchStr === 'true' ? 'whenTrue' : 'whenFalse';
        const insertIndex = parseInt(indexStr, 10);

        // Guard against nesting sections/conditionals
        if (activeData.blockType === 'section' || activeData.blockType === 'conditional') {
          return;
        }

        if (activeData.type === 'root' && onNestBlockInConditional) {
          const rootBlock = blocks.find((b) => b.id === String(active.id));
          if (rootBlock) {
            onNestBlockInConditional(rootBlock.id, conditionalId, branch, insertIndex);
          }
        } else if (activeData.type === 'conditional' && activeData.conditionalId === conditionalId) {
          // Moving within the same conditional
          if (activeData.branch === branch && onConditionalBranchBlockMove) {
            // Same branch - reorder
            if (activeData.index !== insertIndex && activeData.index !== insertIndex - 1) {
              const adjustedIndex = activeData.index < insertIndex ? insertIndex - 1 : insertIndex;
              onConditionalBranchBlockMove(conditionalId, branch, activeData.index, adjustedIndex);
            }
          } else if (activeData.branch && onMoveBlockBetweenConditionalBranches) {
            // Different branch - move between branches at specific index
            onMoveBlockBetweenConditionalBranches(conditionalId, activeData.branch, activeData.index, branch, insertIndex);
          }
        }
      }
      return;
    }

    if (overId.startsWith('section-drop-')) {
      const sectionId = overId.replace('section-drop-', '');
      
      if (activeData.blockType === 'section' || activeData.blockType === 'conditional') {
        return;
      }

      if (activeData.type === 'root' && onNestBlock) {
        const rootBlock = blocks.find((b) => b.id === String(active.id));
        if (rootBlock) {
          onNestBlock(rootBlock.id, sectionId);
        }
      } else if (activeData.type === 'nested' && activeData.sectionId && activeData.sectionId !== sectionId && onMoveBlockBetweenSections) {
        // Moving from one section to another
        onMoveBlockBetweenSections(activeData.sectionId, activeData.index, sectionId);
      }
      return;
    }

    if (overId.startsWith('conditional-')) {
      const match = overId.match(/^conditional-(true|false)-(.+)$/);
      if (match) {
        const [, branchStr, conditionalId] = match;
        const branch = branchStr === 'true' ? 'whenTrue' : 'whenFalse';

        if (activeData.blockType === 'section' || activeData.blockType === 'conditional') {
          return;
        }

        if (activeData.type === 'root' && onNestBlockInConditional) {
          const rootBlock = blocks.find((b) => b.id === String(active.id));
          if (rootBlock) {
            onNestBlockInConditional(rootBlock.id, conditionalId, branch);
          }
        }
      }
      return;
    }

    if (overId.startsWith('root-zone-')) {
      const insertIndex = parseInt(overId.replace('root-zone-', ''), 10);

      if (activeData.type === 'nested' && activeData.sectionId && onUnnestBlock) {
        onUnnestBlock(`${activeData.sectionId}-${activeData.index}`, activeData.sectionId, insertIndex);
      } else if (activeData.type === 'conditional' && activeData.conditionalId && activeData.branch && onUnnestBlockFromConditional) {
        onUnnestBlockFromConditional(activeData.conditionalId, activeData.branch, activeData.index, insertIndex);
      }
      return;
    }

    if (activeData.type === 'root') {
      // Use @dnd-kit's data prop directly instead of parsing IDs
      const overData = over.data.current as DragData | undefined;
      if (overData?.type === 'root' && activeData.index !== overData.index) {
        onBlockMove(activeData.index, overData.index);
      }
      return;
    }

    if (activeData.type === 'nested' && activeData.sectionId) {
      // Use @dnd-kit's data prop directly instead of parsing IDs
      const overData = over.data.current as DragData | undefined;
      if (overData?.type === 'nested' && overData.sectionId === activeData.sectionId && onNestedBlockMove) {
        const toIndex = overData.index;
        if (activeData.index !== toIndex) {
          onNestedBlockMove(activeData.sectionId, activeData.index, toIndex);
        }
      }
      return;
    }

    if (activeData.type === 'conditional' && activeData.conditionalId && activeData.branch) {
      // Use @dnd-kit's data prop directly instead of parsing IDs
      const overData = over.data.current as DragData | undefined;
      if (overData?.type === 'conditional' && overData.conditionalId === activeData.conditionalId) {
        if (activeData.branch === overData.branch && onConditionalBranchBlockMove) {
          if (activeData.index !== overData.index) {
            onConditionalBranchBlockMove(activeData.conditionalId, activeData.branch, activeData.index, overData.index);
          }
        } else if (overData.branch && onMoveBlockBetweenConditionalBranches) {
          onMoveBlockBetweenConditionalBranches(
            activeData.conditionalId,
            activeData.branch,
            activeData.index,
            overData.branch,
            overData.index
          );
        }
      }
    }
  }, [blocks, onBlockMove, onNestBlock, onUnnestBlock, onNestedBlockMove, onNestBlockInConditional, onUnnestBlockFromConditional, onConditionalBranchBlockMove, onMoveBlockBetweenConditionalBranches, onMoveBlockBetweenSections]);

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setActiveDropZone(null);
    if (autoExpandTimeoutRef.current) {
      clearTimeout(autoExpandTimeoutRef.current);
      autoExpandTimeoutRef.current = null;
    }
  }, []);

  // REACT: cleanup timeout on unmount (R1)
  useEffect(() => {
    return () => {
      if (autoExpandTimeoutRef.current) {
        clearTimeout(autoExpandTimeoutRef.current);
      }
    };
  }, []);

  const handleInsertInSection = useCallback(
    (type: BlockType, sectionId: string) => {
      if (onInsertBlockInSection) {
        onInsertBlockInSection(type, sectionId);
      }
    },
    [onInsertBlockInSection]
  );

  const isDraggingNestable = activeId !== null && (() => {
    const data = getDragData(activeId);
    return data?.type === 'nested' || data?.type === 'conditional';
  })();

  const isDraggingUnNestable = activeId !== null && (() => {
    const data = getDragData(activeId);
    return data?.type === 'root' && (data.blockType === 'section' || data.blockType === 'conditional');
  })();

  const isDropZoneRedundant = useCallback((zoneIndex: number) => {
    if (!activeId) {
      return false;
    }
    const data = getDragData(activeId);
    if (data?.type !== 'root') {
      return false;
    }
    return zoneIndex === data.index || zoneIndex === data.index + 1;
  }, [activeId, getDragData]);

  return (
    <DndContext
      sensors={activeSensors}
      collisionDetection={closestCenter}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className={styles.list}>
        {activeId !== null && !isDropZoneRedundant(0) && (
          <DroppableInsertZone
            id="root-zone-0"
            isActive={activeDropZone === 'root-zone-0'}
            label={isDraggingNestable ? '📤 Move out' : '📍 Move here'}
          />
        )}
        {activeId === null && (
          <div
            className={styles.insertZone}
            onMouseEnter={() => setHoveredInsertIndex(0)}
            onMouseLeave={() => setHoveredInsertIndex(null)}
          >
            <div className={`${styles.insertZoneButton} ${hoveredInsertIndex === 0 ? styles.insertZoneButtonVisible : ''}`}>
              <BlockPalette onSelect={onInsertBlock} insertAtIndex={0} compact />
            </div>
          </div>
        )}

        <SortableContext items={rootBlockIds} strategy={verticalListSortingStrategy}>
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
                <SortableBlock
                  id={block.id}
                  data={{
                    type: 'root',
                    blockType: block.block.type,
                    index,
                  }}
                  disabled={isSelectionMode}
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
                </SortableBlock>

                {isConditional && (
                  <ConditionalBranches
                    block={block}
                    isCollapsed={collapsedSections.has(block.id)}
                    conditionalStyles={conditionalStyles}
                    nestedStyles={nestedStyles}
                    activeId={activeId}
                    activeDropZone={activeDropZone}
                    isDraggingUnNestable={isDraggingUnNestable}
                    isSelectionMode={isSelectionMode}
                    selectedBlockIds={selectedBlockIds}
                    onToggleBlockSelection={onToggleBlockSelection}
                    onConditionalBranchRecord={onConditionalBranchRecord}
                    recordingIntoConditionalBranch={recordingIntoConditionalBranch}
                    onConditionalBranchBlockEdit={onConditionalBranchBlockEdit}
                    onConditionalBranchBlockDelete={onConditionalBranchBlockDelete}
                    onConditionalBranchBlockDuplicate={onConditionalBranchBlockDuplicate}
                    onInsertBlockInConditional={onInsertBlockInConditional}
                  />
                )}

                {isSection && (
                  <SectionNestedBlocks
                    block={block}
                    sectionBlocks={sectionBlocks}
                    isCollapsed={collapsedSections.has(block.id)}
                    nestedStyles={nestedStyles}
                    activeId={activeId}
                    activeDropZone={activeDropZone}
                    isDraggingUnNestable={isDraggingUnNestable}
                    isSelectionMode={isSelectionMode}
                    selectedBlockIds={selectedBlockIds}
                    onToggleBlockSelection={onToggleBlockSelection}
                    onNestedBlockEdit={onNestedBlockEdit}
                    onNestedBlockDelete={onNestedBlockDelete}
                    onNestedBlockDuplicate={onNestedBlockDuplicate}
                    handleInsertInSection={handleInsertInSection}
                  />
                )}

                {activeId !== null && !isDropZoneRedundant(index + 1) && (
                  <DroppableInsertZone
                    id={`root-zone-${index + 1}`}
                    isActive={activeDropZone === `root-zone-${index + 1}`}
                    label={isDraggingNestable ? '📤 Move out' : '📍 Move here'}
                  />
                )}
                {activeId === null && (
                  <div
                    className={styles.insertZone}
                    onMouseEnter={() => setHoveredInsertIndex(index + 1)}
                    onMouseLeave={() => setHoveredInsertIndex(null)}
                  >
                    <div className={`${styles.insertZoneButton} ${hoveredInsertIndex === index + 1 ? styles.insertZoneButtonVisible : ''}`}>
                      <BlockPalette onSelect={onInsertBlock} insertAtIndex={index + 1} compact />
                    </div>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </SortableContext>
      </div>
    </DndContext>
  );
}

BlockList.displayName = 'BlockList';
