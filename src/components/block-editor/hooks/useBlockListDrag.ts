/**
 * useBlockListDrag Hook
 *
 * Encapsulates all drag-and-drop state and handlers for the BlockList component.
 * Manages dragging of root blocks, nested blocks within sections, and blocks
 * within conditional branches.
 */

import { useState, useRef, useCallback } from 'react';
import type { EditorBlock } from '../types';

// Type definitions for drag state
export interface DraggedNestedBlock {
  sectionId: string;
  index: number;
}

export interface DraggedConditionalBlock {
  conditionalId: string;
  branch: 'whenTrue' | 'whenFalse';
  index: number;
}

export interface DragOverNestedZone {
  sectionId: string;
  index: number;
}

export interface DragOverConditionalZone {
  conditionalId: string;
  branch: 'whenTrue' | 'whenFalse';
  index: number;
}

export interface UseBlockListDragOptions {
  blocks: EditorBlock[];
  onBlockMove: (fromIndex: number, toIndex: number) => void;
  onNestBlock?: (blockId: string, sectionId: string, insertIndex?: number) => void;
  onUnnestBlock?: (nestedBlockId: string, sectionId: string) => void;
  onNestedBlockMove?: (sectionId: string, fromIndex: number, toIndex: number) => void;
  onNestBlockInConditional?: (
    blockId: string,
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    insertIndex?: number
  ) => void;
  onUnnestBlockFromConditional?: (
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    nestedIndex: number,
    insertAtRootIndex?: number
  ) => void;
  onConditionalBranchBlockMove?: (
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    fromIndex: number,
    toIndex: number
  ) => void;
  onMoveBlockBetweenConditionalBranches?: (
    conditionalId: string,
    fromBranch: 'whenTrue' | 'whenFalse',
    fromIndex: number,
    toBranch: 'whenTrue' | 'whenFalse',
    toIndex?: number
  ) => void;
}

export interface UseBlockListDragReturn {
  // State
  isDragging: boolean;
  draggedBlockId: string | null;
  draggedBlockIndex: number | null;
  draggedNestedBlock: DraggedNestedBlock | null;
  draggedConditionalBlock: DraggedConditionalBlock | null;
  dragOverSectionId: string | null;
  dragOverRootZone: number | null;
  dragOverReorderZone: number | null;
  dragOverNestedZone: DragOverNestedZone | null;
  dragOverConditionalZone: DragOverConditionalZone | null;
  hoveredInsertIndex: number | null;

  // State setters needed in render
  setHoveredInsertIndex: (index: number | null) => void;
  setDragOverConditionalZone: (zone: DragOverConditionalZone | null) => void;
  setDragOverNestedZone: (zone: DragOverNestedZone | null) => void;
  setDraggedBlockId: (id: string | null) => void;
  setDraggedBlockIndex: (index: number | null) => void;
  setDraggedConditionalBlock: (block: DraggedConditionalBlock | null) => void;

  // Root block handlers
  handleDragStart: (e: React.DragEvent, blockId: string, blockType: string, index: number) => void;
  handleDragEnd: () => void;
  handleDragOverReorder: (e: React.DragEvent, targetIndex: number) => void;
  handleDragLeaveReorder: () => void;
  handleDropReorder: (targetIndex: number) => void;

  // Section handlers
  handleDropOnSection: (sectionId: string) => void;
  handleDragOverSection: (e: React.DragEvent, sectionId: string) => void;
  handleDragLeaveSection: () => void;

  // Nested block handlers
  handleNestedDragStart: (e: React.DragEvent, sectionId: string, nestedIndex: number) => void;
  handleNestedDragEnd: () => void;
  handleDragOverNestedReorder: (e: React.DragEvent, sectionId: string, targetIndex: number) => void;
  handleDragLeaveNestedReorder: () => void;
  handleDropNestedReorder: (sectionId: string, targetIndex: number) => void;

  // Conditional block handlers
  handleConditionalDragStart: (
    e: React.DragEvent,
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    nestedIndex: number
  ) => void;
  handleConditionalDragEnd: () => void;

  // Root zone handlers (for unnesting)
  handleDropOnRootZone: (insertIndex: number) => void;
  handleDragOverRootZone: (e: React.DragEvent, index: number) => void;
  handleDragLeaveRootZone: () => void;

  // Helpers
  isRootDropZoneRedundant: (zoneIndex: number) => boolean;
}

/**
 * Custom hook for managing drag-and-drop state in BlockList
 */
export function useBlockListDrag({
  blocks,
  onBlockMove,
  onNestBlock,
  onUnnestBlock,
  onNestedBlockMove,
  onUnnestBlockFromConditional,
}: UseBlockListDragOptions): UseBlockListDragReturn {
  // Hover state for insert zones
  const [hoveredInsertIndex, setHoveredInsertIndex] = useState<number | null>(null);

  // Root block drag state
  const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null);
  const [draggedBlockIndex, setDraggedBlockIndex] = useState<number | null>(null);

  // Nested block drag state
  const [draggedNestedBlock, setDraggedNestedBlock] = useState<DraggedNestedBlock | null>(null);

  // Conditional block drag state
  const [draggedConditionalBlock, setDraggedConditionalBlock] = useState<DraggedConditionalBlock | null>(null);

  // Drop zone highlight state
  const [dragOverSectionId, setDragOverSectionId] = useState<string | null>(null);
  const [dragOverRootZone, setDragOverRootZone] = useState<number | null>(null);
  const [dragOverReorderZone, setDragOverReorderZone] = useState<number | null>(null);
  const [dragOverNestedZone, setDragOverNestedZone] = useState<DragOverNestedZone | null>(null);
  const [dragOverConditionalZone, setDragOverConditionalZone] = useState<DragOverConditionalZone | null>(null);

  // Use refs to track drag state without causing re-renders during drag start
  const dragStateRef = useRef<{
    rootBlockId: string | null;
    rootBlockIndex: number | null;
    nestedBlock: DraggedNestedBlock | null;
    conditionalBlock: DraggedConditionalBlock | null;
  }>({ rootBlockId: null, rootBlockIndex: null, nestedBlock: null, conditionalBlock: null });

  // Check if any drag operation is active
  const isDragging = draggedBlockId !== null || draggedNestedBlock !== null || draggedConditionalBlock !== null;

  // ============================================================================
  // Root Block Handlers
  // ============================================================================

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

  // ============================================================================
  // Section Handlers
  // ============================================================================

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

  // Drag over handler for sections
  const handleDragOverSection = useCallback((e: React.DragEvent, sectionId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverSectionId(sectionId);
  }, []);

  // Drag leave handler for sections
  const handleDragLeaveSection = useCallback(() => {
    setDragOverSectionId(null);
  }, []);

  // ============================================================================
  // Nested Block Handlers
  // ============================================================================

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

  // ============================================================================
  // Conditional Block Handlers
  // ============================================================================

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

  // ============================================================================
  // Root Zone Handlers (for unnesting)
  // ============================================================================

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

  // ============================================================================
  // Helpers
  // ============================================================================

  // Check if a root drop zone would be redundant (same position as dragged block)
  const isRootDropZoneRedundant = useCallback(
    (zoneIndex: number) => {
      if (draggedBlockIndex === null) {
        return false;
      }
      // Zone at draggedBlockIndex or draggedBlockIndex + 1 would result in same position
      return zoneIndex === draggedBlockIndex || zoneIndex === draggedBlockIndex + 1;
    },
    [draggedBlockIndex]
  );

  return {
    // State
    isDragging,
    draggedBlockId,
    draggedBlockIndex,
    draggedNestedBlock,
    draggedConditionalBlock,
    dragOverSectionId,
    dragOverRootZone,
    dragOverReorderZone,
    dragOverNestedZone,
    dragOverConditionalZone,
    hoveredInsertIndex,

    // State setters needed in render
    setHoveredInsertIndex,
    setDragOverConditionalZone,
    setDragOverNestedZone,
    setDraggedBlockId,
    setDraggedBlockIndex,
    setDraggedConditionalBlock,

    // Root block handlers
    handleDragStart,
    handleDragEnd,
    handleDragOverReorder,
    handleDragLeaveReorder,
    handleDropReorder,

    // Section handlers
    handleDropOnSection,
    handleDragOverSection,
    handleDragLeaveSection,

    // Nested block handlers
    handleNestedDragStart,
    handleNestedDragEnd,
    handleDragOverNestedReorder,
    handleDragLeaveNestedReorder,
    handleDropNestedReorder,

    // Conditional block handlers
    handleConditionalDragStart,
    handleConditionalDragEnd,

    // Root zone handlers
    handleDropOnRootZone,
    handleDragOverRootZone,
    handleDragLeaveRootZone,

    // Helpers
    isRootDropZoneRedundant,
  };
}
