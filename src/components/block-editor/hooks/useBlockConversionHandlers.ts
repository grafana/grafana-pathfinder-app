/**
 * useBlockConversionHandlers Hook
 *
 * Handles block type conversions including:
 * - Splitting multistep/guided blocks into individual interactive blocks
 * - Converting between multistep and guided types
 * - Switching any block to a different type
 *
 * Extracted from BlockEditor to reduce component complexity.
 */

import { useCallback } from 'react';
import { getAppEvents } from '@grafana/runtime';
import type { BlockType, JsonBlock, EditorBlock } from '../types';
import type { JsonInteractiveBlock, JsonMultistepBlock, JsonGuidedBlock } from '../../../types/json-guide.types';
import { convertBlockType } from '../utils/block-conversion';
import type { NestedBlockEditingState, ConditionalBranchEditingState } from './useBlockFormState';

/**
 * Minimal interface for editor functionality needed by this hook.
 */
export interface ConversionEditorInterface {
  /** Current editor state */
  state: {
    blocks: EditorBlock[];
  };
  /** Remove a root-level block */
  removeBlock: (id: string) => void;
  /** Add a block at an index */
  addBlock: (block: JsonBlock, index?: number) => string;
  /** Add a block to a section */
  addBlockToSection: (block: JsonBlock, sectionId: string, index?: number) => void;
  /** Delete a nested block from a section */
  deleteNestedBlock: (sectionId: string, index: number) => void;
  /** Update a root-level block */
  updateBlock: (id: string, block: JsonBlock) => void;
  /** Update a nested block in a section */
  updateNestedBlock: (sectionId: string, index: number, block: JsonBlock) => void;
  /** Update a block in a conditional branch */
  updateConditionalBranchBlock: (
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    index: number,
    block: JsonBlock
  ) => void;
}

/**
 * Form state interface needed by this hook.
 */
export interface ConversionFormStateInterface {
  /** Currently editing root-level block */
  editingBlock: EditorBlock | null;
  /** Currently editing nested block in section */
  editingNestedBlock: NestedBlockEditingState | null;
  /** Currently editing block in conditional branch */
  editingConditionalBranchBlock: ConditionalBranchEditingState | null;
  /** Close the form */
  closeBlockForm: () => void;
  /** Update the editing block type */
  setEditingBlockType: (type: BlockType | null) => void;
  /** Update the editing block state */
  setEditingBlock: (block: EditorBlock | null) => void;
  /** Update the nested block editing state */
  setEditingNestedBlock: (state: NestedBlockEditingState | null) => void;
  /** Update the conditional branch block editing state */
  setEditingConditionalBranchBlock: (state: ConditionalBranchEditingState | null) => void;
}

/**
 * Options for useBlockConversionHandlers hook.
 */
export interface UseBlockConversionHandlersOptions {
  /** Editor instance for block operations */
  editor: ConversionEditorInterface;
  /** Form state for managing editing context */
  formState: ConversionFormStateInterface;
}

/**
 * Return type for useBlockConversionHandlers hook.
 */
export interface UseBlockConversionHandlersReturn {
  /** Split a multistep/guided block into individual interactive blocks */
  handleSplitToBlocks: () => void;
  /** Convert between multistep and guided types */
  handleConvertType: (newType: 'multistep' | 'guided') => void;
  /** Switch any block to a different type */
  handleSwitchBlockType: (newType: BlockType) => void;
}

/**
 * Handles block type conversions.
 * Encapsulates all conversion logic extracted from BlockEditor.
 */
export function useBlockConversionHandlers(
  options: UseBlockConversionHandlersOptions
): UseBlockConversionHandlersReturn {
  const { editor, formState } = options;
  const {
    editingBlock,
    editingNestedBlock,
    editingConditionalBranchBlock,
    closeBlockForm,
    setEditingBlockType,
    setEditingBlock,
    setEditingNestedBlock,
    setEditingConditionalBranchBlock,
  } = formState;

  // Split multistep/guided block into individual interactive blocks
  const handleSplitToBlocks = useCallback(() => {
    // Check if we're editing a root-level or nested block
    const blockData = editingNestedBlock?.block ?? editingBlock?.block;
    if (!blockData || (blockData.type !== 'multistep' && blockData.type !== 'guided')) {
      return;
    }

    const steps = (blockData as JsonMultistepBlock | JsonGuidedBlock).steps;
    if (!steps || steps.length === 0) {
      return;
    }

    // Convert steps to interactive blocks
    const interactiveBlocks: JsonInteractiveBlock[] = steps.map((step) => ({
      type: 'interactive',
      action: step.action,
      reftarget: step.reftarget,
      content: step.tooltip || step.description || `${step.action} on element`,
      ...(step.targetvalue && { targetvalue: step.targetvalue }),
    }));

    if (editingNestedBlock) {
      // Nested block - replace within section
      const { sectionId, nestedIndex } = editingNestedBlock;
      // Delete the original block, then add the new ones at the same position
      editor.deleteNestedBlock(sectionId, nestedIndex);
      // Add in reverse order so they end up in correct sequence
      interactiveBlocks.reverse().forEach((block) => {
        editor.addBlockToSection(block, sectionId, nestedIndex);
      });
    } else if (editingBlock) {
      // Root-level block - replace at same position
      const blockIndex = editor.state.blocks.findIndex((b) => b.id === editingBlock.id);
      if (blockIndex !== -1) {
        // Remove the original
        editor.removeBlock(editingBlock.id);
        // Add the new blocks at the same position
        interactiveBlocks.forEach((block, i) => {
          editor.addBlock(block, blockIndex + i);
        });
      }
    }

    // Close the modal
    closeBlockForm();
  }, [editingBlock, editingNestedBlock, editor, closeBlockForm]);

  // Convert between multistep and guided types
  const handleConvertType = useCallback(
    (newType: 'multistep' | 'guided') => {
      const blockData = editingNestedBlock?.block ?? editingBlock?.block;
      if (!blockData || (blockData.type !== 'multistep' && blockData.type !== 'guided')) {
        return;
      }

      const currentBlock = blockData as JsonMultistepBlock | JsonGuidedBlock;
      let convertedBlock: JsonMultistepBlock | JsonGuidedBlock;

      if (newType === 'guided') {
        // Convert multistep to guided
        convertedBlock = {
          type: 'guided',
          content: currentBlock.content,
          steps: currentBlock.steps.map((step) => ({
            ...step,
            // Move tooltip to description for guided
            description: step.tooltip || step.description,
            tooltip: undefined,
          })),
          ...(currentBlock.requirements && { requirements: currentBlock.requirements }),
          ...(currentBlock.objectives && { objectives: currentBlock.objectives }),
          ...(currentBlock.skippable && { skippable: currentBlock.skippable }),
        };
      } else {
        // Convert guided to multistep
        convertedBlock = {
          type: 'multistep',
          content: currentBlock.content,
          steps: currentBlock.steps.map((step) => ({
            ...step,
            // Move description to tooltip for multistep
            tooltip: step.description || step.tooltip,
            description: undefined,
          })),
          ...(currentBlock.requirements && { requirements: currentBlock.requirements }),
          ...(currentBlock.objectives && { objectives: currentBlock.objectives }),
          ...(currentBlock.skippable && { skippable: currentBlock.skippable }),
        };
      }

      if (editingNestedBlock) {
        // Update nested block
        editor.updateNestedBlock(editingNestedBlock.sectionId, editingNestedBlock.nestedIndex, convertedBlock);
      } else if (editingBlock) {
        // Update root-level block
        editor.updateBlock(editingBlock.id, convertedBlock);
      }

      // Close the modal
      closeBlockForm();
    },
    [editingBlock, editingNestedBlock, editor, closeBlockForm]
  );

  // Switch any block to a different type
  const handleSwitchBlockType = useCallback(
    (newType: BlockType) => {
      const sourceBlock = editingConditionalBranchBlock?.block ?? editingNestedBlock?.block ?? editingBlock?.block;
      if (!sourceBlock) {
        console.warn('handleSwitchBlockType called with no active block');
        return;
      }

      try {
        const convertedBlock = convertBlockType(sourceBlock, newType);

        // Update in-place based on context
        if (editingConditionalBranchBlock) {
          editor.updateConditionalBranchBlock(
            editingConditionalBranchBlock.conditionalId,
            editingConditionalBranchBlock.branch,
            editingConditionalBranchBlock.nestedIndex,
            convertedBlock
          );
          setEditingConditionalBranchBlock({
            ...editingConditionalBranchBlock,
            block: convertedBlock,
          });
        } else if (editingNestedBlock) {
          editor.updateNestedBlock(editingNestedBlock.sectionId, editingNestedBlock.nestedIndex, convertedBlock);
          setEditingNestedBlock({
            ...editingNestedBlock,
            block: convertedBlock,
          });
        } else if (editingBlock) {
          editor.updateBlock(editingBlock.id, convertedBlock);
          setEditingBlock({
            ...editingBlock,
            block: convertedBlock,
          });
        }

        // Update block type - triggers form remount via key prop change
        setEditingBlockType(newType);
      } catch (error) {
        console.error('Failed to convert block type:', error);
        getAppEvents().publish({
          type: 'alert-error',
          payload: ['Conversion failed', 'Could not convert to the selected block type.'],
        });
      }
    },
    [
      editingBlock,
      editingNestedBlock,
      editingConditionalBranchBlock,
      editor,
      setEditingBlock,
      setEditingBlockType,
      setEditingConditionalBranchBlock,
      setEditingNestedBlock,
    ]
  );

  return {
    handleSplitToBlocks,
    handleConvertType,
    handleSwitchBlockType,
  };
}
