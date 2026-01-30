/**
 * useBlockFormState Hook
 *
 * Manages state for the block form modal, including editing context
 * for root-level, nested (section), and conditional branch blocks.
 */

import { useState, useCallback, useContext } from 'react';
import { BlockEditorContext } from '../BlockEditorContext';
import type { BlockType, EditorBlock, JsonBlock } from '../types';

/**
 * Helper to safely get context.
 * Provides no-op fallbacks for testing without provider.
 */
function useBlockEditorContextSafe() {
  const context = useContext(BlockEditorContext);
  // Provide no-op fallbacks for testing without provider
  return {
    sectionContext: context?.sectionContext ?? null,
    conditionalContext: context?.conditionalContext ?? null,
    setSectionContext: context?.setSectionContext ?? (() => {}),
    setConditionalContext: context?.setConditionalContext ?? (() => {}),
    clearContext: context?.clearContext ?? (() => {}),
  };
}

/**
 * State for editing a nested block within a section.
 */
export interface NestedBlockEditingState {
  sectionId: string;
  nestedIndex: number;
  block: JsonBlock;
}

/**
 * State for editing a block within a conditional branch.
 */
export interface ConditionalBranchEditingState {
  conditionalId: string;
  branch: 'whenTrue' | 'whenFalse';
  nestedIndex: number;
  block: JsonBlock;
}

/**
 * Return type for useBlockFormState hook.
 */
export interface BlockFormState {
  // Core form state
  isBlockFormOpen: boolean;
  editingBlockType: BlockType | null;
  editingBlock: EditorBlock | null;
  insertAtIndex: number | undefined;

  // Nested editing state
  editingNestedBlock: NestedBlockEditingState | null;
  editingConditionalBranchBlock: ConditionalBranchEditingState | null;

  // Actions
  openNewBlockForm: (type: BlockType, index?: number) => void;
  openEditBlockForm: (block: EditorBlock) => void;
  openNestedBlockForm: (type: BlockType, sectionId: string, index?: number) => void;
  openEditNestedBlockForm: (sectionId: string, nestedIndex: number, block: JsonBlock) => void;
  openConditionalBlockForm: (
    type: BlockType,
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    index?: number
  ) => void;
  openEditConditionalBlockForm: (
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    nestedIndex: number,
    block: JsonBlock
  ) => void;
  closeBlockForm: () => void;

  // State setters for form updates (needed for type switching)
  setEditingBlockType: (type: BlockType | null) => void;
  setEditingBlock: (block: EditorBlock | null) => void;
  setEditingNestedBlock: (state: NestedBlockEditingState | null) => void;
  setEditingConditionalBranchBlock: (state: ConditionalBranchEditingState | null) => void;
}

/**
 * Manages block form state including editing context for root, nested, and conditional blocks.
 *
 * IMPORTANT: isBlockFormOpen is returned so BlockEditor can pass it to useBlockPersistence
 * for auto-save coordination.
 */
export function useBlockFormState(): BlockFormState {
  const { setSectionContext, setConditionalContext, clearContext } = useBlockEditorContextSafe();

  // Core form state
  const [isBlockFormOpen, setIsBlockFormOpen] = useState(false);
  const [editingBlockType, setEditingBlockType] = useState<BlockType | null>(null);
  const [editingBlock, setEditingBlock] = useState<EditorBlock | null>(null);
  const [insertAtIndex, setInsertAtIndex] = useState<number | undefined>(undefined);

  // Nested editing state
  const [editingNestedBlock, setEditingNestedBlock] = useState<NestedBlockEditingState | null>(null);
  const [editingConditionalBranchBlock, setEditingConditionalBranchBlock] =
    useState<ConditionalBranchEditingState | null>(null);

  // Open form for new root-level block
  const openNewBlockForm = useCallback(
    (type: BlockType, index?: number) => {
      setEditingBlockType(type);
      setEditingBlock(null);
      setInsertAtIndex(index);
      setEditingNestedBlock(null);
      setEditingConditionalBranchBlock(null);
      clearContext();
      setIsBlockFormOpen(true);
    },
    [clearContext]
  );

  // Open form to edit existing root-level block
  const openEditBlockForm = useCallback(
    (block: EditorBlock) => {
      setEditingBlockType(block.block.type as BlockType);
      setEditingBlock(block);
      setInsertAtIndex(undefined);
      setEditingNestedBlock(null);
      setEditingConditionalBranchBlock(null);
      clearContext();
      setIsBlockFormOpen(true);
    },
    [clearContext]
  );

  // Open form for new nested block in section
  const openNestedBlockForm = useCallback(
    (type: BlockType, sectionId: string, index?: number) => {
      setEditingBlockType(type);
      setEditingBlock(null);
      setInsertAtIndex(undefined);
      setEditingNestedBlock(null);
      setEditingConditionalBranchBlock(null);
      setSectionContext({ sectionId, index });
      setConditionalContext(null);
      setIsBlockFormOpen(true);
    },
    [setSectionContext, setConditionalContext]
  );

  // Open form to edit existing nested block in section
  const openEditNestedBlockForm = useCallback(
    (sectionId: string, nestedIndex: number, block: JsonBlock) => {
      setEditingBlockType(block.type as BlockType);
      setEditingBlock(null);
      setInsertAtIndex(undefined);
      setEditingNestedBlock({ sectionId, nestedIndex, block });
      setEditingConditionalBranchBlock(null);
      setSectionContext({ sectionId, index: nestedIndex });
      setConditionalContext(null);
      setIsBlockFormOpen(true);
    },
    [setSectionContext, setConditionalContext]
  );

  // Open form for new block in conditional branch
  const openConditionalBlockForm = useCallback(
    (type: BlockType, conditionalId: string, branch: 'whenTrue' | 'whenFalse', index?: number) => {
      setEditingBlockType(type);
      setEditingBlock(null);
      setInsertAtIndex(undefined);
      setEditingNestedBlock(null);
      setEditingConditionalBranchBlock(null);
      setSectionContext(null);
      setConditionalContext({ conditionalId, branch, index });
      setIsBlockFormOpen(true);
    },
    [setSectionContext, setConditionalContext]
  );

  // Open form to edit existing block in conditional branch
  const openEditConditionalBlockForm = useCallback(
    (conditionalId: string, branch: 'whenTrue' | 'whenFalse', nestedIndex: number, block: JsonBlock) => {
      setEditingBlockType(block.type as BlockType);
      setEditingBlock(null);
      setInsertAtIndex(undefined);
      setEditingNestedBlock(null);
      setEditingConditionalBranchBlock({ conditionalId, branch, nestedIndex, block });
      setSectionContext(null);
      setConditionalContext({ conditionalId, branch, index: nestedIndex });
      setIsBlockFormOpen(true);
    },
    [setSectionContext, setConditionalContext]
  );

  // Close form and clear all editing state
  const closeBlockForm = useCallback(() => {
    setIsBlockFormOpen(false);
    setEditingBlockType(null);
    setEditingBlock(null);
    setInsertAtIndex(undefined);
    setEditingNestedBlock(null);
    setEditingConditionalBranchBlock(null);
    clearContext();
  }, [clearContext]);

  return {
    isBlockFormOpen,
    editingBlockType,
    editingBlock,
    insertAtIndex,
    editingNestedBlock,
    editingConditionalBranchBlock,
    openNewBlockForm,
    openEditBlockForm,
    openNestedBlockForm,
    openEditNestedBlockForm,
    openConditionalBlockForm,
    openEditConditionalBlockForm,
    closeBlockForm,
    setEditingBlockType,
    setEditingBlock,
    setEditingNestedBlock,
    setEditingConditionalBranchBlock,
  };
}
