/**
 * useBlockPersistence Hook
 *
 * Auto-save and restore functionality for the block editor using localStorage.
 */

import { useEffect, useCallback, useRef } from 'react';
import { BLOCK_EDITOR_STORAGE_KEY } from '../constants';
import type { JsonGuide, JsonModeState, ViewMode } from '../types';
import { logger } from '../../../lib/logging';
import { readEditorStoredState, writeEditorDraftState } from '../editor-tab-storage';

/**
 * Debounce delay for auto-save (ms)
 */
const AUTO_SAVE_DELAY = 1000;

/**
 * Hook options
 */
export interface UseBlockPersistenceOptions {
  /** Current guide data */
  guide: JsonGuide;
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
  /** Debounce delay in milliseconds. Use 0 when close-time checks need synchronous storage. */
  autoSaveDelay?: number;
  /** Unified editor-tab storage key (draft + remote binding). */
  storageKey?: string;
}

/**
 * Hook return type
 */
export interface UseBlockPersistenceReturn {
  /** Clear saved guide from localStorage */
  clear: () => void;
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
  blockIds,
  viewMode,
  jsonModeState,
  onLoad,
  onSave,
  autoSave = true,
  autoSavePaused = false,
  autoSaveDelay = AUTO_SAVE_DELAY,
  storageKey = BLOCK_EDITOR_STORAGE_KEY,
}: UseBlockPersistenceOptions): UseBlockPersistenceReturn {
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef(false);
  const lastGuideRef = useRef<string>('');
  const lastViewModeRef = useRef<ViewMode | undefined>(viewMode);
  const lastJsonModeStateRef = useRef<JsonModeState | null | undefined>(jsonModeState);

  const save = useCallback(() => {
    try {
      writeEditorDraftState(storageKey, {
        guide,
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
  }, [guide, blockIds, viewMode, jsonModeState, storageKey, onSave]);
  const latestSaveRef = useRef(save);
  useEffect(() => {
    latestSaveRef.current = save;
  }, [save]);

  const clear = useCallback(() => {
    try {
      localStorage.removeItem(storageKey);
      lastGuideRef.current = '';
    } catch (e) {
      logger.error('Failed to clear guide from localStorage', { error: e });
    }
  }, [storageKey]);

  // Above auto-save: with delay 0, a mount save would clobber storage with the
  // blank initial guide before onLoad's parent re-render (chrome/close read storage).
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

    if (autoSaveDelay <= 0) {
      save();
      return;
    }

    pendingSaveRef.current = true;
    saveTimeoutRef.current = setTimeout(() => {
      saveTimeoutRef.current = null;
      save();
    }, autoSaveDelay);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [guide, autoSave, autoSavePaused, autoSaveDelay, save, onSave]);

  // Switching between editor tabs unmounts the active editor. Flush its
  // debounced guide snapshot so a quick tab switch cannot lose the last edit
  // or make close-time unsaved-work detection observe stale storage.
  useEffect(() => {
    return () => {
      if (pendingSaveRef.current) {
        latestSaveRef.current();
      }
    };
  }, []);

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

  return {
    clear,
  };
}
