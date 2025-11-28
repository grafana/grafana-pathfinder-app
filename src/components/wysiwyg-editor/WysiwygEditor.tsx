import React, { useRef, useEffect, useCallback } from 'react';
import { EditorContent } from '@tiptap/react';
import { useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';

// Components
import Toolbar from './Toolbar';
import FormPanel from './FormPanel';
import CommentDialog from './CommentDialog';
import BubbleMenuBar from './BubbleMenuBar';
import { FullScreenModeOverlay } from './FullScreenModeOverlay';

// Hooks
import { useEditState } from './hooks/useEditState';
import { useEditorInitialization } from './hooks/useEditorInitialization';
import { useEditorPersistence } from './hooks/useEditorPersistence';
import { useEditorActions } from './hooks/useEditorActions';
import { useEditorModals } from './hooks/useEditorModals';
import { useFullScreenMode } from './hooks/useFullScreenMode';

// Styles
import { getSharedPanelStyles } from './editor.styles';

// Test IDs
import { testIds } from '../testIds';

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
  editorWrapperHidden: css({
    visibility: 'hidden',
    position: 'absolute',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
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
 * Main WYSIWYG editor for creating interactive guides.
 * Integrates Tiptap editor with custom extensions, toolbar, and form modal.
 */
export const WysiwygEditor: React.FC = () => {
  const styles = useStyles2(getStyles);
  const sharedStyles = useStyles2(getSharedPanelStyles);
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
    initialSelectedActionType,
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

  // Full screen authoring mode
  // Pause click interception when form panel is open (so sidebar capture mode can work)
  const fullScreenMode = useFullScreenMode({ editor, pauseInterception: isModalOpen });

  // Toggle full screen mode
  const handleToggleFullScreen = useCallback(() => {
    if (fullScreenMode.isActive) {
      fullScreenMode.exitFullScreenMode();
    } else {
      fullScreenMode.enterFullScreenMode();
    }
  }, [fullScreenMode]);

  return (
    <div className={`${styles.container} wysiwyg-editor-container`} data-testid={testIds.wysiwygEditor.container}>
      {/* Editor wrapper - hidden when form is open, but remains in DOM for auto-save */}
      <div className={`${sharedStyles.wrapper} ${isModalOpen ? styles.editorWrapperHidden : ''}`}>
        <Toolbar
          editor={editor}
          onAddInteractive={handleAddInteractive}
          onAddSequence={handleAddSequence}
          onAddComment={handleAddComment}
          onCopy={copyHTML}
          onDownload={downloadHTML}
          onTest={testGuide}
          onReset={resetGuide}
          onToggleFullScreen={handleToggleFullScreen}
          isFullScreenActive={fullScreenMode.isActive}
        />

        <div className={sharedStyles.content} data-testid={testIds.wysiwygEditor.editorContent}>
          <EditorContent editor={editor} />
          {/* Floating bubble menu for text selection formatting */}
          <BubbleMenuBar editor={editor} />
        </div>
      </div>

      {/* Form panel - shown when form is open, uses same CSS sizing as editorWrapper */}
      {isModalOpen && (
        <FormPanel
          onClose={closeModal}
          editor={editor}
          editState={editState}
          onFormSubmit={handleFormSubmit}
          onSwitchType={stopEditing}
          initialSelectedActionType={initialSelectedActionType}
        />
      )}

      <CommentDialog
        isOpen={isCommentDialogOpen}
        onClose={closeCommentDialog}
        editor={editor}
        onInsert={handleInsertComment}
        initialText={commentDialogInitialText}
        mode={commentDialogMode}
      />

      {/* Full Screen Mode Overlay - renders tooltip, step editor, and minimized sidebar */}
      <FullScreenModeOverlay editor={editor} fullScreenState={fullScreenMode} />
    </div>
  );
};

export default WysiwygEditor;
