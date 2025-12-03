/**
 * Block Editor Type Definitions
 *
 * Types for the block-based JSON guide editor.
 */

import type { JsonBlock, JsonGuide, JsonStep, JsonInteractiveAction } from '../../types/json-guide.types';

/**
 * Block type identifiers
 */
export type BlockType = 'markdown' | 'html' | 'image' | 'video' | 'section' | 'interactive' | 'multistep' | 'guided';

/**
 * Block metadata for the palette
 */
export interface BlockTypeMetadata {
  type: BlockType;
  icon: string;
  grafanaIcon: string;
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

// Re-export JSON guide types for convenience
export type { JsonBlock, JsonGuide, JsonStep, JsonInteractiveAction };
