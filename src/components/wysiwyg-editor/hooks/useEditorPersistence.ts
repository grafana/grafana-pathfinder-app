import { useState, useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/react';

// Utils
import { debug, error as logError } from '../utils/logger';

// Constants
import { EDITOR_TIMING } from '../../../constants/editor-config';

// Storage
import { StorageKeys } from '../../../lib/user-storage';

export interface UseEditorPersistenceOptions {
  editor: Editor | null;
}

export interface UseEditorPersistenceReturn {
  isSaving: boolean;
}

/**
 * Hook for managing editor auto-save functionality with debouncing.
 * Saves editor content as TipTap's native JSON format for reliable round-trip persistence.
 */
export function useEditorPersistence({ editor }: UseEditorPersistenceOptions): UseEditorPersistenceReturn {
  const [isSaving, setIsSaving] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-save to localStorage on content change (debounced)
  useEffect(() => {
    if (!editor) {
      return;
    }

    const handleUpdate = () => {
      // Clear existing timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // Set new timeout (debounce)
      saveTimeoutRef.current = setTimeout(() => {
        try {
          // Use TipTap's native JSON format for reliable save/load
          // This preserves atomic node attributes (like text) correctly
          const json = editor.getJSON();
          localStorage.setItem(StorageKeys.WYSIWYG_PREVIEW, JSON.stringify(json));

          setIsSaving(true);

          // Clear saving indicator after duration
          setTimeout(() => setIsSaving(false), EDITOR_TIMING.SAVING_INDICATOR_DURATION_MS);

          debug('[useEditorPersistence] Auto-saved to localStorage (JSON format)');
        } catch (error) {
          logError('[useEditorPersistence] Failed to auto-save:', error);
        }
      }, EDITOR_TIMING.AUTO_SAVE_DEBOUNCE_MS);
    };

    editor.on('update', handleUpdate);

    return () => {
      editor.off('update', handleUpdate);
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [editor]);

  return {
    isSaving,
  };
}
