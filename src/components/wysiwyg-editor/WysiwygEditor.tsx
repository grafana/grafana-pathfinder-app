import React, { useRef, useEffect } from 'react';
import { EditorContent } from '@tiptap/react';
import { Button, Stack, Icon, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';

// Components
import Toolbar from './Toolbar';
import FormModal from './FormModal';
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
  const { editState, startEditing, stopEditing } = useEditState();

  // Use ref to store openModal callback to break circular dependency
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

  const { isSaving } = useEditorPersistence({ editor });

  const { copyHTML, downloadHTML, testGuide, resetGuide } = useEditorActions({ editor });

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
            <Button icon="copy" variant="secondary" onClick={copyHTML}>
              Copy
            </Button>
            <Button icon="download-alt" variant="secondary" onClick={downloadHTML}>
              Download
            </Button>
            <Button icon="play" variant="primary" onClick={testGuide}>
              Test
            </Button>
            <Button icon="arrow-from-right" variant="secondary" onClick={resetGuide}>
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
        onClose={closeModal}
        editor={editor}
        editState={editState}
        onFormSubmit={handleFormSubmit}
      />

      <CommentDialog
        isOpen={isCommentDialogOpen}
        onClose={closeCommentDialog}
        editor={editor}
        onInsert={handleInsertComment}
      />
    </div>
  );
};

export default WysiwygEditor;

