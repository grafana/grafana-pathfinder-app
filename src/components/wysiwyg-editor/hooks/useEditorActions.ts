import { useCallback, useState } from 'react';
import type { Editor } from '@tiptap/react';

// Utils
import { debug, error as logError } from '../utils/logger';

// Security
import { sanitizeDocumentationHTML } from '../../../security';

// Constants
import { EDITOR_DEFAULTS } from '../../../constants/editor-config';

// Storage
import { StorageKeys } from '../../../lib/user-storage';

// JSON Converter
import { convertEditorToJson, formatJsonGuide, type GuideMetadata } from '../services/editorToJson';

export type ExportMode = 'copy' | 'download';

export interface UseEditorActionsOptions {
  editor: Editor | null;
}

export interface UseEditorActionsReturn {
  // Export dialog state
  isExportDialogOpen: boolean;
  exportMode: ExportMode;
  openExportDialog: (mode: ExportMode) => void;
  closeExportDialog: () => void;

  // Export actions (called after dialog provides metadata)
  performExport: (metadata: GuideMetadata) => Promise<void>;

  // Other actions
  testGuide: () => void;
  resetGuide: () => void;
}

/**
 * Hook for managing editor actions: export (copy/download JSON), test, and reset
 */
export function useEditorActions({ editor }: UseEditorActionsOptions): UseEditorActionsReturn {
  // Export dialog state
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [exportMode, setExportMode] = useState<ExportMode>('copy');

  // Open export dialog with specified mode
  const openExportDialog = useCallback((mode: ExportMode) => {
    setExportMode(mode);
    setIsExportDialogOpen(true);
  }, []);

  // Close export dialog
  const closeExportDialog = useCallback(() => {
    setIsExportDialogOpen(false);
  }, []);

  // Perform export (copy or download) with the provided metadata
  const performExport = useCallback(
    async (metadata: GuideMetadata) => {
      if (!editor) {
        return;
      }

      try {
        // Convert editor content to JSON
        const { guide, warnings } = convertEditorToJson(editor, metadata);

        // Log any conversion warnings
        if (warnings.length > 0) {
          debug('[useEditorActions] Conversion warnings:', warnings);
        }

        // Format as pretty-printed JSON
        const jsonString = formatJsonGuide(guide);

        if (exportMode === 'copy') {
          // Copy JSON to clipboard
          await navigator.clipboard.writeText(jsonString);
          debug('[useEditorActions] JSON copied to clipboard', { guideId: guide.id });
        } else {
          // Open JSON in new tab - user can save with Cmd+S / Ctrl+S
          const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
          const url = URL.createObjectURL(blob);

          // Open in new window/tab
          const newWindow = window.open(url, '_blank');

          // Revoke URL after window loads to free memory
          if (newWindow) {
            newWindow.onload = () => {
              URL.revokeObjectURL(url);
            };
          } else {
            // If popup was blocked, revoke immediately
            URL.revokeObjectURL(url);
          }

          debug('[useEditorActions] JSON opened in new tab', { guideId: guide.id });
        }
      } catch (error) {
        logError('[useEditorActions] Failed to export:', error);
      }
    },
    [editor, exportMode]
  );

  // Test Guide in Pathfinder - converts to JSON format for preview
  const testGuide = useCallback(() => {
    if (!editor) {
      return;
    }

    try {
      // Convert editor content to JSON guide format
      const { guide, warnings } = convertEditorToJson(editor, {
        id: 'wysiwyg-preview',
        title: 'Preview: WYSIWYG Guide',
      });

      // Log any conversion warnings for debugging
      if (warnings.length > 0) {
        debug('[useEditorActions] Test guide conversion warnings:', warnings);
      }

      // Format as JSON string
      const jsonString = formatJsonGuide(guide);

      // Save JSON to separate localStorage key for preview (not the editor's HTML key)
      localStorage.setItem(StorageKeys.WYSIWYG_PREVIEW_JSON, jsonString);

      // Dispatch custom event to open in Pathfinder
      const event = new CustomEvent('pathfinder-auto-open-docs', {
        detail: {
          url: 'bundled:wysiwyg-preview',
          title: guide.title,
          origin: 'wysiwyg-editor',
        },
      });
      document.dispatchEvent(event);

      debug('[useEditorActions] Dispatched test guide event with JSON content', {
        blockCount: guide.blocks.length,
      });
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
    // Export dialog state
    isExportDialogOpen,
    exportMode,
    openExportDialog,
    closeExportDialog,

    // Export action
    performExport,

    // Other actions
    testGuide,
    resetGuide,
  };
}
