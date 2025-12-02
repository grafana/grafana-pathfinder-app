import React, { useState } from 'react';
import { Modal, Button, TextArea, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { Editor } from '@tiptap/react';
import { testIds } from '../testIds';

interface CommentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  editor: Editor | null;
  onInsert: (commentText: string) => void;
  onDelete?: () => void;
  initialText?: string;
  mode?: 'insert' | 'edit';
}

const getStyles = (theme: GrafanaTheme2) => ({
  modalContent: css({
    padding: theme.spacing(2),
  }),
  modal: css({
    width: '500px',
    maxWidth: '90vw',
  }),
  form: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
  }),
  buttonGroup: css({
    display: 'flex',
    gap: theme.spacing(1),
    justifyContent: 'flex-end',
  }),
  deleteButton: css({
    marginRight: 'auto',
  }),
});

/**
 * CommentDialog Component
 *
 * A simple dialog for entering comment text that will be inserted
 * into the editor as an interactive comment at the cursor position.
 */
export const CommentDialog: React.FC<CommentDialogProps> = ({
  isOpen,
  onClose,
  editor,
  onInsert,
  onDelete,
  initialText = '',
  mode = 'insert',
}) => {
  const styles = useStyles2(getStyles);
  const [commentText, setCommentText] = useState('');

  // Set comment text when dialog opens
  React.useEffect(() => {
    if (isOpen) {
      if (mode === 'edit' && initialText) {
        setCommentText(initialText);
      } else {
        setCommentText('');
      }
    }
  }, [isOpen, mode, initialText]);

  const handleInsert = () => {
    const trimmedText = commentText.trim();
    if (!trimmedText || !editor) {
      return;
    }

    onInsert(trimmedText);
    setCommentText('');
    onClose();
  };

  const handleCancel = () => {
    setCommentText('');
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Allow Ctrl/Cmd+Enter to submit
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleInsert();
    }
    // Escape to cancel
    if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  // Don't render modal at all when closed
  if (!isOpen) {
    return null;
  }

  const isValid = commentText.trim().length > 0;

  const modalTitle = mode === 'edit' ? 'Edit comment' : 'Add comment';
  const buttonText = mode === 'edit' ? 'Update' : 'Insert';

  return (
    <Modal
      title={modalTitle}
      isOpen={isOpen}
      onDismiss={handleCancel}
      className={styles.modal}
      data-testid={testIds.wysiwygEditor.commentDialog.modal}
    >
      <div className={styles.modalContent}>
        <div className={styles.form}>
          <TextArea
            value={commentText}
            onChange={(e) => setCommentText(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter comment text..."
            rows={4}
            autoFocus
            data-testid={testIds.wysiwygEditor.commentDialog.textArea}
          />
          <div className={styles.buttonGroup}>
            {mode === 'edit' && onDelete && (
              <Button
                variant="destructive"
                onClick={onDelete}
                className={styles.deleteButton}
                data-testid={testIds.wysiwygEditor.commentDialog.deleteButton}
              >
                Delete
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={handleCancel}
              data-testid={testIds.wysiwygEditor.commentDialog.cancelButton}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleInsert}
              disabled={!isValid}
              data-testid={testIds.wysiwygEditor.commentDialog.insertButton}
            >
              {buttonText}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default CommentDialog;
