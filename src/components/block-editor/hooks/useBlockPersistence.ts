/**
 * useBlockPersistence Hook
 *
 * Auto-save and restore functionality for the block editor using localStorage.
 */

import { useEffect, useCallback, useRef } from 'react';
import { BLOCK_EDITOR_STORAGE_KEY } from '../constants';
import type { JsonGuide } from '../types';

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
  /** Called when guide should be loaded from storage */
  onLoad?: (guide: JsonGuide, blockIds?: string[]) => void;
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
  savedAt: string;
  version: number;
}

const STORAGE_VERSION = 2;

/**
 * Block editor persistence hook
 */
export function useBlockPersistence({
  guide,
  blockIds,
  onLoad,
  onSave,
  autoSave = true,
  autoSavePaused = false,
  storageKey = BLOCK_EDITOR_STORAGE_KEY,
}: UseBlockPersistenceOptions): UseBlockPersistenceReturn {
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastGuideRef = useRef<string>('');

  // Save guide to localStorage
  const save = useCallback(() => {
    try {
      const stored: StoredGuide = {
        guide,
        blockIds, // Store block IDs to preserve across refreshes
        savedAt: new Date().toISOString(),
        version: STORAGE_VERSION,
      };
      localStorage.setItem(storageKey, JSON.stringify(stored));
      lastGuideRef.current = JSON.stringify(guide);
      // Notify that save was successful
      onSave?.();
    } catch (e) {
      console.error('Failed to save guide to localStorage:', e);
    }
  }, [guide, blockIds, storageKey, onSave]);

  // Load guide from localStorage
  const load = useCallback((): JsonGuide | null => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (!stored) {
        return null;
      }

      const parsed: StoredGuide = JSON.parse(stored);

      // Version check for future migrations
      if (parsed.version !== STORAGE_VERSION) {
        console.warn('Stored guide version mismatch, may need migration');
      }

      return parsed.guide;
    } catch (e) {
      console.error('Failed to load guide from localStorage:', e);
      return null;
    }
  }, [storageKey]);

  // Clear saved guide
  const clear = useCallback(() => {
    try {
      localStorage.removeItem(storageKey);
      lastGuideRef.current = '';
    } catch (e) {
      console.error('Failed to clear guide from localStorage:', e);
    }
  }, [storageKey]);

  // Check if there's a saved guide
  const hasSavedGuide = useCallback((): boolean => {
    try {
      return localStorage.getItem(storageKey) !== null;
    } catch {
      return false;
    }
  }, [storageKey]);

  // Get last save time
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

  // Auto-save on guide changes (debounced)
  // Pauses when editing in a modal - saves will happen when modal closes
  useEffect(() => {
    if (!autoSave || autoSavePaused) {
      return;
    }

    const currentGuideStr = JSON.stringify(guide);

    // If guide hasn't changed, still notify save complete (clears isDirty flag)
    // This handles cases where updateBlock is called with identical data
    if (currentGuideStr === lastGuideRef.current) {
      onSave?.();
      return;
    }

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Set new timeout for debounced save
    saveTimeoutRef.current = setTimeout(() => {
      save();
    }, AUTO_SAVE_DELAY);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [guide, autoSave, autoSavePaused, save, onSave]);

  // Load on mount if onLoad provided
  useEffect(() => {
    if (onLoad) {
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored) {
          const parsed: StoredGuide = JSON.parse(stored);
          // Pass both guide and blockIds to onLoad
          onLoad(parsed.guide, parsed.blockIds);
        }
      } catch (e) {
        console.error('Failed to load guide from localStorage:', e);
      }
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    save,
    load,
    clear,
    hasSavedGuide,
    getLastSaveTime,
  };
}
