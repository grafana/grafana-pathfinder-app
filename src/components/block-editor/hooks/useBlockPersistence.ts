/**
 * useBlockPersistence Hook
 *
 * Auto-save and restore functionality for the block editor using localStorage.
 * Guide content writes are debounced; call `flush` (or unmount / close-tab) to
 * write any pending draft immediately.
 */

import { useEffect, useCallback, useRef } from 'react';
import type { JsonGuide, JsonModeState, ViewMode } from '../types';
import { logger } from '../../../lib/logging';
import { readEditorStoredState, editorDraftFlushers, writeEditorDraftState } from '../editor-tab-storage';

/** Debounce delay for guide-content auto-save (ms). */
const AUTO_SAVE_DELAY = 1000;

/**
 * Hook options
 */
export interface UseBlockPersistenceOptions {
  /** Current guide data */
  guide: JsonGuide;
  /** Local-only policy controlling whether title changes may replace guide.id. */
  idIsFinalized?: boolean;
  /** Current block IDs (to preserve across refreshes) */
  blockIds?: string[];
  /** Current view mode (to preserve across pop out/dock remounts) */
  viewMode?: ViewMode;
  /** Current JSON draft state (to preserve unapplied edits across remounts) */
  jsonModeState?: JsonModeState | null;
  /** Called when guide should be loaded from storage */
  onLoad?: (guide: JsonGuide, blockIds?: string[], viewMode?: ViewMode, jsonModeState?: JsonModeState) => void;
  /** Called after a successful save */
  onSave?: () => void;
  /** Whether auto-save is enabled */
  autoSave?: boolean;
  /** Whether auto-save is paused (e.g., while editing in a modal) */
  autoSavePaused?: boolean;
  /** Per-tab localStorage key (draft + remote). Required — no shared default. */
  storageKey: string;
}

const STORAGE_VERSION = 2;

function restoreViewMode(value: unknown): ViewMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value === 'edit' || value === 'preview' || value === 'json' ? value : 'edit';
}

function restoreJsonModeState(value: unknown): JsonModeState | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('json' in value) ||
    typeof value.json !== 'string' ||
    !('originalJson' in value) ||
    typeof value.originalJson !== 'string' ||
    !('originalBlockIds' in value) ||
    !Array.isArray(value.originalBlockIds) ||
    !value.originalBlockIds.every((id) => typeof id === 'string')
  ) {
    return undefined;
  }
  return {
    json: value.json,
    originalJson: value.originalJson,
    originalBlockIds: value.originalBlockIds,
  };
}

/**
 * Block editor persistence hook
 */
export function useBlockPersistence({
  guide,
  idIsFinalized,
  blockIds,
  viewMode,
  jsonModeState,
  onLoad,
  onSave,
  autoSave = true,
  autoSavePaused = false,
  storageKey,
}: UseBlockPersistenceOptions): void {
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef(false);
  const lastGuideRef = useRef<string>('');
  const lastViewModeRef = useRef<ViewMode | undefined>(viewMode);
  const lastJsonModeStateRef = useRef<JsonModeState | null | undefined>(jsonModeState);

  const save = useCallback(() => {
    try {
      writeEditorDraftState(storageKey, {
        guide,
        idIsFinalized,
        blockIds,
        viewMode,
        jsonModeState: viewMode === 'json' ? (jsonModeState ?? undefined) : undefined,
        savedAt: new Date().toISOString(),
        version: STORAGE_VERSION,
      });
      lastGuideRef.current = JSON.stringify(guide);
      pendingSaveRef.current = false;
      onSave?.();
    } catch (e) {
      logger.error('Failed to save guide to localStorage', { error: e });
    }
  }, [guide, idIsFinalized, blockIds, viewMode, jsonModeState, storageKey, onSave]);

  const latestSaveRef = useRef(save);
  useEffect(() => {
    latestSaveRef.current = save;
  }, [save]);

  const flush = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    if (pendingSaveRef.current) {
      latestSaveRef.current();
    }
  }, []);

  // Close-tab / strip chrome read localStorage — register so they can flush first.
  useEffect(() => {
    editorDraftFlushers.set(storageKey, flush);
    return () => {
      if (editorDraftFlushers.get(storageKey) === flush) {
        editorDraftFlushers.delete(storageKey);
      }
    };
  }, [storageKey, flush]);

  // Tab switch / surface handoff unmounts the editor — flush any pending draft.
  useEffect(() => {
    return () => {
      flush();
    };
  }, [flush]);

  // Restore before the first auto-save can overwrite storage with the blank initial guide.
  useEffect(() => {
    try {
      const parsed = readEditorStoredState(storageKey);
      if (parsed?.guide) {
        onLoad?.(
          parsed.guide as JsonGuide,
          parsed.blockIds,
          restoreViewMode(parsed.viewMode),
          restoreJsonModeState(parsed.jsonModeState)
        );
        // onLoad is async to the parent — pin so the auto-save below skips this blank guide.
        lastGuideRef.current = JSON.stringify(guide);
      }
    } catch (e) {
      logger.error('Failed to load guide from localStorage', { error: e });
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!autoSave || autoSavePaused) {
      return;
    }

    const currentGuideStr = JSON.stringify(guide);

    if (currentGuideStr === lastGuideRef.current) {
      pendingSaveRef.current = false;
      onSave?.();
      return;
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    pendingSaveRef.current = true;
    saveTimeoutRef.current = setTimeout(() => {
      saveTimeoutRef.current = null;
      save();
    }, AUTO_SAVE_DELAY);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    };
  }, [guide, autoSave, autoSavePaused, save, onSave]);

  // Panel handoff can remount before the guide-content debounce completes.
  useEffect(() => {
    const viewModeChanged = viewMode !== lastViewModeRef.current;
    const jsonDraftChanged = jsonModeState !== lastJsonModeStateRef.current;
    if (!autoSave || autoSavePaused || (!viewModeChanged && !(viewMode === 'json' && jsonDraftChanged))) {
      return;
    }
    lastViewModeRef.current = viewMode;
    lastJsonModeStateRef.current = jsonModeState;
    save();
  }, [viewMode, jsonModeState, autoSave, autoSavePaused, save]);
}
