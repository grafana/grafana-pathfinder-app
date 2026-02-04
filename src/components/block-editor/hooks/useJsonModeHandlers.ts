/**
 * useJsonModeHandlers Hook
 *
 * Manages JSON mode state and handlers for the block editor.
 * Extracted from BlockEditor to reduce component complexity.
 *
 * Responsibilities:
 * - JSON mode state (jsonModeState, validation errors, validity)
 * - View mode transitions (enter/exit JSON mode)
 * - JSON undo functionality
 */

import { useState, useCallback, useMemo } from 'react';
import type { ViewMode, JsonModeState, PositionedError, EditorBlock, JsonGuide } from '../types';
import { parseAndValidateGuide } from '../utils/block-import';

/**
 * Minimal interface for editor functionality needed by this hook.
 */
export interface JsonModeEditorInterface {
  /** Get the current guide as JSON-serializable object */
  getGuide: () => JsonGuide;
  /** Load a guide into the editor */
  loadGuide: (guide: JsonGuide, blockIds?: string[]) => void;
  /** Update guide metadata (used to mark dirty after JSON edit) */
  updateGuideMetadata: (metadata: Partial<{ id: string; title: string }>) => void;
  /** Set the current view mode */
  setViewMode: (mode: ViewMode) => void;
  /** Current editor state */
  state: {
    blocks: EditorBlock[];
    viewMode: ViewMode;
  };
}

/**
 * Options for useJsonModeHandlers hook.
 */
export interface UseJsonModeHandlersOptions {
  /** Editor instance for guide operations */
  editor: JsonModeEditorInterface;
  /** Whether currently recording into a section */
  recordingIntoSection: string | null;
  /** Whether currently recording into a conditional branch */
  recordingIntoConditionalBranch: { conditionalId: string; branch: 'whenTrue' | 'whenFalse' } | null;
  /** Callback to stop recording */
  onStopRecording: () => void;
  /** Callback to clear selection */
  onClearSelection: () => void;
  /** Whether selection mode is active */
  isSelectionMode: boolean;
}

/**
 * Return type for useJsonModeHandlers hook.
 */
export interface UseJsonModeHandlersReturn {
  // State
  /** Current JSON mode state (null if not in JSON mode) */
  jsonModeState: JsonModeState | null;
  /** Validation errors with positions */
  jsonValidationErrors: PositionedError[];
  /** Whether current JSON is valid */
  isJsonValid: boolean;
  /** Whether undo is available (JSON differs from original) */
  canUndo: boolean;

  // Handlers
  /** Handle view mode changes (edit/preview/json) */
  handleViewModeChange: (mode: ViewMode) => void;
  /** Handle JSON text changes */
  handleJsonChange: (json: string) => void;
  /** Revert JSON to original state */
  handleJsonUndo: () => void;
}

/**
 * Manages JSON mode state and handlers.
 * Encapsulates all JSON editing logic extracted from BlockEditor.
 */
export function useJsonModeHandlers(options: UseJsonModeHandlersOptions): UseJsonModeHandlersReturn {
  const {
    editor,
    recordingIntoSection,
    recordingIntoConditionalBranch,
    onStopRecording,
    onClearSelection,
    isSelectionMode,
  } = options;

  // JSON mode state
  const [jsonModeState, setJsonModeState] = useState<JsonModeState | null>(null);
  const [jsonValidationErrors, setJsonValidationErrors] = useState<PositionedError[]>([]);
  const [isJsonValid, setIsJsonValid] = useState(true);

  // Compute canUndo - true when JSON differs from original
  const canUndo = useMemo(() => {
    return jsonModeState !== null && jsonModeState.json !== jsonModeState.originalJson;
  }, [jsonModeState]);

  // Enter JSON mode - serialize guide and capture snapshot
  const handleEnterJsonMode = useCallback(() => {
    // Stop recording if active
    if (recordingIntoSection || recordingIntoConditionalBranch) {
      onStopRecording();
    }
    // Clear selection if active
    if (isSelectionMode) {
      onClearSelection();
    }

    const guide = editor.getGuide();
    const json = JSON.stringify(guide, null, 2);
    setJsonModeState({
      json,
      originalBlockIds: editor.state.blocks.map((b) => b.id),
      originalJson: json, // Capture snapshot for undo
    });
    setJsonValidationErrors([]);
    setIsJsonValid(true);
    editor.setViewMode('json');
  }, [
    editor,
    recordingIntoSection,
    recordingIntoConditionalBranch,
    onStopRecording,
    onClearSelection,
    isSelectionMode,
  ]);

  // Exit JSON mode - validate and apply changes
  const handleExitJsonMode = useCallback(
    (targetMode: 'edit' | 'preview') => {
      if (!jsonModeState) {
        editor.setViewMode(targetMode);
        return;
      }

      const result = parseAndValidateGuide(jsonModeState.json);
      if (!result.isValid) {
        setJsonValidationErrors(result.errors);
        setIsJsonValid(false);
        return; // Block switch - inline errors visible
      }

      // Regenerate all block IDs (per DT3 - don't pass originalBlockIds)
      editor.loadGuide(result.guide!);
      // Mark dirty - loadGuide sets isDirty: false, but we want it dirty after JSON edit
      editor.updateGuideMetadata({});

      setJsonModeState(null);
      setJsonValidationErrors([]);
      setIsJsonValid(true);
      editor.setViewMode(targetMode);
    },
    [editor, jsonModeState]
  );

  // Handle JSON text changes - update state and validate
  const handleJsonChange = useCallback((newJson: string) => {
    setJsonModeState((prev) => (prev ? { ...prev, json: newJson } : null));
    const result = parseAndValidateGuide(newJson);
    setIsJsonValid(result.isValid);
    setJsonValidationErrors(result.errors);
  }, []);

  // Handle JSON undo - revert to original and re-validate
  const handleJsonUndo = useCallback(() => {
    setJsonModeState((prev) => {
      if (!prev) {
        return null;
      }
      // Re-validate the original JSON (should be valid, but be safe)
      const result = parseAndValidateGuide(prev.originalJson);
      setIsJsonValid(result.isValid);
      setJsonValidationErrors(result.errors);
      return { ...prev, json: prev.originalJson };
    });
  }, []);

  // Handle view mode changes - coordinate enter/exit
  const handleViewModeChange = useCallback(
    (newMode: ViewMode) => {
      const currentMode = editor.state.viewMode;
      if (currentMode === newMode) {
        return;
      }

      if (currentMode === 'json' && newMode !== 'json') {
        handleExitJsonMode(newMode);
      } else if (currentMode !== 'json' && newMode === 'json') {
        handleEnterJsonMode();
      } else {
        editor.setViewMode(newMode);
      }
    },
    [editor, handleEnterJsonMode, handleExitJsonMode]
  );

  return {
    jsonModeState,
    jsonValidationErrors,
    isJsonValid,
    canUndo,
    handleViewModeChange,
    handleJsonChange,
    handleJsonUndo,
  };
}
