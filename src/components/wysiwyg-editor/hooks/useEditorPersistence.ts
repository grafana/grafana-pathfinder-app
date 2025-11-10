import { useState, useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/react';

// Utils
import { debug, error as logError } from '../utils/logger';

// Security
import { sanitizeDocumentationHTML } from '../../../security';

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
 * Hook for managing editor auto-save functionality with debouncing
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
          const html = editor.getHTML();

          // SECURITY: sanitize before save (F1, F4)
          const sanitized = sanitizeDocumentationHTML(html);
          localStorage.setItem(StorageKeys.WYSIWYG_PREVIEW, sanitized);

          setIsSaving(true);

          // Clear saving indicator after duration
          setTimeout(() => setIsSaving(false), EDITOR_TIMING.SAVING_INDICATOR_DURATION_MS);

          debug('[useEditorPersistence] Auto-saved to localStorage');
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

