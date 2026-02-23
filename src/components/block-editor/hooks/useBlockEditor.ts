/**
 * useBlockEditor Hook
 *
 * State management for the block-based JSON guide editor.
 * Handles blocks array, selection, and guide metadata.
 */

import { useState, useCallback, useMemo } from 'react';
import type { EditorBlock, BlockEditorState, JsonBlock, JsonGuide, ViewMode } from '../types';
import type {
  JsonSectionBlock,
  JsonConditionalBlock,
  JsonInteractiveBlock,
  JsonMultistepBlock,
  JsonGuidedBlock,
  JsonStep,
} from '../../../types/json-guide.types';
import { DEFAULT_GUIDE_METADATA } from '../constants';

/**
 * Type guard for section blocks
 */
const isSectionBlock = (block: JsonBlock): block is JsonSectionBlock => {
  return block.type === 'section';
};

/**
 * Type guard for conditional blocks
 */
const isConditionalBlock = (block: JsonBlock): block is JsonConditionalBlock => {
  return block.type === 'conditional';
};

/**
 * Type guard for interactive blocks
 */
const isInteractiveBlock = (block: JsonBlock): block is JsonInteractiveBlock => {
  return block.type === 'interactive';
};

/**
 * Type guard for multistep blocks
 */
const isMultistepBlock = (block: JsonBlock): block is JsonMultistepBlock => {
  return block.type === 'multistep';
};

/**
 * Type guard for guided blocks
 */
const isGuidedBlock = (block: JsonBlock): block is JsonGuidedBlock => {
  return block.type === 'guided';
};

/**
 * Generate a unique ID for a block
 */
const generateBlockId = (): string => {
  return `block-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
};

/**
 * Hook options
 */
export interface UseBlockEditorOptions {
  /** Initial guide data to load */
  initialGuide?: JsonGuide;
  /** Called when guide data changes */
  onChange?: (guide: JsonGuide) => void;
}

/**
 * Hook return type
 */
export interface UseBlockEditorReturn {
  /** Current editor state */
  state: BlockEditorState;

  // Guide metadata
  /** Update guide metadata (id, title, match) */
  updateGuideMetadata: (updates: Partial<BlockEditorState['guide']>) => void;

  // Block operations
  /** Add a new block at the specified index (or end if not specified) */
  addBlock: (block: JsonBlock, index?: number) => string;
  /** Update an existing block */
  updateBlock: (id: string, block: JsonBlock) => void;
  /** Remove a block by ID */
  removeBlock: (id: string) => void;
  /** Move a block from one index to another */
  moveBlock: (fromIndex: number, toIndex: number) => void;
  /** Duplicate a block */
  duplicateBlock: (id: string) => string | null;

  // Section nesting operations
  /** Move a block into a section at a specific index */
  nestBlockInSection: (blockId: string, sectionId: string, insertIndex?: number) => void;
  /** Move a block out of a section back to root level */
  unnestBlockFromSection: (blockId: string, sectionId: string, insertAtRootIndex?: number) => void;
  /** Add a new block directly to a section */
  addBlockToSection: (block: JsonBlock, sectionId: string, index?: number) => string;
  /** Update a nested block */
  updateNestedBlock: (sectionId: string, nestedIndex: number, block: JsonBlock) => void;
  /** Delete a nested block */
  deleteNestedBlock: (sectionId: string, nestedIndex: number) => void;
  /** Duplicate a nested block */
  duplicateNestedBlock: (sectionId: string, nestedIndex: number) => void;
  /** Move a nested block within its section */
  moveNestedBlock: (sectionId: string, fromIndex: number, toIndex: number) => void;

  // View mode
  /** Set the view mode explicitly */
  setViewMode: (mode: ViewMode) => void;

  // Guide export
  /** Get the current guide as a JsonGuide object */
  getGuide: () => JsonGuide;
  /** Load a guide from JsonGuide data */
  loadGuide: (guide: JsonGuide, blockIds?: string[]) => void;
  /** Reset to a new empty guide */
  resetGuide: () => void;

  // State flags
  /** Whether there are unsaved changes */
  isDirty: boolean;
  /** Mark the current state as saved */
  markSaved: () => void;

  // Block merging operations
  /** Merge selected interactive blocks into a Multistep block */
  mergeBlocksToMultistep: (blockIds: string[]) => void;
  /** Merge selected interactive blocks into a Guided block */
  mergeBlocksToGuided: (blockIds: string[]) => void;

  // Conditional block branch operations
  /** Add a block to a conditional branch */
  addBlockToConditionalBranch: (
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    block: JsonBlock,
    index?: number
  ) => string;
  /** Update a block within a conditional branch */
  updateConditionalBranchBlock: (
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    nestedIndex: number,
    block: JsonBlock
  ) => void;
  /** Delete a block from a conditional branch */
  deleteConditionalBranchBlock: (conditionalId: string, branch: 'whenTrue' | 'whenFalse', nestedIndex: number) => void;
  /** Duplicate a block within a conditional branch */
  duplicateConditionalBranchBlock: (
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    nestedIndex: number
  ) => void;
  /** Move a block within a conditional branch */
  moveConditionalBranchBlock: (
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    fromIndex: number,
    toIndex: number
  ) => void;
  /** Nest a root block into a conditional branch */
  nestBlockInConditional: (
    blockId: string,
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    insertIndex?: number
  ) => void;
  /** Unnest a block from a conditional branch back to root level */
  unnestBlockFromConditional: (
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    nestedIndex: number,
    insertAtRootIndex?: number
  ) => void;
  /** Move a block between conditional branches (true <-> false) */
  moveBlockBetweenConditionalBranches: (
    conditionalId: string,
    fromBranch: 'whenTrue' | 'whenFalse',
    fromIndex: number,
    toBranch: 'whenTrue' | 'whenFalse',
    toIndex?: number
  ) => void;
  /** Move a block from one section to another */
  moveBlockBetweenSections: (fromSectionId: string, fromIndex: number, toSectionId: string, toIndex?: number) => void;
}

/**
 * Block editor state management hook
 */
export function useBlockEditor(options: UseBlockEditorOptions = {}): UseBlockEditorReturn {
  const { initialGuide, onChange } = options;

  // Convert initial guide to editor state
  const initialBlocks: EditorBlock[] =
    initialGuide?.blocks.map((block) => ({
      id: generateBlockId(),
      block,
    })) ?? [];

  const [state, setState] = useState<BlockEditorState>({
    guide: {
      id: initialGuide?.id ?? DEFAULT_GUIDE_METADATA.id,
      title: initialGuide?.title ?? DEFAULT_GUIDE_METADATA.title,
    },
    blocks: initialBlocks,
    viewMode: 'edit' as ViewMode,
    isDirty: false,
  });

  // Notify onChange when state changes
  const notifyChange = useCallback(
    (newState: BlockEditorState) => {
      if (onChange) {
        const guide: JsonGuide = {
          id: newState.guide.id,
          title: newState.guide.title,
          blocks: newState.blocks.map((b) => b.block),
        };
        onChange(guide);
      }
    },
    [onChange]
  );

  // Update guide metadata
  const updateGuideMetadata = useCallback(
    (updates: Partial<BlockEditorState['guide']>) => {
      setState((prev) => {
        const newState = {
          ...prev,
          guide: { ...prev.guide, ...updates },
          isDirty: true,
        };
        notifyChange(newState);
        return newState;
      });
    },
    [notifyChange]
  );

  // Add a new block
  const addBlock = useCallback(
    (block: JsonBlock, index?: number): string => {
      const id = generateBlockId();
      const newBlock: EditorBlock = { id, block };

      setState((prev) => {
        const newBlocks = [...prev.blocks];
        if (index !== undefined && index >= 0 && index <= newBlocks.length) {
          newBlocks.splice(index, 0, newBlock);
        } else {
          newBlocks.push(newBlock);
        }

        const newState = {
          ...prev,
          blocks: newBlocks,
          isDirty: true,
        };
        notifyChange(newState);
        return newState;
      });

      return id;
    },
    [notifyChange]
  );

  // Update an existing block
  const updateBlock = useCallback(
    (id: string, block: JsonBlock) => {
      setState((prev) => {
        const newBlocks = prev.blocks.map((b) => (b.id === id ? { ...b, block } : b));

        const newState = {
          ...prev,
          blocks: newBlocks,
          isDirty: true,
        };
        notifyChange(newState);
        return newState;
      });
    },
    [notifyChange]
  );

  // Remove a block
  const removeBlock = useCallback(
    (id: string) => {
      setState((prev) => {
        const newBlocks = prev.blocks.filter((b) => b.id !== id);

        const newState = {
          ...prev,
          blocks: newBlocks,
          isDirty: true,
        };
        notifyChange(newState);
        return newState;
      });
    },
    [notifyChange]
  );

  // Move a block
  const moveBlock = useCallback(
    (fromIndex: number, toIndex: number) => {
      setState((prev) => {
        if (
          fromIndex < 0 ||
          fromIndex >= prev.blocks.length ||
          toIndex < 0 ||
          toIndex >= prev.blocks.length ||
          fromIndex === toIndex
        ) {
          return prev;
        }

        const newBlocks = [...prev.blocks];
        const [removed] = newBlocks.splice(fromIndex, 1);
        newBlocks.splice(toIndex, 0, removed!);

        const newState = {
          ...prev,
          blocks: newBlocks,
          isDirty: true,
        };
        notifyChange(newState);
        return newState;
      });
    },
    [notifyChange]
  );

  // Duplicate a block
  const duplicateBlock = useCallback(
    (id: string): string | null => {
      const block = state.blocks.find((b) => b.id === id);
      if (!block) {
        return null;
      }

      const newId = generateBlockId();
      const index = state.blocks.findIndex((b) => b.id === id);

      setState((prev) => {
        const newBlocks = [...prev.blocks];
        newBlocks.splice(index + 1, 0, {
          id: newId,
          block: JSON.parse(JSON.stringify(block.block)), // Deep clone
        });

        const newState = {
          ...prev,
          blocks: newBlocks,
          isDirty: true,
        };
        notifyChange(newState);
        return newState;
      });

      return newId;
    },
    [state.blocks, notifyChange]
  );

  // Nest a block inside a section
  const nestBlockInSection = useCallback(
    (blockId: string, sectionId: string, insertIndex?: number) => {
      setState((prev) => {
        const blockIndex = prev.blocks.findIndex((b) => b.id === blockId);
        const sectionIndex = prev.blocks.findIndex((b) => b.id === sectionId);

        if (blockIndex === -1 || sectionIndex === -1) {
          return prev;
        }

        const block = prev.blocks[blockIndex];
        const sectionBlock = prev.blocks[sectionIndex];

        if (!block || !sectionBlock || block.block.type === 'section' || !isSectionBlock(sectionBlock.block)) {
          return prev;
        }

        // Remove block from root level
        const newBlocks = prev.blocks.filter((b) => b.id !== blockId);

        const section = newBlocks[sectionIndex > blockIndex ? sectionIndex - 1 : sectionIndex];
        if (section && isSectionBlock(section.block)) {
          const sectionBlocksCopy = [...section.block.blocks];
          const idx = insertIndex ?? sectionBlocksCopy.length;
          sectionBlocksCopy.splice(idx, 0, block.block);

          section.block = {
            ...section.block,
            blocks: sectionBlocksCopy,
          };
        }

        const newState = {
          ...prev,
          blocks: newBlocks,
          isDirty: true,
        };
        notifyChange(newState);
        return newState;
      });
    },
    [notifyChange]
  );

  // Unnest a block from a section back to root level
  const unnestBlockFromSection = useCallback(
    (blockId: string, sectionId: string, insertAtRootIndex?: number) => {
      setState((prev) => {
        const sectionIndex = prev.blocks.findIndex((b) => b.id === sectionId);
        if (sectionIndex === -1) {
          return prev;
        }

        const sectionEditorBlock = prev.blocks[sectionIndex];
        if (!sectionEditorBlock || !isSectionBlock(sectionEditorBlock.block)) {
          return prev;
        }

        const nestedIndex = parseInt(blockId.split('-').pop() ?? '-1', 10);
        if (nestedIndex < 0 || nestedIndex >= sectionEditorBlock.block.blocks.length) {
          return prev;
        }

        const blockToMove = sectionEditorBlock.block.blocks[nestedIndex]!;

        const newSectionBlocks = sectionEditorBlock.block.blocks.filter((_, i) => i !== nestedIndex);

        const newBlocks = [...prev.blocks];
        newBlocks[sectionIndex] = {
          ...sectionEditorBlock,
          block: {
            ...sectionEditorBlock.block,
            blocks: newSectionBlocks,
          },
        };

        const newEditorBlock: EditorBlock = {
          id: generateBlockId(),
          block: blockToMove,
        };

        const insertIdx = insertAtRootIndex ?? sectionIndex + 1;
        newBlocks.splice(insertIdx, 0, newEditorBlock);

        const newState = {
          ...prev,
          blocks: newBlocks,
          isDirty: true,
        };
        notifyChange(newState);
        return newState;
      });
    },
    [notifyChange]
  );

  // Add a block directly to a section
  const addBlockToSection = useCallback(
    (block: JsonBlock, sectionId: string, index?: number): string => {
      const id = generateBlockId();

      setState((prev) => {
        const sectionIndex = prev.blocks.findIndex((b) => b.id === sectionId);
        if (sectionIndex === -1) {
          return prev;
        }

        const sectionEditorBlock = prev.blocks[sectionIndex];
        if (!sectionEditorBlock || !isSectionBlock(sectionEditorBlock.block)) {
          return prev;
        }

        const sectionBlocksCopy = [...sectionEditorBlock.block.blocks];
        const idx = index ?? sectionBlocksCopy.length;
        sectionBlocksCopy.splice(idx, 0, block);

        const newBlocks = [...prev.blocks];
        newBlocks[sectionIndex] = {
          ...sectionEditorBlock,
          block: {
            ...sectionEditorBlock.block,
            blocks: sectionBlocksCopy,
          },
        };

        const newState = {
          ...prev,
          blocks: newBlocks,
          isDirty: true,
        };
        notifyChange(newState);
        return newState;
      });

      return id;
    },
    [notifyChange]
  );

  // Update a nested block
  const updateNestedBlock = useCallback(
    (sectionId: string, nestedIndex: number, block: JsonBlock) => {
      setState((prev) => {
        const sectionIndex = prev.blocks.findIndex((b) => b.id === sectionId);
        if (sectionIndex === -1) {
          return prev;
        }

        const sectionEditorBlock = prev.blocks[sectionIndex];
        if (!sectionEditorBlock || !isSectionBlock(sectionEditorBlock.block)) {
          return prev;
        }

        const sectionBlocksCopy = [...sectionEditorBlock.block.blocks];
        if (nestedIndex < 0 || nestedIndex >= sectionBlocksCopy.length) {
          return prev;
        }

        sectionBlocksCopy[nestedIndex] = block;

        const newBlocks = [...prev.blocks];
        newBlocks[sectionIndex] = {
          ...sectionEditorBlock,
          block: {
            ...sectionEditorBlock.block,
            blocks: sectionBlocksCopy,
          },
        };

        const newState = {
          ...prev,
          blocks: newBlocks,
          isDirty: true,
        };
        notifyChange(newState);
        return newState;
      });
    },
    [notifyChange]
  );

  // Delete a nested block
  const deleteNestedBlock = useCallback(
    (sectionId: string, nestedIndex: number) => {
      setState((prev) => {
        const sectionIndex = prev.blocks.findIndex((b) => b.id === sectionId);
        if (sectionIndex === -1) {
          return prev;
        }

        const sectionEditorBlock = prev.blocks[sectionIndex];
        if (!sectionEditorBlock || !isSectionBlock(sectionEditorBlock.block)) {
          return prev;
        }

        const sectionBlocksCopy = sectionEditorBlock.block.blocks.filter((_, i) => i !== nestedIndex);

        const newBlocks = [...prev.blocks];
        newBlocks[sectionIndex] = {
          ...sectionEditorBlock,
          block: {
            ...sectionEditorBlock.block,
            blocks: sectionBlocksCopy,
          },
        };

        const newState = {
          ...prev,
          blocks: newBlocks,
          isDirty: true,
        };
        notifyChange(newState);
        return newState;
      });
    },
    [notifyChange]
  );

  // Duplicate a nested block
  const duplicateNestedBlock = useCallback(
    (sectionId: string, nestedIndex: number) => {
      setState((prev) => {
        const sectionIndex = prev.blocks.findIndex((b) => b.id === sectionId);
        if (sectionIndex === -1) {
          return prev;
        }

        const sectionEditorBlock = prev.blocks[sectionIndex];
        if (!sectionEditorBlock || !isSectionBlock(sectionEditorBlock.block)) {
          return prev;
        }

        const sectionBlocksCopy = [...sectionEditorBlock.block.blocks];
        if (nestedIndex < 0 || nestedIndex >= sectionBlocksCopy.length) {
          return prev;
        }

        const blockToDuplicate = sectionBlocksCopy[nestedIndex]!;
        const duplicatedBlock = JSON.parse(JSON.stringify(blockToDuplicate));
        sectionBlocksCopy.splice(nestedIndex + 1, 0, duplicatedBlock);

        const newBlocks = [...prev.blocks];
        newBlocks[sectionIndex] = {
          ...sectionEditorBlock,
          block: {
            ...sectionEditorBlock.block,
            blocks: sectionBlocksCopy,
          },
        };

        const newState = {
          ...prev,
          blocks: newBlocks,
          isDirty: true,
        };
        notifyChange(newState);
        return newState;
      });
    },
    [notifyChange]
  );

  // Move a nested block within its section
  const moveNestedBlock = useCallback(
    (sectionId: string, fromIndex: number, toIndex: number) => {
      setState((prev) => {
        const sectionIndex = prev.blocks.findIndex((b) => b.id === sectionId);
        if (sectionIndex === -1) {
          return prev;
        }

        const sectionEditorBlock = prev.blocks[sectionIndex];
        if (!sectionEditorBlock || !isSectionBlock(sectionEditorBlock.block)) {
          return prev;
        }

        const sectionBlocksCopy = [...sectionEditorBlock.block.blocks];
        if (
          fromIndex < 0 ||
          fromIndex >= sectionBlocksCopy.length ||
          toIndex < 0 ||
          toIndex >= sectionBlocksCopy.length ||
          fromIndex === toIndex
        ) {
          return prev;
        }

        const [removed] = sectionBlocksCopy.splice(fromIndex, 1);
        sectionBlocksCopy.splice(toIndex, 0, removed!);

        const newBlocks = [...prev.blocks];
        newBlocks[sectionIndex] = {
          ...sectionEditorBlock,
          block: {
            ...sectionEditorBlock.block,
            blocks: sectionBlocksCopy,
          },
        };

        const newState = {
          ...prev,
          blocks: newBlocks,
          isDirty: true,
        };
        notifyChange(newState);
        return newState;
      });
    },
    [notifyChange]
  );

  // ============ Conditional branch operations ============

  // Add a block to a conditional branch
  const addBlockToConditionalBranch = useCallback(
    (conditionalId: string, branch: 'whenTrue' | 'whenFalse', block: JsonBlock, index?: number): string => {
      const id = generateBlockId();

      setState((prev) => {
        const conditionalIndex = prev.blocks.findIndex((b) => b.id === conditionalId);
        if (conditionalIndex === -1) {
          return prev;
        }

        const conditionalEditorBlock = prev.blocks[conditionalIndex];
        if (!conditionalEditorBlock || !isConditionalBlock(conditionalEditorBlock.block)) {
          return prev;
        }

        const branchBlocks = [...conditionalEditorBlock.block[branch]];
        const idx = index ?? branchBlocks.length;
        branchBlocks.splice(idx, 0, block);

        const newBlocks = [...prev.blocks];
        newBlocks[conditionalIndex] = {
          ...conditionalEditorBlock,
          block: {
            ...conditionalEditorBlock.block,
            [branch]: branchBlocks,
          },
        };

        const newState = {
          ...prev,
          blocks: newBlocks,
          isDirty: true,
        };
        notifyChange(newState);
        return newState;
      });

      return id;
    },
    [notifyChange]
  );

  // Update a block within a conditional branch
  const updateConditionalBranchBlock = useCallback(
    (conditionalId: string, branch: 'whenTrue' | 'whenFalse', nestedIndex: number, block: JsonBlock) => {
      setState((prev) => {
        const conditionalIndex = prev.blocks.findIndex((b) => b.id === conditionalId);
        if (conditionalIndex === -1) {
          return prev;
        }

        const conditionalEditorBlock = prev.blocks[conditionalIndex];
        if (!conditionalEditorBlock || !isConditionalBlock(conditionalEditorBlock.block)) {
          return prev;
        }

        const branchBlocks = [...conditionalEditorBlock.block[branch]];
        if (nestedIndex < 0 || nestedIndex >= branchBlocks.length) {
          return prev;
        }

        branchBlocks[nestedIndex] = block;

        const newBlocks = [...prev.blocks];
        newBlocks[conditionalIndex] = {
          ...conditionalEditorBlock,
          block: {
            ...conditionalEditorBlock.block,
            [branch]: branchBlocks,
          },
        };

        const newState = {
          ...prev,
          blocks: newBlocks,
          isDirty: true,
        };
        notifyChange(newState);
        return newState;
      });
    },
    [notifyChange]
  );

  // Delete a block from a conditional branch
  const deleteConditionalBranchBlock = useCallback(
    (conditionalId: string, branch: 'whenTrue' | 'whenFalse', nestedIndex: number) => {
      setState((prev) => {
        const conditionalIndex = prev.blocks.findIndex((b) => b.id === conditionalId);
        if (conditionalIndex === -1) {
          return prev;
        }

        const conditionalEditorBlock = prev.blocks[conditionalIndex];
        if (!conditionalEditorBlock || !isConditionalBlock(conditionalEditorBlock.block)) {
          return prev;
        }

        const branchBlocks = conditionalEditorBlock.block[branch].filter((_, i) => i !== nestedIndex);

        const newBlocks = [...prev.blocks];
        newBlocks[conditionalIndex] = {
          ...conditionalEditorBlock,
          block: {
            ...conditionalEditorBlock.block,
            [branch]: branchBlocks,
          },
        };

        const newState = {
          ...prev,
          blocks: newBlocks,
          isDirty: true,
        };
        notifyChange(newState);
        return newState;
      });
    },
    [notifyChange]
  );

  // Duplicate a block within a conditional branch
  const duplicateConditionalBranchBlock = useCallback(
    (conditionalId: string, branch: 'whenTrue' | 'whenFalse', nestedIndex: number) => {
      setState((prev) => {
        const conditionalIndex = prev.blocks.findIndex((b) => b.id === conditionalId);
        if (conditionalIndex === -1) {
          return prev;
        }

        const conditionalEditorBlock = prev.blocks[conditionalIndex];
        if (!conditionalEditorBlock || !isConditionalBlock(conditionalEditorBlock.block)) {
          return prev;
        }

        const branchBlocks = [...conditionalEditorBlock.block[branch]];
        if (nestedIndex < 0 || nestedIndex >= branchBlocks.length) {
          return prev;
        }

        const blockToDuplicate = branchBlocks[nestedIndex]!;
        const duplicatedBlock = JSON.parse(JSON.stringify(blockToDuplicate));
        branchBlocks.splice(nestedIndex + 1, 0, duplicatedBlock);

        const newBlocks = [...prev.blocks];
        newBlocks[conditionalIndex] = {
          ...conditionalEditorBlock,
          block: {
            ...conditionalEditorBlock.block,
            [branch]: branchBlocks,
          },
        };

        const newState = {
          ...prev,
          blocks: newBlocks,
          isDirty: true,
        };
        notifyChange(newState);
        return newState;
      });
    },
    [notifyChange]
  );

  // Move a block within a conditional branch
  const moveConditionalBranchBlock = useCallback(
    (conditionalId: string, branch: 'whenTrue' | 'whenFalse', fromIndex: number, toIndex: number) => {
      setState((prev) => {
        const conditionalIndex = prev.blocks.findIndex((b) => b.id === conditionalId);
        if (conditionalIndex === -1) {
          return prev;
        }

        const conditionalEditorBlock = prev.blocks[conditionalIndex];
        if (!conditionalEditorBlock || !isConditionalBlock(conditionalEditorBlock.block)) {
          return prev;
        }

        const branchBlocks = [...conditionalEditorBlock.block[branch]];
        if (
          fromIndex < 0 ||
          fromIndex >= branchBlocks.length ||
          toIndex < 0 ||
          toIndex > branchBlocks.length ||
          fromIndex === toIndex
        ) {
          return prev;
        }

        const [removed] = branchBlocks.splice(fromIndex, 1);
        branchBlocks.splice(toIndex, 0, removed!);

        const newBlocks = [...prev.blocks];
        newBlocks[conditionalIndex] = {
          ...conditionalEditorBlock,
          block: {
            ...conditionalEditorBlock.block,
            [branch]: branchBlocks,
          },
        };

        const newState = {
          ...prev,
          blocks: newBlocks,
          isDirty: true,
        };
        notifyChange(newState);
        return newState;
      });
    },
    [notifyChange]
  );

  // Nest a root block into a conditional branch
  const nestBlockInConditional = useCallback(
    (blockId: string, conditionalId: string, branch: 'whenTrue' | 'whenFalse', insertIndex?: number) => {
      setState((prev) => {
        // Find the block to nest
        const blockIndex = prev.blocks.findIndex((b) => b.id === blockId);
        if (blockIndex === -1) {
          return prev;
        }

        const blockToNest = prev.blocks[blockIndex];
        if (!blockToNest || blockToNest.block.type === 'section' || blockToNest.block.type === 'conditional') {
          return prev;
        }

        const conditionalIndex = prev.blocks.findIndex((b) => b.id === conditionalId);
        if (conditionalIndex === -1) {
          return prev;
        }

        const conditionalEditorBlock = prev.blocks[conditionalIndex];
        if (!conditionalEditorBlock || !isConditionalBlock(conditionalEditorBlock.block)) {
          return prev;
        }

        const newBlocks = prev.blocks.filter((_, i) => i !== blockIndex);
        const adjustedConditionalIndex = blockIndex < conditionalIndex ? conditionalIndex - 1 : conditionalIndex;

        const adjustedBlock = newBlocks[adjustedConditionalIndex];
        if (!adjustedBlock) {
          return prev;
        }
        const conditionalBlock = adjustedBlock.block as JsonConditionalBlock;
        const branchBlocks = [...conditionalBlock[branch]];
        const idx = insertIndex ?? branchBlocks.length;
        branchBlocks.splice(idx, 0, blockToNest.block);

        newBlocks[adjustedConditionalIndex] = {
          ...adjustedBlock,
          block: {
            ...conditionalBlock,
            [branch]: branchBlocks,
          } as JsonConditionalBlock,
        };

        const newState = {
          ...prev,
          blocks: newBlocks,
          isDirty: true,
        };
        notifyChange(newState);
        return newState;
      });
    },
    [notifyChange]
  );

  // Unnest a block from a conditional branch back to root level
  const unnestBlockFromConditional = useCallback(
    (conditionalId: string, branch: 'whenTrue' | 'whenFalse', nestedIndex: number, insertAtRootIndex?: number) => {
      setState((prev) => {
        // Find the conditional
        const conditionalIndex = prev.blocks.findIndex((b) => b.id === conditionalId);
        if (conditionalIndex === -1) {
          return prev;
        }

        const conditionalEditorBlock = prev.blocks[conditionalIndex];
        if (!conditionalEditorBlock || !isConditionalBlock(conditionalEditorBlock.block)) {
          return prev;
        }

        const branchBlocks = conditionalEditorBlock.block[branch];
        if (nestedIndex < 0 || nestedIndex >= branchBlocks.length) {
          return prev;
        }

        const blockToUnnest = branchBlocks[nestedIndex]!;

        // Remove from branch
        const newBranchBlocks = branchBlocks.filter((_, i) => i !== nestedIndex);

        // Update conditional
        const newBlocks = [...prev.blocks];
        newBlocks[conditionalIndex] = {
          ...conditionalEditorBlock,
          block: {
            ...conditionalEditorBlock.block,
            [branch]: newBranchBlocks,
          },
        };

        // Add to root level at specified index, or after the conditional if not specified
        const newEditorBlock: EditorBlock = {
          id: generateBlockId(),
          block: blockToUnnest,
        };
        const insertIndex = insertAtRootIndex ?? conditionalIndex + 1;
        newBlocks.splice(insertIndex, 0, newEditorBlock);

        const newState = {
          ...prev,
          blocks: newBlocks,
          isDirty: true,
        };
        notifyChange(newState);
        return newState;
      });
    },
    [notifyChange]
  );

  // Move a block between conditional branches (true <-> false)
  const moveBlockBetweenConditionalBranches = useCallback(
    (
      conditionalId: string,
      fromBranch: 'whenTrue' | 'whenFalse',
      fromIndex: number,
      toBranch: 'whenTrue' | 'whenFalse',
      toIndex?: number
    ) => {
      if (fromBranch === toBranch) {
        return; // Use moveConditionalBranchBlock for same-branch moves
      }

      setState((prev) => {
        const conditionalIndex = prev.blocks.findIndex((b) => b.id === conditionalId);
        if (conditionalIndex === -1) {
          return prev;
        }

        const conditionalEditorBlock = prev.blocks[conditionalIndex];
        if (!conditionalEditorBlock || !isConditionalBlock(conditionalEditorBlock.block)) {
          return prev;
        }

        const fromBranchBlocks = conditionalEditorBlock.block[fromBranch];
        if (fromIndex < 0 || fromIndex >= fromBranchBlocks.length) {
          return prev;
        }

        const blockToMove = fromBranchBlocks[fromIndex]!;

        // Remove from source branch
        const newFromBranchBlocks = fromBranchBlocks.filter((_, i) => i !== fromIndex);

        // Add to target branch
        const newToBranchBlocks = [...conditionalEditorBlock.block[toBranch]];
        const insertIdx = toIndex ?? newToBranchBlocks.length;
        newToBranchBlocks.splice(insertIdx, 0, blockToMove);

        // Update conditional with both branches
        const newBlocks = [...prev.blocks];
        newBlocks[conditionalIndex] = {
          ...conditionalEditorBlock,
          block: {
            ...conditionalEditorBlock.block,
            [fromBranch]: newFromBranchBlocks,
            [toBranch]: newToBranchBlocks,
          },
        };

        const newState = {
          ...prev,
          blocks: newBlocks,
          isDirty: true,
        };
        notifyChange(newState);
        return newState;
      });
    },
    [notifyChange]
  );

  // Move a block from one section to another
  const moveBlockBetweenSections = useCallback(
    (fromSectionId: string, fromIndex: number, toSectionId: string, toIndex?: number) => {
      if (fromSectionId === toSectionId) {
        // Same section - use moveNestedBlock instead
        return;
      }

      setState((prev) => {
        const fromSectionIndex = prev.blocks.findIndex((b) => b.id === fromSectionId);
        const toSectionIndex = prev.blocks.findIndex((b) => b.id === toSectionId);

        if (fromSectionIndex === -1 || toSectionIndex === -1) {
          return prev;
        }

        const fromSectionEditorBlock = prev.blocks[fromSectionIndex];
        const toSectionEditorBlock = prev.blocks[toSectionIndex];

        if (
          !fromSectionEditorBlock ||
          !toSectionEditorBlock ||
          !isSectionBlock(fromSectionEditorBlock.block) ||
          !isSectionBlock(toSectionEditorBlock.block)
        ) {
          return prev;
        }

        const fromBlocks = fromSectionEditorBlock.block.blocks;
        if (fromIndex < 0 || fromIndex >= fromBlocks.length) {
          return prev;
        }

        const blockToMove = fromBlocks[fromIndex]!;

        // Remove from source section
        const newFromBlocks = fromBlocks.filter((_, i) => i !== fromIndex);

        // Add to target section
        const newToBlocks = [...toSectionEditorBlock.block.blocks];
        const insertIdx = toIndex ?? newToBlocks.length;
        newToBlocks.splice(insertIdx, 0, blockToMove);

        // Update both sections
        const newBlocks = [...prev.blocks];
        newBlocks[fromSectionIndex] = {
          ...fromSectionEditorBlock,
          block: {
            ...fromSectionEditorBlock.block,
            blocks: newFromBlocks,
          },
        };
        newBlocks[toSectionIndex] = {
          ...toSectionEditorBlock,
          block: {
            ...toSectionEditorBlock.block,
            blocks: newToBlocks,
          },
        };

        const newState = {
          ...prev,
          blocks: newBlocks,
          isDirty: true,
        };
        notifyChange(newState);
        return newState;
      });
    },
    [notifyChange]
  );

  // Set view mode
  const setViewMode = useCallback((mode: ViewMode) => {
    setState((prev) => ({
      ...prev,
      viewMode: mode,
    }));
  }, []);

  // Get guide as JsonGuide
  const getGuide = useCallback((): JsonGuide => {
    return {
      id: state.guide.id,
      title: state.guide.title,
      blocks: state.blocks.map((b) => {
        return b.block;
      }),
    };
  }, [state.guide, state.blocks]);

  // Load a guide
  const loadGuide = useCallback((guide: JsonGuide, blockIds?: string[]) => {
    // If blockIds are provided (from persistence), use them to preserve IDs across refreshes
    // Otherwise generate new IDs (for new/imported guides)
    const newBlocks: EditorBlock[] = guide.blocks.map((block, index) => ({
      id: blockIds?.[index] ?? generateBlockId(),
      block,
    }));

    setState({
      guide: {
        id: guide.id,
        title: guide.title,
      },
      blocks: newBlocks,
      viewMode: 'edit',
      isDirty: false,
    });
  }, []);

  // Reset to new guide
  const resetGuide = useCallback(() => {
    setState({
      guide: { ...DEFAULT_GUIDE_METADATA },
      blocks: [],
      viewMode: 'edit',
      isDirty: false,
    });
  }, []);

  // Mark as saved
  const markSaved = useCallback(() => {
    setState((prev) => {
      // REACT: bail out if already saved - prevents infinite re-render loop (R5)
      if (!prev.isDirty) {
        return prev; // Same reference = no re-render
      }
      return { ...prev, isDirty: false };
    });
  }, []);

  /**
   * Parse a block ID to determine if it's a nested block.
   * Nested block IDs have format: `${sectionId}-nested-${nestedIndex}`.
   * Uses string operations instead of regex for better performance and clarity.
   */
  const parseBlockId = (
    id: string,
    blocks: EditorBlock[]
  ): {
    isNested: boolean;
    sectionId?: string;
    nestedIndex?: number;
    block?: JsonBlock;
    rootIndex?: number;
    sectionRootIndex?: number;
  } => {
    const NESTED_MARKER = '-nested-';
    const markerIndex = id.lastIndexOf(NESTED_MARKER);

    // Check if it's a nested block ID
    if (markerIndex !== -1) {
      const sectionId = id.slice(0, markerIndex);
      const nestedIndexStr = id.slice(markerIndex + NESTED_MARKER.length);
      const nestedIndex = parseInt(nestedIndexStr, 10);

      // Validate the index is a valid number
      if (!isNaN(nestedIndex) && nestedIndexStr === String(nestedIndex)) {
        const sectionRootIndex = blocks.findIndex((b) => b.id === sectionId);
        const section = sectionRootIndex >= 0 ? blocks[sectionRootIndex] : undefined;
        if (section && isSectionBlock(section.block)) {
          const nestedBlock = section.block.blocks[nestedIndex];
          if (nestedBlock) {
            return { isNested: true, sectionId, nestedIndex, block: nestedBlock, sectionRootIndex };
          }
        }
        return { isNested: true, sectionRootIndex: sectionRootIndex >= 0 ? sectionRootIndex : undefined };
      }
    }

    // It's a root-level block
    const rootIndex = blocks.findIndex((b) => b.id === id);
    if (rootIndex >= 0) {
      return { isNested: false, block: blocks[rootIndex]!.block, rootIndex };
    }
    return { isNested: false };
  };

  // Merge interactive/multistep/guided blocks into a Multistep block
  const mergeBlocksToMultistep = useCallback(
    (blockIds: string[]) => {
      setState((prev) => {
        // Parse all block IDs and collect mergeable blocks (interactive, multistep, guided)
        const parsedBlocks = blockIds
          .map((id) => ({ id, ...parseBlockId(id, prev.blocks) }))
          .filter(
            (p) => p.block && (isInteractiveBlock(p.block) || isMultistepBlock(p.block) || isGuidedBlock(p.block))
          );

        if (parsedBlocks.length < 2) {
          return prev;
        }

        // Sort by document position: root blocks by index, nested by section position + nested index
        parsedBlocks.sort((a, b) => {
          // Get effective position for sorting
          const aPos = a.isNested
            ? (a.sectionRootIndex ?? 0) * 10000 + (a.nestedIndex ?? 0)
            : (a.rootIndex ?? 0) * 10000;
          const bPos = b.isNested
            ? (b.sectionRootIndex ?? 0) * 10000 + (b.nestedIndex ?? 0)
            : (b.rootIndex ?? 0) * 10000;
          return aPos - bPos;
        });

        // Convert blocks to steps, extracting steps from multistep/guided blocks
        const steps: JsonStep[] = parsedBlocks.flatMap((p) => {
          if (isInteractiveBlock(p.block!)) {
            const interactive = p.block as JsonInteractiveBlock;
            return [
              {
                action: interactive.action,
                reftarget: interactive.reftarget,
                ...(interactive.targetvalue && { targetvalue: interactive.targetvalue }),
                // Use tooltip if available, otherwise use content
                ...(interactive.tooltip && { tooltip: interactive.tooltip }),
                ...(!interactive.tooltip && interactive.content && { tooltip: interactive.content }),
              },
            ];
          }
          // For multistep/guided blocks, extract their steps
          const stepsBlock = p.block as JsonMultistepBlock | JsonGuidedBlock;
          return stepsBlock.steps;
        });

        // Create the multistep block
        const multistepBlock: JsonMultistepBlock = {
          type: 'multistep',
          content: 'Complete the following steps:',
          steps,
        };

        const firstParsed = parsedBlocks[0]!;
        const insertIntoSection = firstParsed.isNested && firstParsed.sectionId;

        const rootIdsToRemove = new Set(parsedBlocks.filter((p) => !p.isNested).map((p) => p.id));

        const nestedToRemove = new Map<string, number[]>();
        parsedBlocks
          .filter((p) => p.isNested && p.sectionId !== undefined && p.nestedIndex !== undefined)
          .forEach((p) => {
            const existing = nestedToRemove.get(p.sectionId!) || [];
            existing.push(p.nestedIndex!);
            nestedToRemove.set(p.sectionId!, existing);
          });

        let newBlocks = prev.blocks
          .filter((b) => !rootIdsToRemove.has(b.id))
          .map((b) => {
            if (
              isSectionBlock(b.block) &&
              (nestedToRemove.has(b.id) || (insertIntoSection && b.id === firstParsed.sectionId))
            ) {
              const indicesToRemove = new Set(nestedToRemove.get(b.id) || []);
              let newSectionBlocks = b.block.blocks.filter((_, i) => !indicesToRemove.has(i));

              if (insertIntoSection && b.id === firstParsed.sectionId) {
                const insertIdx = firstParsed.nestedIndex!;
                const removedBefore = Array.from(indicesToRemove).filter((i) => i < insertIdx).length;
                const adjustedIdx = insertIdx - removedBefore;
                newSectionBlocks.splice(adjustedIdx, 0, multistepBlock);
              }

              return {
                ...b,
                block: { ...b.block, blocks: newSectionBlocks },
              };
            }
            return b;
          });

        if (!insertIntoSection) {
          const newEditorBlock: EditorBlock = {
            id: generateBlockId(),
            block: multistepBlock,
          };

          let insertIndex = prev.blocks.findIndex((b) => b.id === firstParsed.id);
          const removedBeforeInsert = prev.blocks.filter((b, i) => i < insertIndex && rootIdsToRemove.has(b.id)).length;
          insertIndex -= removedBeforeInsert;

          newBlocks.splice(insertIndex, 0, newEditorBlock);
        }

        const newState = {
          ...prev,
          blocks: newBlocks,
          isDirty: true,
        };
        notifyChange(newState);
        return newState;
      });
    },
    [notifyChange]
  );

  // Merge interactive/multistep/guided blocks into a Guided block
  const mergeBlocksToGuided = useCallback(
    (blockIds: string[]) => {
      setState((prev) => {
        // Parse all block IDs and collect mergeable blocks (interactive, multistep, guided)
        const parsedBlocks = blockIds
          .map((id) => ({ id, ...parseBlockId(id, prev.blocks) }))
          .filter(
            (p) => p.block && (isInteractiveBlock(p.block) || isMultistepBlock(p.block) || isGuidedBlock(p.block))
          );

        if (parsedBlocks.length < 2) {
          return prev;
        }

        // Sort by document position: root blocks by index, nested by section position + nested index
        parsedBlocks.sort((a, b) => {
          // Get effective position for sorting
          const aPos = a.isNested
            ? (a.sectionRootIndex ?? 0) * 10000 + (a.nestedIndex ?? 0)
            : (a.rootIndex ?? 0) * 10000;
          const bPos = b.isNested
            ? (b.sectionRootIndex ?? 0) * 10000 + (b.nestedIndex ?? 0)
            : (b.rootIndex ?? 0) * 10000;
          return aPos - bPos;
        });

        // Convert blocks to steps, extracting steps from multistep/guided blocks
        const steps: JsonStep[] = parsedBlocks.flatMap((p) => {
          if (isInteractiveBlock(p.block!)) {
            const interactive = p.block as JsonInteractiveBlock;
            return [
              {
                action: interactive.action,
                reftarget: interactive.reftarget,
                ...(interactive.targetvalue && { targetvalue: interactive.targetvalue }),
                ...(interactive.content && { description: interactive.content }),
              },
            ];
          }
          // For multistep/guided blocks, extract their steps
          const stepsBlock = p.block as JsonMultistepBlock | JsonGuidedBlock;
          return stepsBlock.steps;
        });

        // Create the guided block
        const guidedBlock: JsonGuidedBlock = {
          type: 'guided',
          content: 'Follow the steps below:',
          steps,
        };

        const firstParsed = parsedBlocks[0]!;
        const insertIntoSection = firstParsed.isNested && firstParsed.sectionId;

        const rootIdsToRemove = new Set(parsedBlocks.filter((p) => !p.isNested).map((p) => p.id));

        const nestedToRemove = new Map<string, number[]>();
        parsedBlocks
          .filter((p) => p.isNested && p.sectionId !== undefined && p.nestedIndex !== undefined)
          .forEach((p) => {
            const existing = nestedToRemove.get(p.sectionId!) || [];
            existing.push(p.nestedIndex!);
            nestedToRemove.set(p.sectionId!, existing);
          });

        let newBlocks = prev.blocks
          .filter((b) => !rootIdsToRemove.has(b.id))
          .map((b) => {
            if (
              isSectionBlock(b.block) &&
              (nestedToRemove.has(b.id) || (insertIntoSection && b.id === firstParsed.sectionId))
            ) {
              const indicesToRemove = new Set(nestedToRemove.get(b.id) || []);
              let newSectionBlocks = b.block.blocks.filter((_, i) => !indicesToRemove.has(i));

              if (insertIntoSection && b.id === firstParsed.sectionId) {
                const insertIdx = firstParsed.nestedIndex!;
                const removedBefore = Array.from(indicesToRemove).filter((i) => i < insertIdx).length;
                const adjustedIdx = insertIdx - removedBefore;
                newSectionBlocks.splice(adjustedIdx, 0, guidedBlock);
              }

              return {
                ...b,
                block: { ...b.block, blocks: newSectionBlocks },
              };
            }
            return b;
          });

        if (!insertIntoSection) {
          const newEditorBlock: EditorBlock = {
            id: generateBlockId(),
            block: guidedBlock,
          };

          let insertIndex = prev.blocks.findIndex((b) => b.id === firstParsed.id);
          const removedBeforeInsert = prev.blocks.filter((b, i) => i < insertIndex && rootIdsToRemove.has(b.id)).length;
          insertIndex -= removedBeforeInsert;

          newBlocks.splice(insertIndex, 0, newEditorBlock);
        }

        const newState = {
          ...prev,
          blocks: newBlocks,
          isDirty: true,
        };
        notifyChange(newState);
        return newState;
      });
    },
    [notifyChange]
  );

  // Memoize return value
  return useMemo(
    () => ({
      state,
      updateGuideMetadata,
      addBlock,
      updateBlock,
      removeBlock,
      moveBlock,
      duplicateBlock,
      nestBlockInSection,
      unnestBlockFromSection,
      addBlockToSection,
      updateNestedBlock,
      deleteNestedBlock,
      duplicateNestedBlock,
      moveNestedBlock,
      setViewMode,
      getGuide,
      loadGuide,
      resetGuide,
      isDirty: state.isDirty,
      markSaved,
      mergeBlocksToMultistep,
      mergeBlocksToGuided,
      addBlockToConditionalBranch,
      updateConditionalBranchBlock,
      deleteConditionalBranchBlock,
      duplicateConditionalBranchBlock,
      moveConditionalBranchBlock,
      nestBlockInConditional,
      unnestBlockFromConditional,
      moveBlockBetweenConditionalBranches,
      moveBlockBetweenSections,
    }),
    [
      state,
      updateGuideMetadata,
      addBlock,
      updateBlock,
      removeBlock,
      moveBlock,
      duplicateBlock,
      nestBlockInSection,
      unnestBlockFromSection,
      addBlockToSection,
      updateNestedBlock,
      deleteNestedBlock,
      duplicateNestedBlock,
      moveNestedBlock,
      setViewMode,
      getGuide,
      loadGuide,
      resetGuide,
      markSaved,
      mergeBlocksToMultistep,
      mergeBlocksToGuided,
      addBlockToConditionalBranch,
      updateConditionalBranchBlock,
      deleteConditionalBranchBlock,
      duplicateConditionalBranchBlock,
      moveConditionalBranchBlock,
      nestBlockInConditional,
      unnestBlockFromConditional,
      moveBlockBetweenConditionalBranches,
      moveBlockBetweenSections,
    ]
  );
}
