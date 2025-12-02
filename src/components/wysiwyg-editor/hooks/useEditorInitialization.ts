import { useEffect } from 'react';
import { useEditor, type Editor, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { useStyles2 } from '@grafana/ui';

// Extensions
import {
  InteractiveListItem,
  InteractiveSpan,
  InteractiveComment,
  SequenceSection,
  InteractiveClickHandler,
  PasteSanitizer,
} from '../extensions';

// Utils
import { debug, error as logError } from '../utils/logger';

// Security
import { sanitizeDocumentationHTML } from '../../../security';

// Constants
import { EDITOR_DEFAULTS } from '../../../constants/editor-config';

// Storage
import { StorageKeys } from '../../../lib/user-storage';

// Styles
import { getEditorStyles } from '../editor.styles';

// Types
import type { InteractiveElementType } from '../types';

/**
 * Parse stored content, detecting JSON vs HTML format.
 * Supports migration from old HTML format to new TipTap JSON format.
 * @param stored - Raw string from localStorage
 * @returns TipTap JSONContent or sanitized HTML string
 */
function parseStoredContent(stored: string): JSONContent | string {
  const trimmed = stored.trim();

  // Detect JSON format (TipTap native)
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      // Verify it looks like TipTap JSON (has type: 'doc')
      if (parsed.type === 'doc' && Array.isArray(parsed.content)) {
        debug('[useEditorInitialization] Detected TipTap JSON format');
        return parsed as JSONContent;
      }
    } catch {
      // Fall through to HTML handling
      debug('[useEditorInitialization] JSON parse failed, treating as HTML');
    }
  }

  // HTML format (legacy) - sanitize and let TipTap parse it
  // Next save will automatically convert to JSON format
  debug('[useEditorInitialization] Detected HTML format (legacy), will migrate on next save');
  return sanitizeDocumentationHTML(stored);
}

export interface UseEditorInitializationOptions {
  startEditing: (
    type: InteractiveElementType,
    attributes: Record<string, string>,
    pos: number,
    commentText?: string
  ) => void;
  stopEditing: () => void;
  onModalOpen: () => void;
}

export interface UseEditorInitializationReturn {
  editor: Editor | null;
  editorStyles: ReturnType<typeof getEditorStyles>;
}

/**
 * Hook for initializing the Tiptap editor with all extensions and loading initial content
 */
export function useEditorInitialization({
  startEditing,
  stopEditing,
  onModalOpen,
}: UseEditorInitializationOptions): UseEditorInitializationReturn {
  const editorStyles = useStyles2(getEditorStyles);

  // Initialize Tiptap editor with all extensions
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Disable default listItem to use our custom one
        listItem: false,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
      InteractiveListItem,
      InteractiveSpan,
      InteractiveComment,
      SequenceSection,
      PasteSanitizer,
      InteractiveClickHandler.configure({
        onEditInteractiveListItem: (attributes, pos) => {
          debug('[useEditorInitialization] Edit list item clicked', { attributes, pos });
          startEditing('listItem', attributes, pos);
          // Modal will be opened by useEffect in WysiwygEditor based on editState
          onModalOpen();
        },
        onEditSequenceSection: (attributes, pos) => {
          debug('[useEditorInitialization] Edit sequence section clicked', { attributes, pos });
          startEditing('sequence', attributes, pos);
          // Modal will be opened by useEffect in WysiwygEditor based on editState
          onModalOpen();
        },
        onEditInteractiveSpan: (attributes, pos) => {
          debug('[useEditorInitialization] Edit interactive span clicked', { attributes, pos });
          startEditing('span', attributes, pos);
          // Modal will be opened by useEffect in WysiwygEditor based on editState
          onModalOpen();
        },
        onEditInteractiveComment: (attributes, pos, text) => {
          debug('[useEditorInitialization] Edit interactive comment clicked', { attributes, pos, text });
          startEditing('comment', attributes, pos, text);
          // CommentDialog is opened by useCommentDialog hook based on editState
        },
      }),
    ],
    editorProps: {
      attributes: {
        class: `ProseMirror ${editorStyles.proseMirror}`,
      },
    },
  });

  // Load saved content from localStorage on mount (or use default if empty)
  // Supports both TipTap JSON (new) and HTML (legacy) formats for migration
  useEffect(() => {
    if (!editor) {
      return;
    }

    try {
      const savedContent = localStorage.getItem(StorageKeys.WYSIWYG_PREVIEW);

      if (savedContent && savedContent.trim() !== '') {
        // Parse content - handles both JSON and HTML formats
        const content = parseStoredContent(savedContent);
        debug('[useEditorInitialization] Loading saved content from localStorage');
        editor.commands.setContent(content);
      } else {
        // No saved content, use default
        debug('[useEditorInitialization] No saved content, using defaults');
        editor.commands.setContent(EDITOR_DEFAULTS.INITIAL_CONTENT);
      }
    } catch (error) {
      logError('[useEditorInitialization] Failed to load saved content:', error);
      // Fallback to default on error
      editor.commands.setContent(EDITOR_DEFAULTS.INITIAL_CONTENT);
    }
  }, [editor]);

  return {
    editor,
    editorStyles,
  };
}
