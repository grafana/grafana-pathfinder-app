/**
 * Block Selection Hook
 *
 * Manages block selection state for multi-select operations.
 *
 * Note: Merge operations (handleMergeToMultistep, handleMergeToGuided) stay
 * in BlockEditor because they need access to editor.state.blocks.
 */

import { useState, useCallback } from 'react';

/**
 * Return type for useBlockSelection hook
 */
export interface UseBlockSelectionReturn {
  /** Whether selection mode is active */
  isSelectionMode: boolean;
  /** Set of selected block IDs */
  selectedBlockIds: Set<string>;
  /** Toggle selection mode on/off */
  toggleSelectionMode: () => void;
  /** Toggle selection state for a specific block */
  toggleBlockSelection: (blockId: string) => void;
  /** Clear all selections and exit selection mode */
  clearSelection: () => void;
  /** Add a block to selection */
  selectBlock: (blockId: string) => void;
  /** Remove a block from selection */
  deselectBlock: (blockId: string) => void;
}

/**
 * Manages block selection state for multi-select operations.
 */
export function useBlockSelection(): UseBlockSelectionReturn {
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(new Set());

  const toggleSelectionMode = useCallback(() => {
    setIsSelectionMode((prev) => {
      if (prev) {
        // Exiting selection mode - clear selection
        setSelectedBlockIds(new Set());
      }
      return !prev;
    });
  }, []);

  const toggleBlockSelection = useCallback((blockId: string) => {
    setSelectedBlockIds((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) {
        next.delete(blockId);
      } else {
        next.add(blockId);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedBlockIds(new Set());
    setIsSelectionMode(false);
  }, []);

  const selectBlock = useCallback((blockId: string) => {
    setSelectedBlockIds((prev) => {
      const next = new Set(prev);
      next.add(blockId);
      return next;
    });
  }, []);

  const deselectBlock = useCallback((blockId: string) => {
    setSelectedBlockIds((prev) => {
      const next = new Set(prev);
      next.delete(blockId);
      return next;
    });
  }, []);

  return {
    isSelectionMode,
    selectedBlockIds,
    toggleSelectionMode,
    toggleBlockSelection,
    clearSelection,
    selectBlock,
    deselectBlock,
  };
}
