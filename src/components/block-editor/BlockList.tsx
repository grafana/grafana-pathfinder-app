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
  pointerWithin,
  MeasuringStrategy,
  UniqueIdentifier,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { getBlockListStyles } from './block-editor.styles';
import { getNestedStyles, getConditionalStyles } from './BlockList.styles';
import { BlockItem } from './BlockItem';
import { BlockPalette } from './BlockPalette';
import { SortableBlock, DroppableInsertZone, DragData, DropZoneData, isInsertZoneRedundant } from './dnd-helpers';
import { SectionNestedBlocks } from './SectionNestedBlocks';
import { ConditionalBranches } from './ConditionalBranches';
import type { EditorBlock, JsonBlock, BlockOperations } from './types';
import {
  isSectionBlock as checkIsSectionBlock,
  isConditionalBlock as checkIsConditionalBlock,
  type JsonSectionBlock,
  type JsonConditionalBlock,
} from '../../types/json-guide.types';

export interface BlockListProps {
  /** List of blocks to render */
  blocks: EditorBlock[];
  /** All block operations - consolidated interface */
  operations: BlockOperations;
}

/**
 * Block list component with @dnd-kit drag-and-drop
 */
export function BlockList({ blocks, operations }: BlockListProps) {
  // Destructure operations for convenience
  const {
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
    isSelectionMode,
    selectedBlockIds,
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
  } = operations;
  const styles = useStyles2(getBlockListStyles);
  const nestedStyles = useStyles2(getNestedStyles);
  const conditionalStyles = useStyles2(getConditionalStyles);

  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [activeDropZone, setActiveDropZone] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const [activeDragData, setActiveDragData] = useState<DragData | null>(null);
  const [hoveredInsertIndex, setHoveredInsertIndex] = useState<number | null>(null);
  const [justDroppedId, setJustDroppedId] = useState<string | null>(null);
  const [lastModifiedId, setLastModifiedId] = useState<string | null>(null);
  const autoExpandTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const dropHighlightTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastModifiedTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const triggerLastModified = useCallback((id: string) => {
    if (lastModifiedTimeoutRef.current) {
      clearTimeout(lastModifiedTimeoutRef.current);
    }
    setLastModifiedId(id);
    lastModifiedTimeoutRef.current = setTimeout(() => {
      setLastModifiedId(null);
      lastModifiedTimeoutRef.current = null;
    }, 3000);
  }, []);

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

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id);
    // Store active drag data for use in render-time calculations
    setActiveDragData(event.active.data.current as DragData | null);
  }, []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
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

      // Auto-expand collapsed sections/conditionals when hovering over their drop zones
      const overData = over.data.current as DropZoneData | undefined;
      const blockIdToExpand = overData?.sectionId ?? overData?.conditionalId;

      if (blockIdToExpand && collapsedSections.has(blockIdToExpand)) {
        if (autoExpandTimeoutRef.current) {
          clearTimeout(autoExpandTimeoutRef.current);
        }
        autoExpandTimeoutRef.current = setTimeout(() => {
          setCollapsedSections((prev) => {
            const next = new Set(prev);
            next.delete(blockIdToExpand);
            return next;
          });
        }, 500);
      }
    },
    [collapsedSections]
  );

  // ============================================================================
  // Drop Handlers - Decomposed for clarity and testability
  // ============================================================================

  /**
   * Handle drop on section insert zone (specific position within section)
   */
  const handleDropOnSectionInsert = useCallback(
    (activeId: string, activeData: DragData, sectionId: string, insertIndex: number) => {
      // Guard against nesting sections (conditionals ARE allowed in sections)
      if (activeData.blockType === 'section') {
        return;
      }

      if (activeData.type === 'root' && onNestBlock) {
        const rootBlock = blocks.find((b) => b.id === activeId);
        if (rootBlock) {
          onNestBlock(rootBlock.id, sectionId, insertIndex);
        }
      } else if (
        activeData.type === 'nested' &&
        activeData.sectionId &&
        activeData.sectionId !== sectionId &&
        onMoveBlockBetweenSections
      ) {
        onMoveBlockBetweenSections(activeData.sectionId, activeData.index, sectionId, insertIndex);
      } else if (activeData.type === 'nested' && activeData.sectionId === sectionId && onNestedBlockMove) {
        if (activeData.index !== insertIndex && activeData.index !== insertIndex - 1) {
          const adjustedIndex = activeData.index < insertIndex ? insertIndex - 1 : insertIndex;
          onNestedBlockMove(sectionId, activeData.index, adjustedIndex);
        }
      }
    },
    [blocks, onNestBlock, onMoveBlockBetweenSections, onNestedBlockMove]
  );

  /**
   * Handle drop on conditional insert zone (specific position within branch)
   */
  const handleDropOnConditionalInsert = useCallback(
    (
      activeId: string,
      activeData: DragData,
      conditionalId: string,
      branch: 'whenTrue' | 'whenFalse',
      insertIndex: number
    ) => {
      // Guard against nesting sections/conditionals
      if (activeData.blockType === 'section' || activeData.blockType === 'conditional') {
        return;
      }

      if (activeData.type === 'root' && onNestBlockInConditional) {
        const rootBlock = blocks.find((b) => b.id === activeId);
        if (rootBlock) {
          onNestBlockInConditional(rootBlock.id, conditionalId, branch, insertIndex);
        }
      } else if (activeData.type === 'conditional' && activeData.conditionalId === conditionalId) {
        if (activeData.branch === branch && onConditionalBranchBlockMove) {
          if (activeData.index !== insertIndex && activeData.index !== insertIndex - 1) {
            const adjustedIndex = activeData.index < insertIndex ? insertIndex - 1 : insertIndex;
            onConditionalBranchBlockMove(conditionalId, branch, activeData.index, adjustedIndex);
          }
        } else if (activeData.branch && onMoveBlockBetweenConditionalBranches) {
          onMoveBlockBetweenConditionalBranches(
            conditionalId,
            activeData.branch,
            activeData.index,
            branch,
            insertIndex
          );
        }
      }
    },
    [blocks, onNestBlockInConditional, onConditionalBranchBlockMove, onMoveBlockBetweenConditionalBranches]
  );

  /**
   * Handle drop on section drop zone (append to section)
   */
  const handleDropOnSectionDrop = useCallback(
    (activeId: string, activeData: DragData, sectionId: string) => {
      // Guard against nesting sections (conditionals ARE allowed in sections)
      if (activeData.blockType === 'section') {
        return;
      }

      if (activeData.type === 'root' && onNestBlock) {
        const rootBlock = blocks.find((b) => b.id === activeId);
        if (rootBlock) {
          onNestBlock(rootBlock.id, sectionId);
        }
      } else if (
        activeData.type === 'nested' &&
        activeData.sectionId &&
        activeData.sectionId !== sectionId &&
        onMoveBlockBetweenSections
      ) {
        onMoveBlockBetweenSections(activeData.sectionId, activeData.index, sectionId);
      }
    },
    [blocks, onNestBlock, onMoveBlockBetweenSections]
  );

  /**
   * Handle drop on conditional drop zone (append to branch)
   */
  const handleDropOnConditionalDrop = useCallback(
    (activeId: string, activeData: DragData, conditionalId: string, branch: 'whenTrue' | 'whenFalse') => {
      if (activeData.blockType === 'section' || activeData.blockType === 'conditional') {
        return;
      }

      if (activeData.type === 'root' && onNestBlockInConditional) {
        const rootBlock = blocks.find((b) => b.id === activeId);
        if (rootBlock) {
          onNestBlockInConditional(rootBlock.id, conditionalId, branch);
        }
      }
    },
    [blocks, onNestBlockInConditional]
  );

  /**
   * Handle drop on root zone (unnesting from section/conditional OR reordering root blocks)
   */
  const handleDropOnRootZone = useCallback(
    (activeData: DragData, insertIndex: number) => {
      // Handle root block reordering via root-zone
      if (activeData.type === 'root') {
        // Calculate target index: if inserting after current position, adjust for removal
        const targetIndex = insertIndex > activeData.index ? insertIndex - 1 : insertIndex;
        if (targetIndex !== activeData.index) {
          onBlockMove(activeData.index, targetIndex);
        }
        return;
      }
      // Handle unnesting from section
      if (activeData.type === 'nested' && activeData.sectionId && onUnnestBlock) {
        onUnnestBlock(`${activeData.sectionId}-${activeData.index}`, activeData.sectionId, insertIndex);
      } else if (
        activeData.type === 'conditional' &&
        activeData.conditionalId &&
        activeData.branch &&
        onUnnestBlockFromConditional
      ) {
        onUnnestBlockFromConditional(activeData.conditionalId, activeData.branch, activeData.index, insertIndex);
      }
    },
    [onBlockMove, onUnnestBlock, onUnnestBlockFromConditional]
  );

  /**
   * Handle sortable-to-sortable reordering (root, nested, or conditional blocks)
   */
  const handleSortableReorder = useCallback(
    (activeData: DragData, overData: DragData) => {
      // Root block reordering
      if (activeData.type === 'root' && overData.type === 'root') {
        if (activeData.index !== overData.index) {
          onBlockMove(activeData.index, overData.index);
        }
        return;
      }

      // Nested block reordering within same section
      if (
        activeData.type === 'nested' &&
        activeData.sectionId &&
        overData.type === 'nested' &&
        overData.sectionId === activeData.sectionId &&
        onNestedBlockMove
      ) {
        if (activeData.index !== overData.index) {
          onNestedBlockMove(activeData.sectionId, activeData.index, overData.index);
        }
        return;
      }

      // Conditional block reordering
      if (
        activeData.type === 'conditional' &&
        activeData.conditionalId &&
        activeData.branch &&
        overData.type === 'conditional' &&
        overData.conditionalId === activeData.conditionalId
      ) {
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
    },
    [onBlockMove, onNestedBlockMove, onConditionalBranchBlockMove, onMoveBlockBetweenConditionalBranches]
  );

  /**
   * Verify the dragged block still exists in its container
   */
  const verifyBlockExists = useCallback(
    (activeId: string, activeData: DragData): boolean => {
      if (activeData.type === 'root') {
        return blocks.some((b) => b.id === activeId);
      }
      if (activeData.type === 'nested' && activeData.sectionId) {
        return blocks.some((b) => b.id === activeData.sectionId);
      }
      if (activeData.type === 'conditional' && activeData.conditionalId) {
        return blocks.some((b) => b.id === activeData.conditionalId);
      }
      return false;
    },
    [blocks]
  );

  // ============================================================================
  // Main Drag End Handler
  // ============================================================================

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);
      setActiveDragData(null);
      setActiveDropZone(null);

      if (autoExpandTimeoutRef.current) {
        clearTimeout(autoExpandTimeoutRef.current);
        autoExpandTimeoutRef.current = null;
      }

      if (!over) {
        return;
      }

      const activeData = active.data.current as DragData | undefined;
      const overData = over.data.current as DragData | DropZoneData | undefined;

      if (!activeData || !overData) {
        return;
      }

      // Defensive: verify source block still exists
      if (!verifyBlockExists(String(active.id), activeData)) {
        return;
      }

      const activeIdStr = String(active.id);

      // Helper to trigger drop highlight animation
      const triggerDropHighlight = (droppedId: string) => {
        if (dropHighlightTimeoutRef.current) {
          clearTimeout(dropHighlightTimeoutRef.current);
        }
        setJustDroppedId(droppedId);
        dropHighlightTimeoutRef.current = setTimeout(() => {
          setJustDroppedId(null);
          dropHighlightTimeoutRef.current = null;
        }, 1500);
      };

      // Route to appropriate handler based on drop zone type
      // For each case, compute the NEW ID based on where the block lands (not the old ID)
      switch (overData.type) {
        case 'section-insert':
          if (overData.sectionId !== undefined && overData.index !== undefined) {
            handleDropOnSectionInsert(activeIdStr, activeData, overData.sectionId, overData.index);
            // Calculate the actual landing index (same logic as handler)
            // When reordering within the same section, adjust for removal
            const sectionHighlightIndex =
              activeData.type === 'nested' &&
              activeData.sectionId === overData.sectionId &&
              activeData.index < overData.index
                ? overData.index - 1
                : overData.index;
            triggerDropHighlight(`${overData.sectionId}-nested-${sectionHighlightIndex}`);
          }
          break;

        case 'conditional-insert':
          if (overData.conditionalId !== undefined && overData.branch !== undefined && overData.index !== undefined) {
            handleDropOnConditionalInsert(
              activeIdStr,
              activeData,
              overData.conditionalId,
              overData.branch,
              overData.index
            );
            // Calculate the actual landing index (same logic as handler)
            // When reordering within the same branch, adjust for removal
            const conditionalHighlightIndex =
              activeData.type === 'conditional' &&
              activeData.conditionalId === overData.conditionalId &&
              activeData.branch === overData.branch &&
              activeData.index < overData.index
                ? overData.index - 1
                : overData.index;
            const branchKey = overData.branch === 'whenTrue' ? 'true' : 'false';
            triggerDropHighlight(`${overData.conditionalId}-${branchKey}-${conditionalHighlightIndex}`);
          }
          break;

        case 'section-drop':
          if (overData.sectionId !== undefined) {
            handleDropOnSectionDrop(activeIdStr, activeData, overData.sectionId);
            // Block is appended to end of section - need to find the section to know the new index
            const targetSection = blocks.find((b) => b.id === overData.sectionId);
            const sectionBlockCount =
              targetSection && checkIsSectionBlock(targetSection.block)
                ? (targetSection.block as JsonSectionBlock).blocks.length
                : 0;
            triggerDropHighlight(`${overData.sectionId}-nested-${sectionBlockCount}`);
          }
          break;

        case 'conditional-drop':
          if (overData.conditionalId !== undefined && overData.branch !== undefined) {
            handleDropOnConditionalDrop(activeIdStr, activeData, overData.conditionalId, overData.branch);
            // Block is appended to end of branch
            const targetConditional = blocks.find((b) => b.id === overData.conditionalId);
            const conditionalBlock =
              targetConditional && checkIsConditionalBlock(targetConditional.block)
                ? (targetConditional.block as JsonConditionalBlock)
                : null;
            const branchBlocks = conditionalBlock
              ? overData.branch === 'whenTrue'
                ? conditionalBlock.whenTrue
                : conditionalBlock.whenFalse
              : [];
            const branchKey = overData.branch === 'whenTrue' ? 'true' : 'false';
            triggerDropHighlight(`${overData.conditionalId}-${branchKey}-${branchBlocks.length}`);
          }
          break;

        case 'root-zone':
          if (overData.index !== undefined) {
            handleDropOnRootZone(activeData, overData.index);
            // For root blocks, the ID is the block.id (stable UUID), not index-based
            triggerDropHighlight(activeIdStr);
          }
          break;

        case 'root':
        case 'nested':
        case 'conditional':
          handleSortableReorder(activeData, overData as DragData);
          // For sortable reorder, the block lands at overData.index position
          if (overData.type === 'root') {
            // Root blocks use stable UUIDs
            triggerDropHighlight(activeIdStr);
          } else if (overData.type === 'nested' && (overData as DragData).sectionId) {
            triggerDropHighlight(`${(overData as DragData).sectionId}-nested-${(overData as DragData).index}`);
          } else if (overData.type === 'conditional' && (overData as DragData).conditionalId) {
            const branchKey = (overData as DragData).branch === 'whenTrue' ? 'true' : 'false';
            triggerDropHighlight(
              `${(overData as DragData).conditionalId}-${branchKey}-${(overData as DragData).index}`
            );
          }
          break;
      }
    },
    [
      blocks,
      verifyBlockExists,
      handleDropOnSectionInsert,
      handleDropOnConditionalInsert,
      handleDropOnSectionDrop,
      handleDropOnConditionalDrop,
      handleDropOnRootZone,
      handleSortableReorder,
    ]
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setActiveDragData(null);
    setActiveDropZone(null);
    if (autoExpandTimeoutRef.current) {
      clearTimeout(autoExpandTimeoutRef.current);
      autoExpandTimeoutRef.current = null;
    }
  }, []);

  // REACT: cleanup timeouts on unmount (R1)
  useEffect(() => {
    return () => {
      if (autoExpandTimeoutRef.current) {
        clearTimeout(autoExpandTimeoutRef.current);
      }
      if (dropHighlightTimeoutRef.current) {
        clearTimeout(dropHighlightTimeoutRef.current);
      }
      if (lastModifiedTimeoutRef.current) {
        clearTimeout(lastModifiedTimeoutRef.current);
      }
    };
  }, []);

  // Derive drag state flags from stored activeDragData
  const isDraggingNestable =
    activeDragData !== null && (activeDragData.type === 'nested' || activeDragData.type === 'conditional');

  const isDraggingUnNestable =
    activeDragData !== null && activeDragData.type === 'root' && activeDragData.blockType === 'section';

  const isRootZoneRedundant = useCallback(
    (zoneIndex: number) => isInsertZoneRedundant(activeDragData, 'root-zone', zoneIndex),
    [activeDragData]
  );

  return (
    <DndContext
      sensors={activeSensors}
      collisionDetection={pointerWithin}
      measuring={{ droppable: { strategy: MeasuringStrategy.WhileDragging } }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className={styles.list}>
        {activeId !== null && !isRootZoneRedundant(0) && (
          <DroppableInsertZone
            id="root-zone-0"
            data={{ type: 'root-zone', index: 0 }}
            isActive={activeDropZone === 'root-zone-0'}
            label={isDraggingNestable ? '📤 Move out' : '📍 Move here'}
            enlarged={isDraggingUnNestable}
          />
        )}
        {activeId === null && (
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
                    onEdit={() => {
                      triggerLastModified(block.id);
                      onBlockEdit(block);
                    }}
                    onDelete={() => onBlockDelete(block.id)}
                    onDuplicate={() => {
                      const newId = onBlockDuplicate(block.id);
                      if (newId) {
                        triggerLastModified(newId);
                      }
                    }}
                    onRecord={isSection && onSectionRecord ? () => onSectionRecord(block.id) : undefined}
                    isRecording={isSection && recordingIntoSection === block.id}
                    isSelectionMode={isSelectionMode}
                    isSelected={selectedBlockIds.has(block.id)}
                    onToggleSelect={onToggleBlockSelection ? () => onToggleBlockSelection(block.id) : undefined}
                    isCollapsible={isSection || isConditional}
                    isCollapsed={collapsedSections.has(block.id)}
                    onToggleCollapse={() => toggleCollapse(block.id)}
                    childCount={isSection ? sectionBlocks.length : conditionalChildCount}
                    isJustDropped={justDroppedId === block.id}
                    isLastModified={lastModifiedId === block.id}
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
                    activeDragData={activeDragData}
                    isDraggingUnNestable={isDraggingUnNestable}
                    isSelectionMode={isSelectionMode}
                    selectedBlockIds={selectedBlockIds}
                    onToggleBlockSelection={onToggleBlockSelection}
                    onConditionalBranchRecord={onConditionalBranchRecord}
                    recordingIntoConditionalBranch={recordingIntoConditionalBranch}
                    onConditionalBranchBlockEdit={onConditionalBranchBlockEdit
                      ? (conditionalId, branch, nestedIndex, block) => {
                          const branchKey = branch === 'whenTrue' ? 'true' : 'false';
                          triggerLastModified(`${conditionalId}-${branchKey}-${nestedIndex}`);
                          onConditionalBranchBlockEdit(conditionalId, branch, nestedIndex, block);
                        }
                      : undefined}
                    onConditionalBranchBlockDelete={onConditionalBranchBlockDelete}
                    onConditionalBranchBlockDuplicate={onConditionalBranchBlockDuplicate}
                    onInsertBlockInConditional={onInsertBlockInConditional}
                    justDroppedId={justDroppedId}
                    lastModifiedId={lastModifiedId}
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
                    activeDragData={activeDragData}
                    isDraggingUnNestable={isDraggingUnNestable}
                    isSelectionMode={isSelectionMode}
                    selectedBlockIds={selectedBlockIds}
                    onToggleBlockSelection={onToggleBlockSelection}
                    onNestedBlockEdit={onNestedBlockEdit
                      ? (sectionId, nestedIndex, block) => {
                          triggerLastModified(`${sectionId}-nested-${nestedIndex}`);
                          onNestedBlockEdit(sectionId, nestedIndex, block);
                        }
                      : undefined}
                    onNestedBlockDelete={onNestedBlockDelete}
                    onNestedBlockDuplicate={onNestedBlockDuplicate}
                    onInsertBlockInSection={onInsertBlockInSection}
                    justDroppedId={justDroppedId}
                    lastModifiedId={lastModifiedId}
                  />
                )}

                {activeId !== null && !isRootZoneRedundant(index + 1) && (
                  <DroppableInsertZone
                    id={`root-zone-${index + 1}`}
                    data={{ type: 'root-zone', index: index + 1 }}
                    isActive={activeDropZone === `root-zone-${index + 1}`}
                    label={isDraggingNestable ? '📤 Move out' : '📍 Move here'}
                    enlarged={isDraggingUnNestable}
                  />
                )}
                {activeId === null && (
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
