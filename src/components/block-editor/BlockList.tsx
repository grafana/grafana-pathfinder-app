/**
 * Block List
 *
 * Renders the list of blocks with drag-and-drop reordering using @dnd-kit.
 * Supports nesting into section blocks and conditional branches.
 */

import React, { useCallback, useState, useMemo, useRef, useEffect } from 'react';
import { useStyles2, IconButton } from '@grafana/ui';
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
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { getBlockListStyles } from './block-editor.styles';
import { getNestedStyles, getConditionalStyles } from './BlockList.styles';
import { BlockItem } from './BlockItem';
import { BlockPalette } from './BlockPalette';
import { NestedBlockItem } from './NestedBlockItem';
import type { EditorBlock, BlockType, JsonBlock } from './types';
import {
  isSectionBlock as checkIsSectionBlock,
  isConditionalBlock as checkIsConditionalBlock,
  type JsonSectionBlock,
  type JsonConditionalBlock,
} from '../../types/json-guide.types';

// Styles for @dnd-kit sortable items
const getSortableStyles = (theme: GrafanaTheme2) => ({
  sortableItem: css({
    cursor: 'grab',
    touchAction: 'none',
    '&:active': {
      cursor: 'grabbing',
    },
  }),
  dragging: css({
    opacity: 0.4,
    cursor: 'grabbing',
  }),
  dropIndicator: css({
    position: 'relative',
    padding: theme.spacing(0.5),
    transition: 'all 0.15s ease',
  }),
  dropIndicatorLine: css({
    height: '2px',
    backgroundColor: theme.colors.border.medium,
    borderRadius: '2px',
    transition: 'all 0.15s ease',
  }),
  dropIndicatorLineActive: css({
    height: '4px',
    backgroundColor: theme.colors.primary.main,
    boxShadow: `0 0 8px ${theme.colors.primary.main}`,
  }),
  dropIndicatorLabel: css({
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
 * Data attached to draggable items for @dnd-kit
 */
interface DragData {
  type: 'root' | 'nested' | 'conditional';
  blockType: string;
  index: number;
  sectionId?: string;
  conditionalId?: string;
  branch?: 'whenTrue' | 'whenFalse';
}

/**
 * Sortable wrapper for block items
 */
function SortableBlock({
  id,
  data,
  disabled,
  children,
}: {
  id: string;
  data: DragData;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const sortableStyles = useStyles2(getSortableStyles);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data,
    disabled,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cx(sortableStyles.sortableItem, isDragging && sortableStyles.dragging)}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

/**
 * Drop indicator component
 */
function DropIndicator({ isActive, label }: { isActive: boolean; label: string }) {
  const sortableStyles = useStyles2(getSortableStyles);
  return (
    <div className={sortableStyles.dropIndicator}>
      <div className={cx(sortableStyles.dropIndicatorLine, isActive && sortableStyles.dropIndicatorLineActive)} />
      {isActive && <div className={sortableStyles.dropIndicatorLabel}>{label}</div>}
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
}: BlockListProps) {
  const styles = useStyles2(getBlockListStyles);
  const nestedStyles = useStyles2(getNestedStyles);
  const conditionalStyles = useStyles2(getConditionalStyles);

  // Collapse state for sections and conditional blocks
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  // Track which drop zone is active
  const [activeDropZone, setActiveDropZone] = useState<string | null>(null);

  // Track the currently dragging item
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);

  // Hover state for insert zones (when not dragging)
  const [hoveredInsertIndex, setHoveredInsertIndex] = useState<number | null>(null);

  // Auto-expand timeout ref
  const autoExpandTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

  // Configure @dnd-kit sensors
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 8 },
  });
  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
  });
  const sensors = useSensors(pointerSensor, keyboardSensor);

  // Disable sensors in selection mode
  const activeSensors = useMemo(() => (isSelectionMode ? [] : sensors), [isSelectionMode, sensors]);

  // Get IDs for SortableContext
  const rootBlockIds = useMemo(() => blocks.map((b) => b.id), [blocks]);

  // Get dragged item data
  const getDragData = useCallback((id: UniqueIdentifier): DragData | null => {
    const idStr = String(id);
    
    // Check if it's a root block
    const rootIndex = blocks.findIndex((b) => b.id === idStr);
    if (rootIndex >= 0) {
      return {
        type: 'root',
        blockType: blocks[rootIndex].block.type,
        index: rootIndex,
      };
    }

    // Check if it's a nested block (format: sectionId-nested-index)
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

    // Check if it's a conditional block (format: conditionalId-branch-index)
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

  // Handle drag start
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id);
  }, []);

  // Handle drag over - for auto-expand collapsed sections
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

    // Auto-expand collapsed sections/conditionals when hovering
    if (overId.startsWith('section-drop-') || overId.startsWith('conditional-')) {
      const blockId = overId.replace('section-drop-', '').replace(/^conditional-(true|false)-/, '');
      if (collapsedSections.has(blockId)) {
        // Clear any existing timeout
        if (autoExpandTimeoutRef.current) {
          clearTimeout(autoExpandTimeoutRef.current);
        }
        // Set new timeout to auto-expand after 500ms
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

  // Handle drag end - perform the actual move/nest operations
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

    const activeData = getDragData(active.id);
    if (!activeData) {
      return;
    }

    const overId = String(over.id);

    // Handle drop on section drop zone
    if (overId.startsWith('section-drop-')) {
      const sectionId = overId.replace('section-drop-', '');
      
      // Block type constraints: sections and conditionals cannot be nested
      if (activeData.blockType === 'section' || activeData.blockType === 'conditional') {
        return;
      }

      if (activeData.type === 'root' && onNestBlock) {
        const rootBlock = blocks.find((b) => b.id === String(active.id));
        if (rootBlock) {
          onNestBlock(rootBlock.id, sectionId);
        }
      } else if (activeData.type === 'nested' && activeData.sectionId !== sectionId && onUnnestBlock && onNestBlock) {
        // Moving from one section to another - unnest then nest
        // This needs special handling - for now just support within-section moves
      }
      return;
    }

    // Handle drop on conditional branch drop zone
    if (overId.startsWith('conditional-')) {
      const match = overId.match(/^conditional-(true|false)-(.+)$/);
      if (match) {
        const [, branchStr, conditionalId] = match;
        const branch = branchStr === 'true' ? 'whenTrue' : 'whenFalse';

        // Block type constraints: sections and conditionals cannot be nested
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

    // Handle drop on root zone (unnesting)
    if (overId.startsWith('root-zone-')) {
      const insertIndex = parseInt(overId.replace('root-zone-', ''), 10);

      if (activeData.type === 'nested' && activeData.sectionId && onUnnestBlock) {
        onUnnestBlock(`${activeData.sectionId}-${activeData.index}`, activeData.sectionId);
      } else if (activeData.type === 'conditional' && activeData.conditionalId && activeData.branch && onUnnestBlockFromConditional) {
        onUnnestBlockFromConditional(activeData.conditionalId, activeData.branch, activeData.index, insertIndex);
      }
      return;
    }

    // Handle root block reordering
    if (activeData.type === 'root') {
      const overData = getDragData(over.id);
      if (overData?.type === 'root' && activeData.index !== overData.index) {
        onBlockMove(activeData.index, overData.index);
      }
      return;
    }

    // Handle nested block reordering within same section
    if (activeData.type === 'nested' && activeData.sectionId) {
      const overIdMatch = overId.match(/^(.+)-nested-(\d+)$/);
      if (overIdMatch && overIdMatch[1] === activeData.sectionId && onNestedBlockMove) {
        const toIndex = parseInt(overIdMatch[2], 10);
        if (activeData.index !== toIndex) {
          const adjustedTo = toIndex > activeData.index ? toIndex : toIndex;
          onNestedBlockMove(activeData.sectionId, activeData.index, adjustedTo);
        }
      }
      return;
    }

    // Handle conditional block reordering
    if (activeData.type === 'conditional' && activeData.conditionalId && activeData.branch) {
      const overMatch = overId.match(/^(.+)-(true|false)-(\d+)$/);
      if (overMatch) {
        const [, overConditionalId, overBranchStr, overIndexStr] = overMatch;
        const overBranch = overBranchStr === 'true' ? 'whenTrue' : 'whenFalse';
        const overIndex = parseInt(overIndexStr, 10);

        if (overConditionalId === activeData.conditionalId) {
          if (activeData.branch === overBranch && onConditionalBranchBlockMove) {
            // Same branch - reorder
            if (activeData.index !== overIndex) {
              onConditionalBranchBlockMove(activeData.conditionalId, activeData.branch, activeData.index, overIndex);
            }
          } else if (onMoveBlockBetweenConditionalBranches) {
            // Cross-branch move
            onMoveBlockBetweenConditionalBranches(
              activeData.conditionalId,
              activeData.branch,
              activeData.index,
              overBranch,
              overIndex
            );
          }
        }
      }
    }
  }, [blocks, getDragData, onBlockMove, onNestBlock, onUnnestBlock, onNestedBlockMove, onNestBlockInConditional, onUnnestBlockFromConditional, onConditionalBranchBlockMove, onMoveBlockBetweenConditionalBranches]);

  // Handle drag cancel
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

  // Handle inserting block in section
  const handleInsertInSection = useCallback(
    (type: BlockType, sectionId: string) => {
      if (onInsertBlockInSection) {
        onInsertBlockInSection(type, sectionId);
      }
    },
    [onInsertBlockInSection]
  );

  // Check if we're currently dragging something that can be unnested (nested or conditional block)
  const isDraggingNestable = activeId !== null && (() => {
    const data = getDragData(activeId);
    return data?.type === 'nested' || data?.type === 'conditional';
  })();

  // Check if current drag is a root block that can't be nested (section or conditional)
  const isDraggingUnNestable = activeId !== null && (() => {
    const data = getDragData(activeId);
    return data?.type === 'root' && (data.blockType === 'section' || data.blockType === 'conditional');
  })();

  // Check if drop zone would be redundant
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
        {/* Drop zone at the top for reordering or unnesting */}
        {activeId !== null && !isDropZoneRedundant(0) && (
          <DroppableInsertZone
            id="root-zone-0"
            isActive={activeDropZone === 'root-zone-0'}
            label={isDraggingNestable ? '📤 Move out' : '📍 Move here'}
          />
        )}
        {/* Insert zone at top when not dragging */}
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

                {/* Render conditional block branches */}
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

                {/* Render nested blocks for sections */}
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

                {/* Drop zone after each block for reordering or unnesting */}
                {activeId !== null && !isDropZoneRedundant(index + 1) && (
                  <DroppableInsertZone
                    id={`root-zone-${index + 1}`}
                    isActive={activeDropZone === `root-zone-${index + 1}`}
                    label={isDraggingNestable ? '📤 Move out' : '📍 Move here'}
                  />
                )}
                {/* Insert zone after block when not dragging */}
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

/**
 * Droppable insert zone component using @dnd-kit
 */
function DroppableInsertZone({ id, isActive, label }: { id: string; isActive: boolean; label: string }) {
  const { setNodeRef, isOver } = require('@dnd-kit/core').useDroppable({ id });

  return (
    <div ref={setNodeRef} style={{ padding: '4px 0' }}>
      <DropIndicator isActive={isActive || isOver} label={label} />
    </div>
  );
}

/**
 * Section nested blocks component
 */
interface SectionNestedBlocksProps {
  block: EditorBlock;
  sectionBlocks: JsonBlock[];
  isCollapsed: boolean;
  nestedStyles: ReturnType<typeof getNestedStyles>;
  activeId: UniqueIdentifier | null;
  activeDropZone: string | null;
  isDraggingUnNestable: boolean;
  isSelectionMode: boolean;
  selectedBlockIds: Set<string>;
  onToggleBlockSelection?: (blockId: string) => void;
  onNestedBlockEdit?: (sectionId: string, nestedIndex: number, block: JsonBlock) => void;
  onNestedBlockDelete?: (sectionId: string, nestedIndex: number) => void;
  onNestedBlockDuplicate?: (sectionId: string, nestedIndex: number) => void;
  handleInsertInSection: (type: BlockType, sectionId: string) => void;
}

function SectionNestedBlocks({
  block,
  sectionBlocks,
  isCollapsed,
  nestedStyles,
  activeId,
  activeDropZone,
  isDraggingUnNestable,
  isSelectionMode,
  selectedBlockIds,
  onToggleBlockSelection,
  onNestedBlockEdit,
  onNestedBlockDelete,
  onNestedBlockDuplicate,
  handleInsertInSection,
}: SectionNestedBlocksProps) {
  const nestedBlockIds = useMemo(
    () => sectionBlocks.map((_, i) => `${block.id}-nested-${i}`),
    [block.id, sectionBlocks]
  );

  // Use droppable for the section drop zone
  const { setNodeRef: setDropRef, isOver: isDropOver } = require('@dnd-kit/core').useDroppable({
    id: `section-drop-${block.id}`,
    disabled: isDraggingUnNestable,
  });

  return (
    <div className={`${nestedStyles.nestedContainer} ${isCollapsed ? nestedStyles.nestedContainerCollapsed : ''}`}>
      {sectionBlocks.length === 0 ? (
        <div className={nestedStyles.emptySection}>Drag blocks here or click + Add block below</div>
      ) : (
        <SortableContext items={nestedBlockIds} strategy={verticalListSortingStrategy}>
          {sectionBlocks.map((nestedBlock, nestedIndex) => (
            <SortableBlock
              key={`${block.id}-nested-${nestedIndex}`}
              id={`${block.id}-nested-${nestedIndex}`}
              data={{
                type: 'nested',
                blockType: nestedBlock.type,
                index: nestedIndex,
                sectionId: block.id,
              }}
              disabled={isSelectionMode}
            >
              <div style={{ marginBottom: '8px' }}>
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
            </SortableBlock>
          ))}
        </SortableContext>
      )}

      {/* Drop zone for section */}
      <div
        ref={setDropRef}
        className={`${nestedStyles.dropZone} ${(isDropOver || activeDropZone === `section-drop-${block.id}`) && !isDraggingUnNestable ? nestedStyles.dropZoneActive : ''}`}
      >
        {activeId !== null && !isDraggingUnNestable ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px' }}>
            {isDropOver || activeDropZone === `section-drop-${block.id}` ? (
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
  );
}

/**
 * Conditional branches component
 */
interface ConditionalBranchesProps {
  block: EditorBlock;
  isCollapsed: boolean;
  conditionalStyles: ReturnType<typeof getConditionalStyles>;
  nestedStyles: ReturnType<typeof getNestedStyles>;
  activeId: UniqueIdentifier | null;
  activeDropZone: string | null;
  isDraggingUnNestable: boolean;
  isSelectionMode: boolean;
  selectedBlockIds: Set<string>;
  onToggleBlockSelection?: (blockId: string) => void;
  onConditionalBranchRecord?: (conditionalId: string, branch: 'whenTrue' | 'whenFalse') => void;
  recordingIntoConditionalBranch?: { conditionalId: string; branch: 'whenTrue' | 'whenFalse' } | null;
  onConditionalBranchBlockEdit?: (
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    nestedIndex: number,
    block: JsonBlock
  ) => void;
  onConditionalBranchBlockDelete?: (
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    nestedIndex: number
  ) => void;
  onConditionalBranchBlockDuplicate?: (
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    nestedIndex: number
  ) => void;
  onInsertBlockInConditional?: (
    type: BlockType,
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    index?: number
  ) => void;
}

function ConditionalBranches({
  block,
  isCollapsed,
  conditionalStyles,
  nestedStyles,
  activeId,
  activeDropZone,
  isDraggingUnNestable,
  isSelectionMode,
  selectedBlockIds,
  onToggleBlockSelection,
  onConditionalBranchRecord,
  recordingIntoConditionalBranch,
  onConditionalBranchBlockEdit,
  onConditionalBranchBlockDelete,
  onConditionalBranchBlockDuplicate,
  onInsertBlockInConditional,
}: ConditionalBranchesProps) {
  const conditionalBlock = block.block as JsonConditionalBlock;

  return (
    <div className={`${conditionalStyles.conditionalContainer} ${isCollapsed ? conditionalStyles.conditionalContainerCollapsed : ''}`}>
      {/* Conditions badge */}
      <div className={conditionalStyles.conditionsBadge}>
        Conditions: {conditionalBlock.conditions.join(', ')}
      </div>

      {/* True branch */}
      <ConditionalBranch
        block={block}
        branch="whenTrue"
        blocks={conditionalBlock.whenTrue}
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

      {/* False branch */}
      <ConditionalBranch
        block={block}
        branch="whenFalse"
        blocks={conditionalBlock.whenFalse}
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
    </div>
  );
}

/**
 * Single conditional branch component
 */
interface ConditionalBranchProps {
  block: EditorBlock;
  branch: 'whenTrue' | 'whenFalse';
  blocks: JsonBlock[];
  conditionalStyles: ReturnType<typeof getConditionalStyles>;
  nestedStyles: ReturnType<typeof getNestedStyles>;
  activeId: UniqueIdentifier | null;
  activeDropZone: string | null;
  isDraggingUnNestable: boolean;
  isSelectionMode: boolean;
  selectedBlockIds: Set<string>;
  onToggleBlockSelection?: (blockId: string) => void;
  onConditionalBranchRecord?: (conditionalId: string, branch: 'whenTrue' | 'whenFalse') => void;
  recordingIntoConditionalBranch?: { conditionalId: string; branch: 'whenTrue' | 'whenFalse' } | null;
  onConditionalBranchBlockEdit?: (
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    nestedIndex: number,
    block: JsonBlock
  ) => void;
  onConditionalBranchBlockDelete?: (
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    nestedIndex: number
  ) => void;
  onConditionalBranchBlockDuplicate?: (
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    nestedIndex: number
  ) => void;
  onInsertBlockInConditional?: (
    type: BlockType,
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    index?: number
  ) => void;
}

function ConditionalBranch({
  block,
  branch,
  blocks,
  conditionalStyles,
  nestedStyles,
  activeId,
  activeDropZone,
  isDraggingUnNestable,
  isSelectionMode,
  selectedBlockIds,
  onToggleBlockSelection,
  onConditionalBranchRecord,
  recordingIntoConditionalBranch,
  onConditionalBranchBlockEdit,
  onConditionalBranchBlockDelete,
  onConditionalBranchBlockDuplicate,
  onInsertBlockInConditional,
}: ConditionalBranchProps) {
  const isTrue = branch === 'whenTrue';
  const branchKey = isTrue ? 'true' : 'false';
  const dropZoneId = `conditional-${branchKey}-${block.id}`;

  const nestedBlockIds = useMemo(
    () => blocks.map((_, i) => `${block.id}-${branchKey}-${i}`),
    [block.id, branchKey, blocks]
  );

  // Use droppable for the branch drop zone
  const { setNodeRef: setDropRef, isOver: isDropOver } = require('@dnd-kit/core').useDroppable({
    id: dropZoneId,
    disabled: isDraggingUnNestable,
  });

  const isRecording = recordingIntoConditionalBranch?.conditionalId === block.id && 
                      recordingIntoConditionalBranch?.branch === branch;

  return (
    <div className={`${conditionalStyles.branchContainer} ${isTrue ? conditionalStyles.trueBranch : conditionalStyles.falseBranch}`}>
      <div className={`${conditionalStyles.branchHeader} ${isTrue ? conditionalStyles.branchHeaderTrue : conditionalStyles.branchHeaderFalse}`}>
        <span className={conditionalStyles.branchIcon}>{isTrue ? '✓' : '✗'}</span>
        <span>{isTrue ? 'When conditions pass' : 'When conditions fail'}</span>
        {onConditionalBranchRecord && (
          <IconButton
            name={isRecording ? 'square-shape' : 'circle'}
            size="sm"
            aria-label={isRecording ? 'Stop recording' : 'Record into branch'}
            onClick={() => onConditionalBranchRecord(block.id, branch)}
            className={isRecording ? conditionalStyles.recordingButton : conditionalStyles.recordButton}
            tooltip={isRecording ? 'Stop recording' : 'Record into branch'}
          />
        )}
      </div>

      {blocks.length === 0 ? (
        <div className={conditionalStyles.emptyBranch}>Drag blocks here or click + Add block below</div>
      ) : (
        <SortableContext items={nestedBlockIds} strategy={verticalListSortingStrategy}>
          {blocks.map((nestedBlock, nestedIndex) => (
            <SortableBlock
              key={`${block.id}-${branchKey}-${nestedIndex}`}
              id={`${block.id}-${branchKey}-${nestedIndex}`}
              data={{
                type: 'conditional',
                blockType: nestedBlock.type,
                index: nestedIndex,
                conditionalId: block.id,
                branch,
              }}
              disabled={isSelectionMode}
            >
              <div style={{ marginBottom: '8px' }}>
                <NestedBlockItem
                  block={nestedBlock}
                  onEdit={() => onConditionalBranchBlockEdit?.(block.id, branch, nestedIndex, nestedBlock)}
                  onDelete={() => onConditionalBranchBlockDelete?.(block.id, branch, nestedIndex)}
                  onDuplicate={() => onConditionalBranchBlockDuplicate?.(block.id, branch, nestedIndex)}
                  isSelectionMode={isSelectionMode}
                  isSelected={selectedBlockIds.has(`${block.id}-${branchKey}-${nestedIndex}`)}
                  onToggleSelect={
                    onToggleBlockSelection
                      ? () => onToggleBlockSelection(`${block.id}-${branchKey}-${nestedIndex}`)
                      : undefined
                  }
                />
              </div>
            </SortableBlock>
          ))}
        </SortableContext>
      )}

      {/* Drop zone for branch */}
      {activeId !== null && !isDraggingUnNestable && (
        <div
          ref={setDropRef}
          className={`${nestedStyles.dropZone} ${(isDropOver || activeDropZone === dropZoneId) ? nestedStyles.dropZoneActive : ''}`}
          style={{ marginTop: '8px' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px' }}>
            {isDropOver || activeDropZone === dropZoneId ? (
              <>
                <span style={{ fontSize: '20px' }}>📥</span>
                <span style={{ fontWeight: 500 }}>Release to add to this branch</span>
              </>
            ) : (
              <>
                <span style={{ fontSize: '16px' }}>📥</span>
                <span>Drop here to add to branch</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Add block palette when not dragging */}
      {activeId === null && (
        <div className={nestedStyles.dropZone} style={{ marginTop: '8px' }}>
          <BlockPalette
            onSelect={(type) => onInsertBlockInConditional?.(type, block.id, branch)}
            excludeTypes={['section', 'conditional']}
            embedded
          />
        </div>
      )}
    </div>
  );
}

// Add display name for debugging
BlockList.displayName = 'BlockList';
