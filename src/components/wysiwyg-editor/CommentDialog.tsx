import React, { useState } from 'react';
import { Modal, Button, TextArea, useStyles2, Stack } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { Editor } from '@tiptap/react';

interface CommentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  editor: Editor | null;
  onInsert: (commentText: string) => void;
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
}) => {
  const styles = useStyles2(getStyles);
  const [commentText, setCommentText] = useState('');

  // Reset comment text when dialog opens/closes
  React.useEffect(() => {
    if (isOpen) {
      setCommentText('');
    }
  }, [isOpen]);

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

  return (
    <Modal
      title="Add Comment"
      isOpen={isOpen}
      onDismiss={handleCancel}
      className={styles.modal}
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
          />
          <div className={styles.buttonGroup}>
            <Button variant="secondary" onClick={handleCancel}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleInsert} disabled={!isValid}>
              Insert
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default CommentDialog;

