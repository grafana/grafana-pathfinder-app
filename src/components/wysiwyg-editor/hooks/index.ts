/**
 * WYSIWYG Editor Hooks
 * Centralized exports for all editor-related hooks
 */

export { useEditState } from './useEditState';
export { useEditorInitialization } from './useEditorInitialization';
export { useEditorPersistence } from './useEditorPersistence';
export { useEditorActions } from './useEditorActions';
export { useEditorModals } from './useEditorModals';
export { useFullScreenMode } from './useFullScreenMode';
export { useMultistepDetector } from './useMultistepDetector';

// Re-export types
export type { UseEditorInitializationOptions, UseEditorInitializationReturn } from './useEditorInitialization';
export type { UseEditorPersistenceOptions, UseEditorPersistenceReturn } from './useEditorPersistence';
export type { UseEditorActionsOptions, UseEditorActionsReturn } from './useEditorActions';
export type { UseEditorModalsOptions, UseEditorModalsReturn } from './useEditorModals';
export type {
  FullScreenModeState,
  PendingClickInfo,
  FullScreenStep,
  SectionInfo,
  StepEditorData,
  BundledStepEditorData,
  UseFullScreenModeOptions,
  UseFullScreenModeReturn,
} from './useFullScreenMode';
export type {
  OverlayType,
  DetectionResult,
  UseMultistepDetectorOptions,
  UseMultistepDetectorReturn,
} from './useMultistepDetector';
