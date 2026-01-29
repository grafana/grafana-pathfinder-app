/**
 * Block Editor
 *
 * A block-based editor for creating JSON interactive guides.
 * Provides a visual interface for composing guides from different block types.
 */

// Main editor component
export { BlockEditor } from './BlockEditor';

// Extracted components
export { BlockEditorContent } from './BlockEditorContent';
export type { BlockEditorContentProps } from './BlockEditorContent';

export { BlockEditorModals } from './BlockEditorModals';
export type { BlockEditorModalsProps } from './BlockEditorModals';

// Tour component
export { BlockEditorTour } from './BlockEditorTour';

// Types
export type {
  BlockType,
  BlockTypeMetadata,
  EditorBlock,
  BlockEditorState,
  BlockFormProps,
  StepEditorProps,
  OnBlockTypeSelect,
  BlockOperations,
  JsonBlock,
  JsonGuide,
  JsonStep,
  JsonInteractiveAction,
} from './types';

// Constants
export {
  BLOCK_TYPE_METADATA,
  BLOCK_TYPE_ORDER,
  BLOCK_EDITOR_STORAGE_KEY,
  DEFAULT_GUIDE_METADATA,
  INTERACTIVE_ACTIONS,
  VIDEO_PROVIDERS,
} from './constants';
