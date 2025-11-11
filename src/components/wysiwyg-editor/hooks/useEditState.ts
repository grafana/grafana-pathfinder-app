import { useState, useCallback } from 'react';
import type { EditStateOrNull, InteractiveElementType } from '../types';

/**
 * Hook for managing interactive element edit state
 * Centralizes edit state logic for interactive elements
 */
export function useEditState() {
  const [editState, setEditState] = useState<EditStateOrNull>(null);

  /**
   * Start editing an interactive element
   */
  const startEditing = useCallback((type: InteractiveElementType, attributes: Record<string, string>, pos: number, commentText?: string) => {
    setEditState({ type, attributes, pos, commentText });
  }, []);

  /**
   * Stop editing (close edit form)
   */
  const stopEditing = useCallback(() => {
    setEditState(null);
  }, []);

  /**
   * Update attributes of currently edited element
   */
  const updateAttributes = useCallback((attributes: Record<string, string>) => {
    setEditState((prev) => (prev ? { ...prev, attributes } : null));
  }, []);

  /**
   * Check if currently editing a specific element type
   */
  const isEditing = useCallback(
    (type?: InteractiveElementType) => {
      if (!editState) {
        return false;
      }
      if (!type) {
        return true;
      }
      return editState.type === type;
    },
    [editState]
  );

  return {
    editState,
    startEditing,
    stopEditing,
    updateAttributes,
    isEditing,
  };
}

