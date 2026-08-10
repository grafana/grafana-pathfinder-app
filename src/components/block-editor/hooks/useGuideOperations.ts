/**
 * useGuideOperations Hook
 *
 * Handles guide-level operations including:
 * - Copy guide to clipboard
 * - Download guide as JSON file
 * - Import guide from JSON
 * - Load template guide
 *
 * Extracted from BlockEditor to reduce component complexity.
 */

import { useCallback } from 'react';
import type { JsonGuide } from '../types';
import type { ModalName } from './useModalManager';
import blockEditorTutorial from '../../../bundled-interactives/block-editor-tutorial/content.json';
import { editorGuideIdExists } from '../editor-tab-storage';

/** Converts a guide title to a URL-safe kebab-case slug */
export function slugifyTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'guide'
  );
}

/** Generates a guide ID that avoids backend resources and sibling local drafts. */
export function generateUniqueId(title: string, existingNames: string[] = []): string {
  const base = slugifyTitle(title);
  for (let i = 0; i < 20; i++) {
    const suffix = Math.random().toString(36).slice(2, 6);
    const candidate = `${base}-${suffix}`;
    if (!existingNames.includes(candidate) && !editorGuideIdExists(candidate)) {
      return candidate;
    }
  }
  return `${base}-${Date.now().toString(36).slice(-6)}`;
}

/**
 * Minimal interface for editor functionality needed by this hook.
 */
export interface GuideOpsEditorInterface {
  /** Get the current guide */
  getGuide: () => JsonGuide;
  /** Load a guide into the editor */
  loadGuide: (guide: JsonGuide, savedBlockIds?: string[]) => void;
}

/**
 * Minimal interface for modal manager needed by this hook.
 */
export interface GuideOpsModalInterface {
  /** Close a modal by name */
  close: (name: ModalName) => void;
}

/**
 * Options for useGuideOperations hook.
 */
export interface UseGuideOperationsOptions {
  /** Editor instance for guide operations */
  editor: GuideOpsEditorInterface;
  /** Modal manager for controlling modals */
  modals: GuideOpsModalInterface;
  /** Optional custom copy handler */
  onCopy?: (json: string) => void;
  /** Optional custom download handler */
  onDownload?: (guide: JsonGuide) => void;
  /** Clear backend resource binding */
  onClearBackendTracking?: () => void;
}

/**
 * Return type for useGuideOperations hook.
 */
export interface UseGuideOperationsReturn {
  /** Copy guide JSON to clipboard */
  handleCopy: () => void;
  /** Download guide as JSON file */
  handleDownload: () => void;
  /** Import a guide from JSON */
  handleImportGuide: (guide: JsonGuide) => void;
  /** Load the example template guide */
  handleLoadTemplate: () => void;
}

/**
 * Handles guide-level operations.
 * Encapsulates all guide operations extracted from BlockEditor.
 */
export function useGuideOperations(options: UseGuideOperationsOptions): UseGuideOperationsReturn {
  const { editor, modals, onCopy, onDownload, onClearBackendTracking } = options;

  // Copy guide JSON to clipboard
  const handleCopy = useCallback(() => {
    const guide = editor.getGuide();
    const json = JSON.stringify(guide, null, 2);

    if (onCopy) {
      onCopy(json);
    } else {
      navigator.clipboard.writeText(json).then(() => {
        // Could add a toast notification here
        console.log('Copied to clipboard');
      });
    }
  }, [editor, onCopy]);

  // Download guide as JSON file (opens in new tab)
  const handleDownload = useCallback(() => {
    const guide = editor.getGuide();

    if (onDownload) {
      onDownload(guide);
    } else {
      const json = JSON.stringify(guide, null, 2);
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
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
    }
  }, [editor, onDownload]);

  // Import a guide from JSON
  const handleImportGuide = useCallback(
    (guide: JsonGuide) => {
      editor.loadGuide(guide);
      onClearBackendTracking?.();
      modals.close('import');
    },
    [editor, modals, onClearBackendTracking]
  );

  // Load the example template guide
  const handleLoadTemplate = useCallback(() => {
    editor.loadGuide(blockEditorTutorial as JsonGuide);
    onClearBackendTracking?.();
  }, [editor, onClearBackendTracking]);

  return {
    handleCopy,
    handleDownload,
    handleImportGuide,
    handleLoadTemplate,
  };
}
