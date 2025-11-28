/**
 * WYSIWYG Editor Exports
 * Main entry point for the interactive guide editor
 */

export { default as WysiwygEditor } from './WysiwygEditor';
export { default as Toolbar } from './Toolbar';
export { FullScreenModeOverlay, FullScreenModeProvider, useFullScreenModeContext } from './FullScreenModeOverlay';
export { FullScreenStepEditor } from './FullScreenStepEditor';
export { BundlingIndicator } from './BundlingIndicator';

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
export { useFullScreenMode } from './hooks/useFullScreenMode';
export { useMultistepDetector } from './hooks/useMultistepDetector';

// Full screen mode types
export type {
  FullScreenModeState,
  PendingClickInfo,
  FullScreenStep,
  UseFullScreenModeOptions,
  UseFullScreenModeReturn,
} from './hooks/useFullScreenMode';
export type {
  OverlayType,
  DetectionResult,
  UseMultistepDetectorOptions,
  UseMultistepDetectorReturn,
} from './hooks/useMultistepDetector';
