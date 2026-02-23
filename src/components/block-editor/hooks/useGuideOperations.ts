/**
 * useGuideOperations Hook
 *
 * Handles guide-level operations including:
 * - Copy guide to clipboard
 * - Download guide as JSON file
 * - Create new guide (reset)
 * - Import guide from JSON
 * - Load template guide
 *
 * Extracted from BlockEditor to reduce component complexity.
 */

import { useCallback } from 'react';
import type { JsonGuide } from '../types';
import type { ModalName } from './useModalManager';
import blockEditorTutorial from '../../../bundled-interactives/block-editor-tutorial.json';

/**
 * Minimal interface for editor functionality needed by this hook.
 */
export interface GuideOpsEditorInterface {
  /** Get the current guide */
  getGuide: () => JsonGuide;
  /** Load a guide into the editor */
  loadGuide: (guide: JsonGuide, savedBlockIds?: string[]) => void;
  /** Reset to an empty guide */
  resetGuide: () => void;
}

/**
 * Minimal interface for persistence functionality needed by this hook.
 */
export interface GuideOpsPersistenceInterface {
  /** Clear persisted guide data */
  clear: () => void;
}

/**
 * Minimal interface for modal manager needed by this hook.
 */
export interface GuideOpsModalInterface {
  /** Close a modal by name */
  close: (name: ModalName) => void;
}

/**
 * Options for useGuideOperations hook.
 */
export interface UseGuideOperationsOptions {
  /** Editor instance for guide operations */
  editor: GuideOpsEditorInterface;
  /** Guide persistence hook */
  persistence: GuideOpsPersistenceInterface;
  /** Recording persistence hook */
  recordingPersistence: GuideOpsPersistenceInterface;
  /** Action recorder with clearRecording method */
  actionRecorder: { clearRecording: () => void };
  /** Recording state with reset method */
  recordingState: { reset: () => void };
  /** Modal manager for controlling modals */
  modals: GuideOpsModalInterface;
  /** Optional custom copy handler */
  onCopy?: (json: string) => void;
  /** Optional custom download handler */
  onDownload?: (guide: JsonGuide) => void;
  /** Called when creating a new guide to clear backend tracking */
  onNewGuide?: () => void;
}

/**
 * Return type for useGuideOperations hook.
 */
export interface UseGuideOperationsReturn {
  /** Copy guide JSON to clipboard */
  handleCopy: () => void;
  /** Download guide as JSON file */
  handleDownload: () => void;
  /** Reset to a new empty guide */
  handleNewGuide: () => void;
  /** Import a guide from JSON */
  handleImportGuide: (guide: JsonGuide) => void;
  /** Load the example template guide */
  handleLoadTemplate: () => void;
}

/**
 * Handles guide-level operations.
 * Encapsulates all guide operations extracted from BlockEditor.
 */
export function useGuideOperations(options: UseGuideOperationsOptions): UseGuideOperationsReturn {
  const {
    editor,
    persistence,
    recordingPersistence,
    actionRecorder,
    recordingState,
    modals,
    onCopy,
    onDownload,
    onNewGuide,
  } = options;

  // Copy guide JSON to clipboard
  const handleCopy = useCallback(() => {
    const guide = editor.getGuide();
    const json = JSON.stringify(guide, null, 2);

    if (onCopy) {
      onCopy(json);
    } else {
      navigator.clipboard.writeText(json).then(() => {
        // Could add a toast notification here
        console.log('Copied to clipboard');
      });
    }
  }, [editor, onCopy]);

  // Download guide as JSON file (opens in new tab)
  const handleDownload = useCallback(() => {
    const guide = editor.getGuide();

    if (onDownload) {
      onDownload(guide);
    } else {
      const json = JSON.stringify(guide, null, 2);
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      // Open in new window/tab
      const newWindow = window.open(url, '_blank');

      // Revoke URL after window loads to free memory
      if (newWindow) {
        newWindow.onload = () => {
          URL.revokeObjectURL(url);
        };
      } else {
        // If popup was blocked, revoke immediately
        URL.revokeObjectURL(url);
      }
    }
  }, [editor, onDownload]);

  // Reset to a new empty guide
  const handleNewGuide = useCallback(() => {
    persistence.clear(); // Clear localStorage
    recordingPersistence.clear(); // Clear any persisted recording state
    actionRecorder.clearRecording(); // Stop any active recording
    recordingState.reset(); // Clear recording state
    editor.resetGuide(); // Reset editor state
    onNewGuide?.(); // Clear backend tracking state
    modals.close('newGuideConfirm');
  }, [editor, persistence, recordingPersistence, actionRecorder, recordingState, modals, onNewGuide]);

  // Import a guide from JSON
  const handleImportGuide = useCallback(
    (guide: JsonGuide) => {
      editor.loadGuide(guide);
      modals.close('import');
    },
    [editor, modals]
  );

  // Load the example template guide
  const handleLoadTemplate = useCallback(() => {
    editor.loadGuide(blockEditorTutorial as JsonGuide);
  }, [editor]);

  return {
    handleCopy,
    handleDownload,
    handleNewGuide,
    handleImportGuide,
    handleLoadTemplate,
  };
}
