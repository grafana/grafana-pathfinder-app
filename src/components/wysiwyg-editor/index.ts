/**
 * WYSIWYG Editor Exports
 * Main entry point for the interactive tutorial editor
 */

export { default as WysiwygEditor } from './WysiwygEditor';
export { default as Toolbar } from './Toolbar';
export { default as FormModal } from './FormModal';

// Type exports
export type {
  InteractiveElementType,
  EditState,
  EditStateOrNull,
  InteractiveAttributesInput,
  InteractiveAttributesOutput,
  InteractiveFormProps,
  ActionType,
  CommonRequirement,
} from './types';

// Extension exports (for advanced usage)
export {
  InteractiveListItem,
  InteractiveSpan,
  InteractiveComment,
  SequenceSection,
  InteractiveClickHandler,
} from './extensions';

// Service exports (for advanced usage)
export * from './services';

// Hook exports
export { useEditState } from './hooks/useEditState';
export { usePopover } from './hooks/usePopover';
export { useKeyboardShortcut } from './hooks/useKeyboardShortcut';
export { useClickOutside } from './hooks/useClickOutside';

