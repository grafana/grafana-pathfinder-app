import React, { useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { Button, Stack } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';

// Extensions
import {
  InteractiveListItem,
  InteractiveSpan,
  InteractiveComment,
  SequenceSection,
  InteractiveClickHandler,
} from './extensions';

// Components
import Toolbar from './Toolbar';
import FormModal from './FormModal';

// Hooks
import { useEditState } from './hooks/useEditState';

// Utils
import { formatHTML } from './utils/htmlFormatter';
import { debug, error as logError } from './utils/logger';

// Security
import { sanitizeDocumentationHTML } from '../../security';

// Constants
import { EDITOR_DEFAULTS } from '../../constants/editor-config';

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
    content: EDITOR_DEFAULTS.INITIAL_CONTENT,
    editorProps: {
      attributes: {
        class: `ProseMirror ${editorStyles.proseMirror}`,
      },
    },
  });

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

    const { from, to } = editor.state.selection;
    
    // Only add comment if text is selected
    if (from === to) {
      // TODO: Show toast notification
      debug('[WysiwygEditor] No text selected for comment');
      return;
    }

    // Toggle comment on selected text
    editor.chain().focus().toggleInteractiveComment().run();
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

  return (
    <div className={styles.container}>
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
        <Stack gap={1}>
          <Button icon="copy" variant="secondary" onClick={handleCopyHTML}>
            Copy
          </Button>
          <Button icon="download-alt" variant="secondary" onClick={handleDownloadHTML}>
            Download
          </Button>
        </Stack>
      </div>

      <FormModal
        isOpen={isModalOpen}
        onClose={handleModalClose}
        editor={editor}
        editState={editState}
        onFormSubmit={handleFormSubmit}
      />
    </div>
  );
};

export default WysiwygEditor;

