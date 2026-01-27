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
import { SortableBlock, DroppableInsertZone, DragData, DropZoneData } from './dnd-helpers';
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
  const [activeDragData, setActiveDragData] = useState<DragData | null>(null);
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
      // Guard against nesting sections/conditionals
      if (activeData.blockType === 'section' || activeData.blockType === 'conditional') {
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
      if (activeData.blockType === 'section' || activeData.blockType === 'conditional') {
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
   * Handle drop on root zone (unnesting from section/conditional)
   */
  const handleDropOnRootZone = useCallback(
    (activeData: DragData, insertIndex: number) => {
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
    [onUnnestBlock, onUnnestBlockFromConditional]
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

      // Route to appropriate handler based on drop zone type
      switch (overData.type) {
        case 'section-insert':
          if (overData.sectionId !== undefined && overData.index !== undefined) {
            handleDropOnSectionInsert(activeIdStr, activeData, overData.sectionId, overData.index);
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
          }
          break;

        case 'section-drop':
          if (overData.sectionId !== undefined) {
            handleDropOnSectionDrop(activeIdStr, activeData, overData.sectionId);
          }
          break;

        case 'conditional-drop':
          if (overData.conditionalId !== undefined && overData.branch !== undefined) {
            handleDropOnConditionalDrop(activeIdStr, activeData, overData.conditionalId, overData.branch);
          }
          break;

        case 'root-zone':
          if (overData.index !== undefined) {
            handleDropOnRootZone(activeData, overData.index);
          }
          break;

        case 'root':
        case 'nested':
        case 'conditional':
          handleSortableReorder(activeData, overData as DragData);
          break;
      }
    },
    [
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

  // Derive drag state flags from stored activeDragData
  const isDraggingNestable =
    activeDragData !== null && (activeDragData.type === 'nested' || activeDragData.type === 'conditional');

  const isDraggingUnNestable =
    activeDragData !== null &&
    activeDragData.type === 'root' &&
    (activeDragData.blockType === 'section' || activeDragData.blockType === 'conditional');

  const isDropZoneRedundant = useCallback(
    (zoneIndex: number) => {
      if (!activeDragData || activeDragData.type !== 'root') {
        return false;
      }
      return zoneIndex === activeDragData.index || zoneIndex === activeDragData.index + 1;
    },
    [activeDragData]
  );

  return (
    <DndContext
      sensors={activeSensors}
      collisionDetection={pointerWithin}
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
            data={{ type: 'root-zone', index: 0 }}
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
                    data={{ type: 'root-zone', index: index + 1 }}
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
