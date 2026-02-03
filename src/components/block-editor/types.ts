/**
 * Block Editor Type Definitions
 *
 * Types for the block-based JSON guide editor.
 */

import type { IconName } from '@grafana/ui';
import type { JsonBlock, JsonGuide, JsonStep, JsonInteractiveAction } from '../../types/json-guide.types';

/**
 * View mode for the block editor
 */
export type ViewMode = 'edit' | 'preview' | 'json';

/**
 * Block type identifiers
 */
export type BlockType =
  | 'markdown'
  | 'html'
  | 'image'
  | 'video'
  | 'section'
  | 'conditional'
  | 'interactive'
  | 'multistep'
  | 'guided'
  | 'quiz'
  | 'input';

/**
 * Block metadata for the palette
 */
export interface BlockTypeMetadata {
  type: BlockType;
  icon: string;
  grafanaIcon: IconName;
  name: string;
  description: string;
}

/**
 * Block with unique ID for editor state management
 */
export interface EditorBlock {
  /** Unique identifier for this block instance */
  id: string;
  /** The actual block data */
  block: JsonBlock;
}

/**
 * Editor state
 */
export interface BlockEditorState {
  /** Guide metadata */
  guide: {
    id: string;
    title: string;
  };
  /** Blocks in the guide */
  blocks: EditorBlock[];
  /** Current view mode (edit, preview, or json) */
  viewMode: ViewMode;
  /** Whether there are unsaved changes */
  isDirty: boolean;
}

/**
 * Props for block form components
 */
export interface BlockFormProps<T extends JsonBlock = JsonBlock> {
  /** Initial block data (undefined for new blocks) */
  initialData?: T;
  /** Called when form is submitted */
  onSubmit: (block: T) => void;
  /** Called when form is cancelled */
  onCancel: () => void;
  /** Whether the form is in edit mode (vs create mode) */
  isEditing?: boolean;
  /**
   * Called to start/stop the element picker.
   * When starting (isActive=true), provide a callback to receive the selected element.
   * The modal will render the picker and call the callback with the selector.
   */
  onPickerModeChange?: (isActive: boolean, onSelect?: (selector: string) => void) => void;
  /**
   * Called to start/stop record mode.
   * When starting (isActive=true), provides callbacks so parent can control the overlay.
   * The modal will show the RecordModeOverlay when active.
   */
  onRecordModeChange?: (
    isActive: boolean,
    options?: {
      onStop: () => void;
      getStepCount: () => number;
      /** Get number of steps pending in multi-step group (modal/dropdown detected) */
      getPendingMultiStepCount?: () => number;
      /** Check if currently grouping steps into a multi-step */
      isGroupingMultiStep?: () => boolean;
      /** Check if multi-step grouping is enabled */
      isMultiStepGroupingEnabled?: () => boolean;
      /** Toggle multi-step grouping on/off */
      toggleMultiStepGrouping?: () => void;
    }
  ) => void;
  /**
   * Called when form is submitted AND recording should start (for section blocks).
   * Creates the block and immediately enters record mode targeting it.
   */
  onSubmitAndRecord?: (block: T) => void;
  /**
   * Called when user wants to split a multistep/guided block into individual blocks.
   * Only shown when editing existing multistep/guided blocks.
   */
  onSplitToBlocks?: () => void;
  /**
   * Called when user wants to convert between multistep and guided.
   * Only shown when editing existing multistep/guided blocks.
   */
  onConvertType?: (newType: 'multistep' | 'guided') => void;
  /**
   * Called when user wants to switch to a different block type.
   * The conversion utility handles field mapping and validation.
   */
  onSwitchBlockType?: (newType: BlockType) => void;
}

/**
 * Props for step editor (used in multistep and guided blocks)
 */
export interface StepEditorProps {
  /** Current steps */
  steps: JsonStep[];
  /** Called when steps change */
  onChange: (steps: JsonStep[]) => void;
  /** Whether to show record mode button */
  showRecordMode?: boolean;
}

/**
 * Block palette item click handler
 */
export type OnBlockTypeSelect = (type: BlockType, insertAtIndex?: number) => void;

/**
 * Grouped operations interface to reduce prop drilling.
 * Consolidates 29+ individual callbacks into logical groups.
 *
 * This interface serves as the contract between BlockEditor and its
 * child components (BlockList, SectionNestedBlocks, ConditionalBranches).
 */
export interface BlockOperations {
  // ============ ROOT BLOCK CRUD ============
  /** Edit a root-level block */
  onBlockEdit: (block: EditorBlock) => void;
  /** Delete a root-level block by ID */
  onBlockDelete: (id: string) => void;
  /** Move a root-level block from one index to another */
  onBlockMove: (fromIndex: number, toIndex: number) => void;
  /** Duplicate a root-level block, returns new block ID or null */
  onBlockDuplicate: (id: string) => string | null;
  /** Insert a new block of given type at optional index */
  onInsertBlock: (type: BlockType, index?: number) => void;

  // ============ SECTION NESTING ============
  /** Nest a root block into a section */
  onNestBlock: (blockId: string, sectionId: string, insertIndex?: number) => void;
  /** Unnest a block from a section back to root level */
  onUnnestBlock: (nestedBlockId: string, sectionId: string, insertAtRootIndex?: number) => void;
  /** Insert a new block directly into a section */
  onInsertBlockInSection: (type: BlockType, sectionId: string, index?: number) => void;
  /** Edit a nested block within a section */
  onNestedBlockEdit: (sectionId: string, nestedIndex: number, block: JsonBlock) => void;
  /** Delete a nested block within a section */
  onNestedBlockDelete: (sectionId: string, nestedIndex: number) => void;
  /** Duplicate a nested block within a section */
  onNestedBlockDuplicate: (sectionId: string, nestedIndex: number) => void;
  /** Move a nested block within its section */
  onNestedBlockMove: (sectionId: string, fromIndex: number, toIndex: number) => void;

  // ============ CONDITIONAL BRANCH OPERATIONS ============
  /** Insert a new block into a conditional branch */
  onInsertBlockInConditional: (
    type: BlockType,
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    index?: number
  ) => void;
  /** Edit a block within a conditional branch */
  onConditionalBranchBlockEdit: (
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    nestedIndex: number,
    block: JsonBlock
  ) => void;
  /** Delete a block from a conditional branch */
  onConditionalBranchBlockDelete: (
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    nestedIndex: number
  ) => void;
  /** Duplicate a block within a conditional branch */
  onConditionalBranchBlockDuplicate: (
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    nestedIndex: number
  ) => void;
  /** Move a block within a conditional branch */
  onConditionalBranchBlockMove: (
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    fromIndex: number,
    toIndex: number
  ) => void;
  /** Nest a root block into a conditional branch */
  onNestBlockInConditional: (
    blockId: string,
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    insertIndex?: number
  ) => void;
  /** Unnest a block from a conditional branch back to root */
  onUnnestBlockFromConditional: (
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    nestedIndex: number,
    insertAtRootIndex?: number
  ) => void;
  /** Move a block between conditional branches */
  onMoveBlockBetweenConditionalBranches: (
    conditionalId: string,
    fromBranch: 'whenTrue' | 'whenFalse',
    fromIndex: number,
    toBranch: 'whenTrue' | 'whenFalse',
    toIndex?: number
  ) => void;

  // ============ CROSS-CONTAINER MOVES ============
  /** Move a block from one section to another */
  onMoveBlockBetweenSections: (fromSectionId: string, fromIndex: number, toSectionId: string, toIndex?: number) => void;

  // ============ SELECTION STATE ============
  /** Whether selection mode is active */
  isSelectionMode: boolean;
  /** Set of currently selected block IDs */
  selectedBlockIds: Set<string>;
  /** Toggle selection of a block */
  onToggleBlockSelection: (blockId: string) => void;

  // ============ RECORDING STATE ============
  /** ID of section currently being recorded into (if any) */
  recordingIntoSection: string | null;
  /** Branch currently being recorded into (if any) */
  recordingIntoConditionalBranch: { conditionalId: string; branch: 'whenTrue' | 'whenFalse' } | null;
  /** Start/stop recording into a section */
  onSectionRecord: (sectionId: string) => void;
  /** Start/stop recording into a conditional branch */
  onConditionalBranchRecord: (conditionalId: string, branch: 'whenTrue' | 'whenFalse') => void;
}

/**
 * Props for the JSON editor component
 */
export interface BlockJsonEditorProps {
  /** Current JSON text in the editor */
  jsonText: string;
  /** Called when JSON text changes */
  onJsonChange: (json: string) => void;
  /** List of validation errors */
  validationErrors: string[];
  /** Whether the current JSON is valid */
  isValid: boolean;
}

/**
 * JSON mode state for BlockEditorContent
 */
export interface JsonModeState {
  /** Current JSON text being edited */
  json: string;
  /** Original block IDs before entering JSON mode */
  originalBlockIds: string[];
}

// Re-export JSON guide types for convenience
export type { JsonBlock, JsonGuide, JsonStep, JsonInteractiveAction };
