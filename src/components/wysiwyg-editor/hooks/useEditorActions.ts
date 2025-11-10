import { useCallback } from 'react';
import type { Editor } from '@tiptap/react';

// Utils
import { formatHTML } from '../utils/htmlFormatter';
import { debug, error as logError } from '../utils/logger';

// Security
import { sanitizeDocumentationHTML } from '../../../security';

// Constants
import { EDITOR_DEFAULTS, EDITOR_TIMING } from '../../../constants/editor-config';

// Storage
import { StorageKeys } from '../../../lib/user-storage';

export interface UseEditorActionsOptions {
  editor: Editor | null;
}

export interface UseEditorActionsReturn {
  copyHTML: () => Promise<void>;
  downloadHTML: () => Promise<void>;
  testGuide: () => void;
  resetGuide: () => void;
}

/**
 * Hook for managing editor actions: copy, download, test, and reset
 */
export function useEditorActions({ editor }: UseEditorActionsOptions): UseEditorActionsReturn {
  // Copy HTML to clipboard
  const copyHTML = useCallback(async () => {
    if (!editor) {
      return;
    }

    try {
      const html = editor.getHTML();
      // SECURITY: sanitized HTML before export to prevent XSS (F1, F4)
      const sanitized = sanitizeDocumentationHTML(html);
      const formatted = await formatHTML(sanitized);
      await navigator.clipboard.writeText(formatted);
      debug('[useEditorActions] HTML copied to clipboard');
      // TODO: Show success toast
    } catch (error) {
      logError('[useEditorActions] Failed to copy HTML:', error);
      // TODO: Show error toast
    }
  }, [editor]);

  // Download HTML as file
  const downloadHTML = useCallback(async () => {
    if (!editor) {
      return;
    }

    try {
      const html = editor.getHTML();
      // SECURITY: sanitized HTML before export to prevent XSS (F1, F4)
      const sanitized = sanitizeDocumentationHTML(html);
      const formatted = await formatHTML(sanitized);

      // Use 'application/octet-stream' to force download instead of display
      const blob = new Blob([formatted], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.download = 'interactive-guide.html'; // Set download before href
      a.href = url;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();

      // Delay cleanup to ensure download starts
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, EDITOR_TIMING.DOWNLOAD_CLEANUP_DELAY_MS);

      debug('[useEditorActions] HTML downloaded');
      // TODO: Show success toast
    } catch (error) {
      logError('[useEditorActions] Failed to download HTML:', error);
      // TODO: Show error toast
    }
  }, [editor]);

  // Test Guide in Pathfinder
  const testGuide = useCallback(() => {
    if (!editor) {
      return;
    }

    try {
      const html = editor.getHTML();

      // SECURITY: sanitize HTML before preview to prevent XSS (F1, F4)
      const sanitized = sanitizeDocumentationHTML(html);

      // Save to localStorage (overwrites auto-saved version with sanitized)
      localStorage.setItem(StorageKeys.WYSIWYG_PREVIEW, sanitized);

      // Dispatch custom event to open in Pathfinder
      const event = new CustomEvent('pathfinder-auto-open-docs', {
        detail: {
          url: 'bundled:wysiwyg-preview',
          title: 'Preview: WYSIWYG Guide',
          origin: 'wysiwyg-editor',
        },
      });
      document.dispatchEvent(event);

      debug('[useEditorActions] Dispatched test guide event');
    } catch (error) {
      logError('[useEditorActions] Failed to test guide:', error);
    }
  }, [editor]);

  // Reset editor to default content
  const resetGuide = useCallback(() => {
    debug('[useEditorActions] Resetting guide');
    if (!editor) {
      debug('[useEditorActions] No editor found');
      return;
    }

    try {
      // SECURITY: sanitize before save (F1, F4)
      debug('[useEditorActions] Sanitizing default content');
      const sanitized = sanitizeDocumentationHTML(EDITOR_DEFAULTS.INITIAL_CONTENT);
      debug('[useEditorActions] Setting sanitized content');
      editor.commands.setContent(sanitized);
      localStorage.setItem(StorageKeys.WYSIWYG_PREVIEW, sanitized);

      debug('[useEditorActions] Reset to default content');
    } catch (error) {
      logError('[useEditorActions] Failed to reset guide:', error);
    }
  }, [editor]);

  return {
    copyHTML,
    downloadHTML,
    testGuide,
    resetGuide,
  };
}

