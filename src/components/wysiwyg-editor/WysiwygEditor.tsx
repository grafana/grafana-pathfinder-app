import React, { useRef, useEffect } from 'react';
import { EditorContent } from '@tiptap/react';
import { useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';

// Components
import Toolbar from './Toolbar';
import FormPanel from './FormPanel';
import CommentDialog from './CommentDialog';

// Hooks
import { useEditState } from './hooks/useEditState';
import { useEditorInitialization } from './hooks/useEditorInitialization';
import { useEditorPersistence } from './hooks/useEditorPersistence';
import { useEditorActions } from './hooks/useEditorActions';
import { useEditorModals } from './hooks/useEditorModals';

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
    padding: theme.spacing(2),
    height: '100%',
    backgroundColor: theme.colors.background.primary,
    position: 'relative', // Needed for absolute positioning of hidden editor
  }),
  editorWrapper: css({
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
    overflow: 'hidden',
  }),
  editorWrapperHidden: css({
    visibility: 'hidden',
    position: 'absolute',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
  }),
  editorContent: css({
    flex: 1,
    overflow: 'auto',
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    backgroundColor: theme.colors.background.primary,
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
  const { editState, startEditing, stopEditing } = useEditState();

  // Use ref to store openModal callback to break circular dependency
  // This allows useEditorInitialization to call openModal before useEditorModals is initialized
  const openModalRef = useRef<() => void>(() => {});

  // Initialize editor with modal callback from ref
  const { editor } = useEditorInitialization({
    startEditing,
    stopEditing,
    onModalOpen: () => openModalRef.current(),
  });

  // Initialize modals with editor instance
  const {
    isModalOpen,
    isCommentDialogOpen,
    openModal,
    closeModal,
    closeCommentDialog,
    handleAddInteractive,
    handleAddSequence,
    handleAddComment,
    handleInsertComment,
    handleFormSubmit,
    commentDialogMode,
    commentDialogInitialText,
  } = useEditorModals({
    editor,
    editState,
    startEditing,
    stopEditing,
  });

  // Update ref when openModal changes
  useEffect(() => {
    openModalRef.current = openModal;
  }, [openModal]);

  // Open modal when editState changes (for non-comment elements)
  useEffect(() => {
    if (editState && editState.type !== 'comment' && !isModalOpen) {
      openModal();
    }
  }, [editState, isModalOpen, openModal]);

  // Auto-save functionality (indicator removed, but auto-save still needed)
  useEditorPersistence({ editor });

  const { copyHTML, downloadHTML, testGuide, resetGuide } = useEditorActions({ editor });

  return (
    <div className={`${styles.container} wysiwyg-editor-container`}>
      {/* Editor wrapper - hidden when form is open, but remains in DOM for auto-save */}
      <div className={`${styles.editorWrapper} ${isModalOpen ? styles.editorWrapperHidden : ''}`}>
        <Toolbar
          editor={editor}
          onAddInteractive={handleAddInteractive}
          onAddSequence={handleAddSequence}
          onAddComment={handleAddComment}
          onCopy={copyHTML}
          onDownload={downloadHTML}
          onTest={testGuide}
          onReset={resetGuide}
        />

        <div className={styles.editorContent}>
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* Form panel - shown when form is open, uses same CSS sizing as editorWrapper */}
      {isModalOpen && (
        <FormPanel onClose={closeModal} editor={editor} editState={editState} onFormSubmit={handleFormSubmit} />
      )}

      <CommentDialog
        isOpen={isCommentDialogOpen}
        onClose={closeCommentDialog}
        editor={editor}
        onInsert={handleInsertComment}
        initialText={commentDialogInitialText}
        mode={commentDialogMode}
      />
    </div>
  );
};

export default WysiwygEditor;
