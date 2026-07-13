/**
 * useBlockPersistence Hook
 *
 * Auto-save and restore functionality for the block editor using localStorage.
 */

import { useEffect, useCallback, useRef } from 'react';
import { BLOCK_EDITOR_STORAGE_KEY } from '../constants';
import type { JsonGuide, JsonModeState, ViewMode } from '../types';
import { logger } from '../../../lib/logging';

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
  /** Custom storage key */
  storageKey?: string;
}

/**
 * Hook return type
 */
export interface UseBlockPersistenceReturn {
  /** Save guide to localStorage */
  save: () => void;
  /** Load guide from localStorage */
  load: () => JsonGuide | null;
  /** Clear saved guide from localStorage */
  clear: () => void;
  /** Check if there's a saved guide */
  hasSavedGuide: () => boolean;
  /** Get last save timestamp */
  getLastSaveTime: () => Date | null;
}

/**
 * Storage format that includes metadata
 */
interface StoredGuide {
  guide: JsonGuide;
  /** Block IDs to preserve across page refreshes (added in v2) */
  blockIds?: string[];
  /** View mode to preserve across pop out/dock remounts (optional — absent in older stored guides) */
  viewMode?: ViewMode;
  /** Unapplied JSON draft state (optional — absent in older stored guides) */
  jsonModeState?: JsonModeState;
  savedAt: string;
  version: number;
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
  storageKey = BLOCK_EDITOR_STORAGE_KEY,
}: UseBlockPersistenceOptions): UseBlockPersistenceReturn {
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastGuideRef = useRef<string>('');
  const lastViewModeRef = useRef<ViewMode | undefined>(viewMode);
  const lastJsonModeStateRef = useRef<JsonModeState | null | undefined>(jsonModeState);

  const save = useCallback(() => {
    try {
      const stored: StoredGuide = {
        guide,
        blockIds,
        viewMode,
        jsonModeState: viewMode === 'json' ? (jsonModeState ?? undefined) : undefined,
        savedAt: new Date().toISOString(),
        version: STORAGE_VERSION,
      };
      localStorage.setItem(storageKey, JSON.stringify(stored));
      lastGuideRef.current = JSON.stringify(guide);
      onSave?.();
    } catch (e) {
      logger.error('Failed to save guide to localStorage', { error: e });
    }
  }, [guide, blockIds, viewMode, jsonModeState, storageKey, onSave]);

  const load = useCallback((): JsonGuide | null => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (!stored) {
        return null;
      }

      const parsed: StoredGuide = JSON.parse(stored);

      if (parsed.version !== STORAGE_VERSION) {
        logger.warn('Stored guide version mismatch, may need migration');
      }

      return parsed.guide;
    } catch (e) {
      logger.error('Failed to load guide from localStorage', { error: e });
      return null;
    }
  }, [storageKey]);

  const clear = useCallback(() => {
    try {
      localStorage.removeItem(storageKey);
      lastGuideRef.current = '';
    } catch (e) {
      logger.error('Failed to clear guide from localStorage', { error: e });
    }
  }, [storageKey]);

  const hasSavedGuide = useCallback((): boolean => {
    try {
      return localStorage.getItem(storageKey) !== null;
    } catch {
      return false;
    }
  }, [storageKey]);

  const getLastSaveTime = useCallback((): Date | null => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (!stored) {
        return null;
      }

      const parsed: StoredGuide = JSON.parse(stored);
      return new Date(parsed.savedAt);
    } catch {
      return null;
    }
  }, [storageKey]);

  useEffect(() => {
    if (!autoSave || autoSavePaused) {
      return;
    }

    const currentGuideStr = JSON.stringify(guide);

    if (currentGuideStr === lastGuideRef.current) {
      onSave?.();
      return;
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      save();
    }, AUTO_SAVE_DELAY);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [guide, autoSave, autoSavePaused, save, onSave]);

  useEffect(() => {
    if (onLoad) {
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored) {
          const parsed: StoredGuide = JSON.parse(stored);
          onLoad(
            parsed.guide,
            parsed.blockIds,
            restoreViewMode(parsed.viewMode),
            restoreJsonModeState(parsed.jsonModeState)
          );
        }
      } catch (e) {
        logger.error('Failed to load guide from localStorage', { error: e });
      }
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    save,
    load,
    clear,
    hasSavedGuide,
    getLastSaveTime,
  };
}
