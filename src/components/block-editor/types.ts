/**
 * Block Editor Type Definitions
 *
 * Types for the block-based JSON guide editor.
 */

import type { IconName } from '@grafana/ui';
import type { JsonBlock, JsonGuide, JsonStep, JsonInteractiveAction } from '../../types/json-guide.types';

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
    match?: {
      urlPrefix?: string[];
      tags?: string[];
    };
  };
  /** Blocks in the guide */
  blocks: EditorBlock[];
  /** Whether the editor is in preview mode */
  isPreviewMode: boolean;
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
 * Used by extracted components to receive callbacks from BlockEditor.
 *
 * Note: This interface is defined for use in Plan B refactoring.
 * It groups related operations to simplify component props.
 */
export interface BlockOperations {
  // Block CRUD
  onAddBlock: (type: BlockType, index?: number) => void;
  onEditBlock: (block: EditorBlock) => void;
  onDeleteBlock: (id: string) => void;
  onMoveBlock: (fromIndex: number, toIndex: number) => void;

  // Nested block operations (sections)
  onAddNestedBlock: (sectionId: string, type: BlockType, index?: number) => void;
  onEditNestedBlock: (sectionId: string, index: number, block: JsonBlock) => void;
  onDeleteNestedBlock: (sectionId: string, index: number) => void;

  // Conditional branch operations
  onAddConditionalBlock: (
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    type: BlockType,
    index?: number
  ) => void;
  onEditConditionalBlock: (
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    index: number,
    block: JsonBlock
  ) => void;
  onDeleteConditionalBlock: (conditionalId: string, branch: 'whenTrue' | 'whenFalse', index: number) => void;

  // Selection operations
  isSelectionMode: boolean;
  selectedBlockIds: Set<string>;
  onToggleSelectionMode: () => void;
  onToggleBlockSelection: (blockId: string) => void;
  onClearSelection: () => void;
  onMergeToMultistep: () => void;
  onMergeToGuided: () => void;

  // Recording operations
  isRecording: boolean;
  recordingTargetId: string | null;
  recordingTargetType: 'section' | 'conditional' | null;
  onStartSectionRecording: (sectionId: string) => void;
  onStartConditionalRecording: (conditionalId: string, branch: 'whenTrue' | 'whenFalse') => void;
  onStopRecording: () => void;
}

// Re-export JSON guide types for convenience
export type { JsonBlock, JsonGuide, JsonStep, JsonInteractiveAction };
