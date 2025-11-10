import { useEffect } from 'react';
import { useEditor, type Editor } from '@tiptap/react';
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

export interface UseEditorInitializationOptions {
  startEditing: (type: InteractiveElementType, attributes: Record<string, string>, pos: number) => void;
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
          onModalOpen();
        },
        onEditSequenceSection: (attributes, pos) => {
          debug('[useEditorInitialization] Edit sequence section clicked', { attributes, pos });
          startEditing('sequence', attributes, pos);
          onModalOpen();
        },
        onEditInteractiveSpan: (attributes, pos) => {
          debug('[useEditorInitialization] Edit interactive span clicked', { attributes, pos });
          startEditing('span', attributes, pos);
          onModalOpen();
        },
        onEditInteractiveComment: (attributes, pos) => {
          debug('[useEditorInitialization] Edit interactive comment clicked', { attributes, pos });
          startEditing('comment', attributes, pos);
          onModalOpen();
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
  useEffect(() => {
    if (!editor) {
      return;
    }

    try {
      const savedContent = localStorage.getItem(StorageKeys.WYSIWYG_PREVIEW);

      if (savedContent && savedContent.trim() !== '') {
        // SECURITY: sanitize on load (defense in depth, F1, F4)
        const sanitized = sanitizeDocumentationHTML(savedContent);
        debug('[useEditorInitialization] Loading saved content from localStorage');
        editor.commands.setContent(sanitized);
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

