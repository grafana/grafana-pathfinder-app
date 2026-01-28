/**
 * Conditional Branches
 *
 * Renders the branches (whenTrue/whenFalse) of a conditional block,
 * including drag-and-drop reordering and drop zones for nesting.
 */

import React, { useMemo } from 'react';
import { IconButton } from '@grafana/ui';
import { useDroppable, UniqueIdentifier } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { getNestedStyles, getConditionalStyles } from './BlockList.styles';
import { BlockPalette } from './BlockPalette';
import { NestedBlockItem } from './NestedBlockItem';
import { SortableBlock, DragData, DroppableInsertZone, DropZoneData, isInsertZoneRedundant } from './dnd-helpers';
import type { EditorBlock, BlockType, JsonBlock } from './types';
import { type JsonConditionalBlock } from '../../types/json-guide.types';

export interface ConditionalBranchesProps {
  block: EditorBlock;
  isCollapsed: boolean;
  conditionalStyles: ReturnType<typeof getConditionalStyles>;
  nestedStyles: ReturnType<typeof getNestedStyles>;
  activeId: UniqueIdentifier | null;
  activeDropZone: string | null;
  activeDragData: DragData | null;
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
  /** ID of the block that was just dropped (for highlight animation) */
  justDroppedId?: string | null;
}

export function ConditionalBranches({
  block,
  isCollapsed,
  conditionalStyles,
  nestedStyles,
  activeId,
  activeDropZone,
  activeDragData,
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
  justDroppedId,
}: ConditionalBranchesProps) {
  const conditionalBlock = block.block as JsonConditionalBlock;

  return (
    <div
      className={`${conditionalStyles.conditionalContainer} ${isCollapsed ? conditionalStyles.conditionalContainerCollapsed : ''}`}
      style={isDraggingUnNestable ? { pointerEvents: 'none' } : undefined}
    >
      {/* Conditions badge */}
      <div className={conditionalStyles.conditionsBadge}>Conditions: {conditionalBlock.conditions.join(', ')}</div>

      {/* True branch */}
      <ConditionalBranch
        block={block}
        branch="whenTrue"
        blocks={conditionalBlock.whenTrue}
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
        onConditionalBranchBlockEdit={onConditionalBranchBlockEdit}
        onConditionalBranchBlockDelete={onConditionalBranchBlockDelete}
        onConditionalBranchBlockDuplicate={onConditionalBranchBlockDuplicate}
        onInsertBlockInConditional={onInsertBlockInConditional}
        justDroppedId={justDroppedId}
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
        activeDragData={activeDragData}
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
        justDroppedId={justDroppedId}
      />
    </div>
  );
}

interface ConditionalBranchProps {
  block: EditorBlock;
  branch: 'whenTrue' | 'whenFalse';
  blocks: JsonBlock[];
  conditionalStyles: ReturnType<typeof getConditionalStyles>;
  nestedStyles: ReturnType<typeof getNestedStyles>;
  activeId: UniqueIdentifier | null;
  activeDropZone: string | null;
  activeDragData: DragData | null;
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
  /** ID of the block that was just dropped (for highlight animation) */
  justDroppedId?: string | null;
}

function ConditionalBranch({
  block,
  branch,
  blocks,
  conditionalStyles,
  nestedStyles,
  activeId,
  activeDropZone,
  activeDragData,
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
  justDroppedId,
}: ConditionalBranchProps) {
  const isTrue = branch === 'whenTrue';
  const branchKey = isTrue ? 'true' : 'false';
  const dropZoneId = `conditional-${branchKey}-${block.id}`;

  const nestedBlockIds = useMemo(
    () => blocks.map((_, i) => `${block.id}-${branchKey}-${i}`),
    [block.id, branchKey, blocks]
  );

  const { setNodeRef: setDropRef, isOver: isDropOver } = useDroppable({
    id: dropZoneId,
    data: { type: 'conditional-drop', conditionalId: block.id, branch } as DropZoneData,
    disabled: isDraggingUnNestable,
  });

  const isRecording =
    recordingIntoConditionalBranch?.conditionalId === block.id && recordingIntoConditionalBranch?.branch === branch;

  return (
    <div
      className={`${conditionalStyles.branchContainer} ${isTrue ? conditionalStyles.trueBranch : conditionalStyles.falseBranch}`}
    >
      <div
        className={`${conditionalStyles.branchHeader} ${isTrue ? conditionalStyles.branchHeaderTrue : conditionalStyles.branchHeaderFalse}`}
      >
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
          {blocks.map((nestedBlock, nestedIndex) => {
            const isZoneRedundant = isInsertZoneRedundant(
              activeDragData,
              'conditional-insert',
              nestedIndex,
              undefined,
              block.id,
              branch
            );
            return (
              <React.Fragment key={`${block.id}-${branchKey}-${nestedIndex}`}>
                {/* Insert zone before each block (during drag only, skip redundant zones) */}
                {activeId !== null && !isDraggingUnNestable && !isZoneRedundant && (
                  <DroppableInsertZone
                    id={`conditional-insert-${branchKey}-${block.id}-${nestedIndex}`}
                    data={{ type: 'conditional-insert', conditionalId: block.id, branch, index: nestedIndex }}
                    isActive={activeDropZone === `conditional-insert-${branchKey}-${block.id}-${nestedIndex}`}
                    label="📍 Insert here"
                  />
                )}
                <SortableBlock
                  id={`${block.id}-${branchKey}-${nestedIndex}`}
                  data={
                    {
                      type: 'conditional',
                      blockType: nestedBlock.type,
                      index: nestedIndex,
                      conditionalId: block.id,
                      branch,
                    } as DragData
                  }
                  disabled={isSelectionMode}
                  passThrough={isDraggingUnNestable}
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
                      isJustDropped={justDroppedId === `${block.id}-${branchKey}-${nestedIndex}`}
                    />
                  </div>
                </SortableBlock>
              </React.Fragment>
            );
          })}
        </SortableContext>
      )}

      {/* Drop zone for branch */}
      {activeId !== null && !isDraggingUnNestable && (
        <div
          ref={setDropRef}
          className={`${nestedStyles.dropZone} ${isDropOver || activeDropZone === dropZoneId ? nestedStyles.dropZoneActive : ''}`}
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

// Add display names for debugging
ConditionalBranches.displayName = 'ConditionalBranches';
ConditionalBranch.displayName = 'ConditionalBranch';
