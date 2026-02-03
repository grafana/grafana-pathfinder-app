/**
 * Block Editor Hooks
 *
 * Note: useBlockListDrag has been removed as part of the @dnd-kit migration.
 * Drag-and-drop functionality is now handled by @dnd-kit components in the dnd/ folder.
 */

export { useBlockEditor } from './useBlockEditor';
export type { UseBlockEditorOptions, UseBlockEditorReturn } from './useBlockEditor';

export { useBlockPersistence } from './useBlockPersistence';
export type { UseBlockPersistenceOptions, UseBlockPersistenceReturn } from './useBlockPersistence';

export { useRecordingPersistence } from './useRecordingPersistence';
export type {
  UseRecordingPersistenceOptions,
  UseRecordingPersistenceReturn,
  PersistedRecordingState,
} from './useRecordingPersistence';

export { useModalManager } from './useModalManager';
export type { ModalName, UseModalManagerReturn } from './useModalManager';

export { useBlockSelection } from './useBlockSelection';
export type { UseBlockSelectionReturn } from './useBlockSelection';

export { useBlockFormState } from './useBlockFormState';
export type { BlockFormState, NestedBlockEditingState, ConditionalBranchEditingState } from './useBlockFormState';

export { useRecordingState } from './useRecordingState';
export type {
  UseRecordingStateReturn,
  RecordingStateSnapshot,
  ConditionalRecordingTarget,
  RecordingState,
} from './useRecordingState';

export { useRecordingActions } from './useRecordingActions';
export type {
  UseRecordingActionsReturn,
  RecordingActionsDependencies,
  ActionRecorderInterface,
  EditorBlockInterface,
} from './useRecordingActions';

export { useJsonModeHandlers } from './useJsonModeHandlers';
export type {
  UseJsonModeHandlersOptions,
  UseJsonModeHandlersReturn,
  JsonModeEditorInterface,
} from './useJsonModeHandlers';

export { useBlockConversionHandlers } from './useBlockConversionHandlers';
export type {
  UseBlockConversionHandlersOptions,
  UseBlockConversionHandlersReturn,
  ConversionEditorInterface,
  ConversionFormStateInterface,
} from './useBlockConversionHandlers';

export { useGuideOperations } from './useGuideOperations';
export type {
  UseGuideOperationsOptions,
  UseGuideOperationsReturn,
  GuideOpsEditorInterface,
  GuideOpsPersistenceInterface,
  GuideOpsModalInterface,
} from './useGuideOperations';
