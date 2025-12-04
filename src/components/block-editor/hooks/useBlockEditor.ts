/**
 * useBlockEditor Hook
 *
 * State management for the block-based JSON guide editor.
 * Handles blocks array, selection, and guide metadata.
 */

import { useState, useCallback, useMemo } from 'react';
import type { EditorBlock, BlockEditorState, JsonBlock, JsonGuide } from '../types';
import type {
  JsonSectionBlock,
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
 * Type guard for interactive blocks
 */
const isInteractiveBlock = (block: JsonBlock): block is JsonInteractiveBlock => {
  return block.type === 'interactive';
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

  // Block merging operations
  /** Merge selected interactive blocks into a Multistep block */
  mergeBlocksToMultistep: (blockIds: string[]) => void;
  /** Merge selected interactive blocks into a Guided block */
  mergeBlocksToGuided: (blockIds: string[]) => void;
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

  // Toggle preview mode
  const togglePreviewMode = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isPreviewMode: !prev.isPreviewMode,
    }));
  }, []);

  // Set preview mode
  const setPreviewMode = useCallback((isPreview: boolean) => {
    setState((prev) => ({
      ...prev,
      isPreviewMode: isPreview,
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
      isPreviewMode: false,
      isDirty: false,
    });
  }, []);

  // Reset to new guide
  const resetGuide = useCallback(() => {
    setState({
      guide: { ...DEFAULT_GUIDE_METADATA },
      blocks: [],
      isPreviewMode: false,
      isDirty: false,
    });
  }, []);

  // Mark as saved
  const markSaved = useCallback(() => {
    setState((prev) => ({ ...prev, isDirty: false }));
  }, []);

  /**
   * Parse a block ID to determine if it's a nested block
   * Nested block IDs have format: `${sectionId}-nested-${nestedIndex}`
   */
  const parseBlockId = (
    id: string,
    blocks: EditorBlock[]
  ): { isNested: boolean; sectionId?: string; nestedIndex?: number; block?: JsonBlock } => {
    // Check if it's a nested block ID
    const nestedMatch = id.match(/^(.+)-nested-(\d+)$/);
    if (nestedMatch) {
      const sectionId = nestedMatch[1];
      const nestedIndex = parseInt(nestedMatch[2], 10);
      const section = blocks.find((b) => b.id === sectionId);
      if (section && isSectionBlock(section.block)) {
        const nestedBlock = section.block.blocks[nestedIndex];
        if (nestedBlock) {
          return { isNested: true, sectionId, nestedIndex, block: nestedBlock };
        }
      }
      return { isNested: true };
    }

    // It's a root-level block
    const editorBlock = blocks.find((b) => b.id === id);
    if (editorBlock) {
      return { isNested: false, block: editorBlock.block };
    }
    return { isNested: false };
  };

  // Merge interactive blocks into a Multistep block
  const mergeBlocksToMultistep = useCallback(
    (blockIds: string[]) => {
      setState((prev) => {
        // Parse all block IDs and collect interactive blocks
        const parsedBlocks = blockIds
          .map((id) => ({ id, ...parseBlockId(id, prev.blocks) }))
          .filter((p) => p.block && isInteractiveBlock(p.block));

        if (parsedBlocks.length < 2) {
          return prev;
        }

        // Convert interactive blocks to multistep steps
        const steps: JsonStep[] = parsedBlocks.map((p) => {
          const interactive = p.block as JsonInteractiveBlock;
          return {
            action: interactive.action,
            reftarget: interactive.reftarget,
            ...(interactive.targetvalue && { targetvalue: interactive.targetvalue }),
            // Use tooltip if available, otherwise use content
            ...(interactive.tooltip && { tooltip: interactive.tooltip }),
            ...(!interactive.tooltip && interactive.content && { tooltip: interactive.content }),
          };
        });

        // Create the multistep block
        const multistepBlock: JsonMultistepBlock = {
          type: 'multistep',
          content: 'Complete the following steps:',
          steps,
        };

        // Determine where to insert based on first selected block
        const firstParsed = parsedBlocks[0];
        const insertIntoSection = firstParsed.isNested && firstParsed.sectionId;

        // Remove root-level blocks that were merged
        const rootIdsToRemove = new Set(parsedBlocks.filter((p) => !p.isNested).map((p) => p.id));

        // Group nested blocks by section for removal
        const nestedToRemove = new Map<string, number[]>();
        parsedBlocks
          .filter((p) => p.isNested && p.sectionId !== undefined && p.nestedIndex !== undefined)
          .forEach((p) => {
            const existing = nestedToRemove.get(p.sectionId!) || [];
            existing.push(p.nestedIndex!);
            nestedToRemove.set(p.sectionId!, existing);
          });

        // Build new blocks array
        let newBlocks = prev.blocks
          .filter((b) => !rootIdsToRemove.has(b.id))
          .map((b) => {
            // If this is a section with nested blocks to remove/insert, update it
            if (isSectionBlock(b.block) && (nestedToRemove.has(b.id) || (insertIntoSection && b.id === firstParsed.sectionId))) {
              const indicesToRemove = new Set(nestedToRemove.get(b.id) || []);
              let newSectionBlocks = b.block.blocks.filter((_, i) => !indicesToRemove.has(i));

              // If inserting into this section, add at the position of the first removed block
              if (insertIntoSection && b.id === firstParsed.sectionId) {
                const insertIdx = firstParsed.nestedIndex!;
                // Count how many blocks before insertIdx were removed
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

        // If not inserting into a section, insert at root level
        if (!insertIntoSection) {
          const newEditorBlock: EditorBlock = {
            id: generateBlockId(),
            block: multistepBlock,
          };

          // Find where to insert at root level
          let insertIndex = prev.blocks.findIndex((b) => b.id === firstParsed.id);
          // Adjust for removed blocks before this index
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

  // Merge interactive blocks into a Guided block
  const mergeBlocksToGuided = useCallback(
    (blockIds: string[]) => {
      setState((prev) => {
        // Parse all block IDs and collect interactive blocks
        const parsedBlocks = blockIds
          .map((id) => ({ id, ...parseBlockId(id, prev.blocks) }))
          .filter((p) => p.block && isInteractiveBlock(p.block));

        if (parsedBlocks.length < 2) {
          return prev;
        }

        // Convert interactive blocks to guided steps
        const steps: JsonStep[] = parsedBlocks.map((p) => {
          const interactive = p.block as JsonInteractiveBlock;
          return {
            action: interactive.action,
            reftarget: interactive.reftarget,
            ...(interactive.targetvalue && { targetvalue: interactive.targetvalue }),
            ...(interactive.content && { description: interactive.content }),
          };
        });

        // Create the guided block
        const guidedBlock: JsonGuidedBlock = {
          type: 'guided',
          content: 'Follow the steps below:',
          steps,
        };

        // Determine where to insert based on first selected block
        const firstParsed = parsedBlocks[0];
        const insertIntoSection = firstParsed.isNested && firstParsed.sectionId;

        // Remove root-level blocks that were merged
        const rootIdsToRemove = new Set(parsedBlocks.filter((p) => !p.isNested).map((p) => p.id));

        // Group nested blocks by section for removal
        const nestedToRemove = new Map<string, number[]>();
        parsedBlocks
          .filter((p) => p.isNested && p.sectionId !== undefined && p.nestedIndex !== undefined)
          .forEach((p) => {
            const existing = nestedToRemove.get(p.sectionId!) || [];
            existing.push(p.nestedIndex!);
            nestedToRemove.set(p.sectionId!, existing);
          });

        // Build new blocks array
        let newBlocks = prev.blocks
          .filter((b) => !rootIdsToRemove.has(b.id))
          .map((b) => {
            // If this is a section with nested blocks to remove/insert, update it
            if (isSectionBlock(b.block) && (nestedToRemove.has(b.id) || (insertIntoSection && b.id === firstParsed.sectionId))) {
              const indicesToRemove = new Set(nestedToRemove.get(b.id) || []);
              let newSectionBlocks = b.block.blocks.filter((_, i) => !indicesToRemove.has(i));

              // If inserting into this section, add at the position of the first removed block
              if (insertIntoSection && b.id === firstParsed.sectionId) {
                const insertIdx = firstParsed.nestedIndex!;
                // Count how many blocks before insertIdx were removed
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

        // If not inserting into a section, insert at root level
        if (!insertIntoSection) {
          const newEditorBlock: EditorBlock = {
            id: generateBlockId(),
            block: guidedBlock,
          };

          // Find where to insert at root level
          let insertIndex = prev.blocks.findIndex((b) => b.id === firstParsed.id);
          // Adjust for removed blocks before this index
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
      togglePreviewMode,
      setPreviewMode,
      getGuide,
      loadGuide,
      resetGuide,
      isDirty: state.isDirty,
      markSaved,
      mergeBlocksToMultistep,
      mergeBlocksToGuided,
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
      togglePreviewMode,
      setPreviewMode,
      getGuide,
      loadGuide,
      resetGuide,
      markSaved,
      mergeBlocksToMultistep,
      mergeBlocksToGuided,
    ]
  );
}
