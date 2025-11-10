/**
 * WYSIWYG Editor Hooks
 * Centralized exports for all editor-related hooks
 */

export { useEditState } from './useEditState';
export { useEditorInitialization } from './useEditorInitialization';
export { useEditorPersistence } from './useEditorPersistence';
export { useEditorActions } from './useEditorActions';
export { useEditorModals } from './useEditorModals';

// Re-export types
export type { UseEditorInitializationOptions, UseEditorInitializationReturn } from './useEditorInitialization';
export type { UseEditorPersistenceOptions, UseEditorPersistenceReturn } from './useEditorPersistence';
export type { UseEditorActionsOptions, UseEditorActionsReturn } from './useEditorActions';
export type { UseEditorModalsOptions, UseEditorModalsReturn } from './useEditorModals';

