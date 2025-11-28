/**
 * useBlockEditor Hook
 *
 * State management for the block-based JSON guide editor.
 * Handles blocks array, selection, and guide metadata.
 */

import { useState, useCallback, useMemo } from 'react';
import type { EditorBlock, BlockEditorState, JsonBlock, JsonGuide } from '../types';
import type { JsonSectionBlock } from '../../../types/json-guide.types';
import { DEFAULT_GUIDE_METADATA } from '../constants';

/**
 * Type guard for section blocks
 */
const isSectionBlock = (block: JsonBlock): block is JsonSectionBlock => {
  return block.type === 'section';
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
  unnestBlockFromSection: (blockId: string, sectionId: string, insertAfterSection?: boolean) => void;
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

  // Selection
  /** Select a block for editing */
  selectBlock: (id: string | null) => void;
  /** Get the currently selected block */
  getSelectedBlock: () => EditorBlock | null;

  // View mode
  /** Toggle between edit and preview modes */
  togglePreviewMode: () => void;
  /** Set preview mode explicitly */
  setPreviewMode: (isPreview: boolean) => void;

  // Guide export
  /** Get the current guide as a JsonGuide object */
  getGuide: () => JsonGuide;
  /** Load a guide from JsonGuide data */
  loadGuide: (guide: JsonGuide) => void;
  /** Reset to a new empty guide */
  resetGuide: () => void;

  // State flags
  /** Whether there are unsaved changes */
  isDirty: boolean;
  /** Mark the current state as saved */
  markSaved: () => void;
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
      match: initialGuide?.match ?? DEFAULT_GUIDE_METADATA.match,
    },
    blocks: initialBlocks,
    selectedBlockId: null,
    isPreviewMode: false,
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
          ...(newState.guide.match && { match: newState.guide.match }),
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
          selectedBlockId: id,
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
        const newSelectedId = prev.selectedBlockId === id ? null : prev.selectedBlockId;

        const newState = {
          ...prev,
          blocks: newBlocks,
          selectedBlockId: newSelectedId,
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
        newBlocks.splice(toIndex, 0, removed);

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
          selectedBlockId: newId,
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

        // Can't nest sections or nest into non-sections
        if (block.block.type === 'section' || !isSectionBlock(sectionBlock.block)) {
          return prev;
        }

        // Remove block from root level
        const newBlocks = prev.blocks.filter((b) => b.id !== blockId);

        // Add block to section's blocks array
        const section = newBlocks[sectionIndex > blockIndex ? sectionIndex - 1 : sectionIndex];
        if (isSectionBlock(section.block)) {
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
    (blockId: string, sectionId: string, insertAfterSection = true) => {
      setState((prev) => {
        const sectionIndex = prev.blocks.findIndex((b) => b.id === sectionId);
        if (sectionIndex === -1) {
          return prev;
        }

        const sectionEditorBlock = prev.blocks[sectionIndex];
        if (!isSectionBlock(sectionEditorBlock.block)) {
          return prev;
        }

        // blockId format is `${sectionId}-${index}` - extract the index
        const nestedIndex = parseInt(blockId.split('-').pop() ?? '-1', 10);
        if (nestedIndex < 0 || nestedIndex >= sectionEditorBlock.block.blocks.length) {
          return prev;
        }

        const blockToMove = sectionEditorBlock.block.blocks[nestedIndex];

        // Remove block from section
        const newSectionBlocks = sectionEditorBlock.block.blocks.filter((_, i) => i !== nestedIndex);

        const newBlocks = [...prev.blocks];
        newBlocks[sectionIndex] = {
          ...sectionEditorBlock,
          block: {
            ...sectionEditorBlock.block,
            blocks: newSectionBlocks,
          },
        };

        // Create new EditorBlock and insert after section
        const newEditorBlock: EditorBlock = {
          id: generateBlockId(),
          block: blockToMove,
        };

        const insertIdx = insertAfterSection ? sectionIndex + 1 : sectionIndex;
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
        if (!isSectionBlock(sectionEditorBlock.block)) {
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
        if (!isSectionBlock(sectionEditorBlock.block)) {
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
        if (!isSectionBlock(sectionEditorBlock.block)) {
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
        if (!isSectionBlock(sectionEditorBlock.block)) {
          return prev;
        }

        const sectionBlocksCopy = [...sectionEditorBlock.block.blocks];
        if (nestedIndex < 0 || nestedIndex >= sectionBlocksCopy.length) {
          return prev;
        }

        const blockToDuplicate = sectionBlocksCopy[nestedIndex];
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
        if (!isSectionBlock(sectionEditorBlock.block)) {
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
        sectionBlocksCopy.splice(toIndex, 0, removed);

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

  // Select a block
  const selectBlock = useCallback((id: string | null) => {
    setState((prev) => ({ ...prev, selectedBlockId: id }));
  }, []);

  // Get selected block
  const getSelectedBlock = useCallback((): EditorBlock | null => {
    return state.blocks.find((b) => b.id === state.selectedBlockId) ?? null;
  }, [state.blocks, state.selectedBlockId]);

  // Toggle preview mode
  const togglePreviewMode = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isPreviewMode: !prev.isPreviewMode,
      selectedBlockId: null, // Deselect when switching modes
    }));
  }, []);

  // Set preview mode
  const setPreviewMode = useCallback((isPreview: boolean) => {
    setState((prev) => ({
      ...prev,
      isPreviewMode: isPreview,
      selectedBlockId: isPreview ? null : prev.selectedBlockId,
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
      ...(state.guide.match && Object.keys(state.guide.match).length > 0 && { match: state.guide.match }),
    };
  }, [state.guide, state.blocks]);

  // Load a guide
  const loadGuide = useCallback((guide: JsonGuide) => {
    const newBlocks: EditorBlock[] = guide.blocks.map((block) => ({
      id: generateBlockId(),
      block,
    }));

    setState({
      guide: {
        id: guide.id,
        title: guide.title,
        match: guide.match,
      },
      blocks: newBlocks,
      selectedBlockId: null,
      isPreviewMode: false,
      isDirty: false,
    });
  }, []);

  // Reset to new guide
  const resetGuide = useCallback(() => {
    setState({
      guide: { ...DEFAULT_GUIDE_METADATA },
      blocks: [],
      selectedBlockId: null,
      isPreviewMode: false,
      isDirty: false,
    });
  }, []);

  // Mark as saved
  const markSaved = useCallback(() => {
    setState((prev) => ({ ...prev, isDirty: false }));
  }, []);

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
      selectBlock,
      getSelectedBlock,
      togglePreviewMode,
      setPreviewMode,
      getGuide,
      loadGuide,
      resetGuide,
      isDirty: state.isDirty,
      markSaved,
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
      selectBlock,
      getSelectedBlock,
      togglePreviewMode,
      setPreviewMode,
      getGuide,
      loadGuide,
      resetGuide,
      markSaved,
    ]
  );
}
