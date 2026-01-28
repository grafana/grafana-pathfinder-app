/**
 * Section Nested Blocks
 *
 * Renders the nested blocks within a section block, including
 * drag-and-drop reordering and drop zone for nesting.
 */

import React, { useMemo } from 'react';
import { useDroppable, UniqueIdentifier } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { getNestedStyles } from './BlockList.styles';
import { BlockPalette } from './BlockPalette';
import { NestedBlockItem } from './NestedBlockItem';
import { SortableBlock, DragData, DroppableInsertZone, DropZoneData, isInsertZoneRedundant } from './dnd-helpers';
import type { EditorBlock, BlockType, JsonBlock } from './types';

export interface SectionNestedBlocksProps {
  block: EditorBlock;
  sectionBlocks: JsonBlock[];
  isCollapsed: boolean;
  nestedStyles: ReturnType<typeof getNestedStyles>;
  activeId: UniqueIdentifier | null;
  activeDropZone: string | null;
  activeDragData: DragData | null;
  isDraggingUnNestable: boolean;
  isSelectionMode: boolean;
  selectedBlockIds: Set<string>;
  onToggleBlockSelection?: (blockId: string) => void;
  onNestedBlockEdit?: (sectionId: string, nestedIndex: number, block: JsonBlock) => void;
  onNestedBlockDelete?: (sectionId: string, nestedIndex: number) => void;
  onNestedBlockDuplicate?: (sectionId: string, nestedIndex: number) => void;
  handleInsertInSection: (type: BlockType, sectionId: string) => void;
  /** ID of the block that was just dropped (for highlight animation) */
  justDroppedId?: string | null;
}

export function SectionNestedBlocks({
  block,
  sectionBlocks,
  isCollapsed,
  nestedStyles,
  activeId,
  activeDropZone,
  activeDragData,
  isDraggingUnNestable,
  isSelectionMode,
  selectedBlockIds,
  onToggleBlockSelection,
  onNestedBlockEdit,
  onNestedBlockDelete,
  onNestedBlockDuplicate,
  handleInsertInSection,
  justDroppedId,
}: SectionNestedBlocksProps) {
  const nestedBlockIds = useMemo(
    () => sectionBlocks.map((_, i) => `${block.id}-nested-${i}`),
    [block.id, sectionBlocks]
  );

  const { setNodeRef: setDropRef, isOver: isDropOver } = useDroppable({
    id: `section-drop-${block.id}`,
    data: { type: 'section-drop', sectionId: block.id } as DropZoneData,
    disabled: isDraggingUnNestable,
  });

  return (
    <div
      className={`${nestedStyles.nestedContainer} ${isCollapsed ? nestedStyles.nestedContainerCollapsed : ''}`}
      style={isDraggingUnNestable ? { pointerEvents: 'none' } : undefined}
    >
      {sectionBlocks.length === 0 ? (
        <div className={nestedStyles.emptySection}>Drag blocks here or click + Add block below</div>
      ) : (
        <SortableContext items={nestedBlockIds} strategy={verticalListSortingStrategy}>
          {sectionBlocks.map((nestedBlock, nestedIndex) => {
            const isZoneRedundant = isInsertZoneRedundant(activeDragData, 'section-insert', nestedIndex, block.id);
            const nestedBlockId = `${block.id}-nested-${nestedIndex}`;
            const isJustDroppedCheck = justDroppedId === nestedBlockId;
            return (
              <React.Fragment key={`${block.id}-nested-${nestedIndex}`}>
                {/* Insert zone before each block (during drag only, skip redundant zones) */}
                {activeId !== null && !isDraggingUnNestable && !isZoneRedundant && (
                  <DroppableInsertZone
                    id={`section-insert-${block.id}-${nestedIndex}`}
                    data={{ type: 'section-insert', sectionId: block.id, index: nestedIndex }}
                    isActive={activeDropZone === `section-insert-${block.id}-${nestedIndex}`}
                    label="📍 Insert here"
                  />
                )}
                <SortableBlock
                  id={`${block.id}-nested-${nestedIndex}`}
                  data={
                    {
                      type: 'nested',
                      blockType: nestedBlock.type,
                      index: nestedIndex,
                      sectionId: block.id,
                    } as DragData
                  }
                  disabled={isSelectionMode}
                  passThrough={isDraggingUnNestable}
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
                      isJustDropped={isJustDroppedCheck}
                    />
                  </div>
                </SortableBlock>
              </React.Fragment>
            );
          })}
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

// Add display name for debugging
SectionNestedBlocks.displayName = 'SectionNestedBlocks';
