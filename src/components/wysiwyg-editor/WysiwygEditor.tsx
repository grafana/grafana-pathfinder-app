import React, { useState, useCallback, useEffect, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { Button, Stack, Icon, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';

// Extensions
import {
  InteractiveListItem,
  InteractiveSpan,
  InteractiveComment,
  SequenceSection,
  InteractiveClickHandler,
  PasteSanitizer,
} from './extensions';

// Components
import Toolbar from './Toolbar';
import FormModal from './FormModal';
import CommentDialog from './CommentDialog';

// Hooks
import { useEditState } from './hooks/useEditState';

// Utils
import { formatHTML } from './utils/htmlFormatter';
import { debug, error as logError } from './utils/logger';

// Security
import { sanitizeDocumentationHTML } from '../../security';

// Constants
import { EDITOR_DEFAULTS } from '../../constants/editor-config';

// Storage
import { StorageKeys } from '../../lib/user-storage';

// Styles
import { getEditorStyles } from './editor.styles';

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
    padding: theme.spacing(2),
    height: '100%',
    backgroundColor: theme.colors.background.primary,
  }),
  editorWrapper: css({
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
    overflow: 'hidden',
  }),
  editorContent: css({
    flex: 1,
    overflow: 'auto',
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    backgroundColor: theme.colors.background.primary,
  }),
  actions: css({
    display: 'flex',
    gap: theme.spacing(1),
    padding: theme.spacing(2),
    borderTop: `1px solid ${theme.colors.border.weak}`,
    backgroundColor: theme.colors.background.secondary,
  }),
  title: css({
    fontSize: theme.typography.h2.fontSize,
    fontWeight: theme.typography.h2.fontWeight,
    margin: 0,
    color: theme.colors.text.primary,
  }),
  savingIndicator: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.success.text,
  }),
});

/**
 * WysiwygEditor Component
 * 
 * Main WYSIWYG editor for creating interactive tutorials.
 * Integrates Tiptap editor with custom extensions, toolbar, and form modal.
 */
export const WysiwygEditor: React.FC = () => {
  const styles = useStyles2(getStyles);
  const editorStyles = useStyles2(getEditorStyles);
  const { editState, startEditing, stopEditing } = useEditState();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCommentDialogOpen, setIsCommentDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
          debug('[WysiwygEditor] Edit list item clicked', { attributes, pos });
          startEditing('listItem', attributes, pos);
          setIsModalOpen(true);
        },
        onEditSequenceSection: (attributes, pos) => {
          debug('[WysiwygEditor] Edit sequence section clicked', { attributes, pos });
          startEditing('sequence', attributes, pos);
          setIsModalOpen(true);
        },
        onEditInteractiveSpan: (attributes, pos) => {
          debug('[WysiwygEditor] Edit interactive span clicked', { attributes, pos });
          startEditing('span', attributes, pos);
          setIsModalOpen(true);
        },
        onEditInteractiveComment: (attributes, pos) => {
          debug('[WysiwygEditor] Edit interactive comment clicked', { attributes, pos });
          startEditing('comment', attributes, pos);
          setIsModalOpen(true);
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
        debug('[WysiwygEditor] Loading saved content from localStorage');
        editor.commands.setContent(sanitized);
      } else {
        // No saved content, use default
        debug('[WysiwygEditor] No saved content, using defaults');
        editor.commands.setContent(EDITOR_DEFAULTS.INITIAL_CONTENT);
      }
    } catch (error) {
      logError('[WysiwygEditor] Failed to load saved content:', error);
      // Fallback to default on error
      editor.commands.setContent(EDITOR_DEFAULTS.INITIAL_CONTENT);
    }
  }, [editor]);

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

      // Set new timeout (debounce 1 second)
      saveTimeoutRef.current = setTimeout(() => {
        try {
          const html = editor.getHTML();
          
          // SECURITY: sanitize before save (F1, F4)
          const sanitized = sanitizeDocumentationHTML(html);
          localStorage.setItem(StorageKeys.WYSIWYG_PREVIEW, sanitized);
          
          setIsSaving(true);
          
          // Clear saving indicator after 1 second
          setTimeout(() => setIsSaving(false), 1000);
          
          debug('[WysiwygEditor] Auto-saved to localStorage');
        } catch (error) {
          logError('[WysiwygEditor] Failed to auto-save:', error);
        }
      }, 1000);
    };

    editor.on('update', handleUpdate);

    return () => {
      editor.off('update', handleUpdate);
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [editor]);

  // Handle form submission
  const handleFormSubmit = (attributes: Record<string, any>) => {
    if (!editor || !editState) {
      return;
    }

    debug('[WysiwygEditor] Form submitted', { attributes, editState });

    // Update attributes based on element type
    const { type } = editState;

    try {
      switch (type) {
        case 'listItem':
          editor.commands.updateAttributes('listItem', attributes);
          break;
        case 'sequence':
          editor.commands.updateAttributes('sequenceSection', attributes);
          break;
        case 'span':
          editor.commands.updateAttributes('interactiveSpan', attributes);
          break;
        case 'comment':
          editor.commands.updateAttributes('interactiveComment', attributes);
          break;
      }

      debug('[WysiwygEditor] Attributes updated successfully');
    } catch (error) {
      logError('[WysiwygEditor] Failed to update attributes:', error);
    }

    stopEditing();
  };

  // Handle modal close
  const handleModalClose = () => {
    setIsModalOpen(false);
    stopEditing();
  };

  // Handle adding interactive action
  const handleAddInteractive = () => {
    debug('[WysiwygEditor] Add interactive action clicked');
    // Open modal with no edit state to show action selector
    stopEditing();
    setIsModalOpen(true);
  };

  // Handle adding sequence section
  const handleAddSequence = () => {
    debug('[WysiwygEditor] Add sequence section clicked');
    if (!editor) {
      return;
    }

    // Insert a new sequence section at cursor
    editor
      .chain()
      .focus()
      .insertContent({
        type: 'sequenceSection',
        attrs: {
          'data-targetaction': 'sequence',
          'data-reftarget': 'span#guide-section-1',
          class: 'interactive',
        },
        content: [
          {
            type: 'heading',
            attrs: { level: 3 },
            content: [{ type: 'text', text: 'Section Title' }],
          },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Step 1' }],
                  },
                ],
              },
            ],
          },
        ],
      })
      .run();
  };

  // Handle adding comment
  const handleAddComment = () => {
    debug('[WysiwygEditor] Add comment clicked');
    if (!editor) {
      return;
    }

    // Open comment dialog
    setIsCommentDialogOpen(true);
  };

  // Handle inserting comment from dialog
  const handleInsertComment = (commentText: string) => {
    if (!editor || !commentText.trim()) {
      return;
    }

    debug('[WysiwygEditor] Inserting comment', { commentText });

    try {
      // Insert comment at cursor position
      // TipTap will automatically handle the text content
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'interactiveComment',
          attrs: {
            class: 'interactive-comment',
          },
          content: [{ type: 'text', text: commentText }],
        })
        .run();

      debug('[WysiwygEditor] Comment inserted successfully');
    } catch (error) {
      logError('[WysiwygEditor] Failed to insert comment:', error);
    }
  };

  // Copy HTML to clipboard
  const handleCopyHTML = async () => {
    if (!editor) {
      return;
    }

    try {
      const html = editor.getHTML();
      // SECURITY: sanitized HTML before export to prevent XSS (F1, F4)
      const sanitized = sanitizeDocumentationHTML(html);
      const formatted = await formatHTML(sanitized);
      await navigator.clipboard.writeText(formatted);
      debug('[WysiwygEditor] HTML copied to clipboard');
      // TODO: Show success toast
    } catch (error) {
      logError('[WysiwygEditor] Failed to copy HTML:', error);
      // TODO: Show error toast
    }
  };

  // Download HTML as file
  const handleDownloadHTML = async () => {
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
      }, 100);
      
      debug('[WysiwygEditor] HTML downloaded');
      // TODO: Show success toast
    } catch (error) {
      logError('[WysiwygEditor] Failed to download HTML:', error);
      // TODO: Show error toast
    }
  };

  // Test Guide in Pathfinder
  const handleTestGuide = useCallback(() => {
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
      
      debug('[WysiwygEditor] Dispatched test guide event');
    } catch (error) {
      logError('[WysiwygEditor] Failed to test guide:', error);
    }
  }, [editor]);

  // Reset editor to default content
  const handleResetGuide = useCallback(() => {
    console.log('RESET: ');
    if (!editor) {
      console.log('[WysiwygEditor] No editor found');
      return;
    }

    try {      
      // SECURITY: sanitize before save (F1, F4)
      console.log('SANITIZE: ', EDITOR_DEFAULTS.INITIAL_CONTENT);
      const sanitized = sanitizeDocumentationHTML(EDITOR_DEFAULTS.INITIAL_CONTENT);
      console.log('SET: ', sanitized);
      editor.commands.setContent(sanitized);
      localStorage.setItem(StorageKeys.WYSIWYG_PREVIEW, sanitized);
      
      debug('[WysiwygEditor] Reset to default content');
    } catch (error) {
      logError('[WysiwygEditor] Failed to reset guide:', error);
    }
  }, [editor]);

  return (
    <div className={`${styles.container} wysiwyg-editor-container`}>
      <div className={styles.editorWrapper}>
        <Toolbar
          editor={editor}
          onAddInteractive={handleAddInteractive}
          onAddSequence={handleAddSequence}
          onAddComment={handleAddComment}
        />
        
        <div className={styles.editorContent}>
          <EditorContent editor={editor} />
        </div>
      </div>

      <div className={styles.actions}>
        <Stack gap={1} direction="row" justifyContent="space-between" alignItems="center">
          <Stack gap={1}>
            <Button icon="copy" variant="secondary" onClick={handleCopyHTML}>
              Copy
            </Button>
            <Button icon="download-alt" variant="secondary" onClick={handleDownloadHTML}>
              Download
            </Button>
            <Button icon="play" variant="primary" onClick={handleTestGuide}>
              Test
            </Button>
            <Button icon="arrow-from-right" variant="secondary" onClick={handleResetGuide}>
              Reset
            </Button>
          </Stack>
          
          {isSaving && (
            <span className={styles.savingIndicator}>
              <Icon name="check" size="sm" /> Saved
            </span>
          )}
        </Stack>
      </div>

      <FormModal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        editor={editor}
        editState={editState}
        onFormSubmit={handleFormSubmit}
      />

      <CommentDialog
        isOpen={isCommentDialogOpen}
        onClose={() => setIsCommentDialogOpen(false)}
        editor={editor}
        onInsert={handleInsertComment}
      />
    </div>
  );
};

export default WysiwygEditor;

