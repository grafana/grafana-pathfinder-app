import React, { useState, useCallback } from 'react';
import { Modal, Button, Input, Field, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { slugify } from './services/editorToJson';
import { testIds } from '../testIds';

export interface ExportMetadata {
  id: string;
  title: string;
}

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (metadata: ExportMetadata) => void;
  mode: 'copy' | 'download';
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
    marginTop: theme.spacing(1),
  }),
  hint: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    marginTop: theme.spacing(0.5),
  }),
});

/**
 * Inner dialog content - state resets naturally when component unmounts/remounts
 */
interface ExportDialogContentProps {
  onClose: () => void;
  onExport: (metadata: ExportMetadata) => void;
  mode: 'copy' | 'download';
  styles: ReturnType<typeof getStyles>;
}

const ExportDialogContent: React.FC<ExportDialogContentProps> = ({ onClose, onExport, mode, styles }) => {
  const [title, setTitle] = useState('');
  const [id, setId] = useState('');
  const [idManuallyEdited, setIdManuallyEdited] = useState(false);

  // Compute the effective ID: use manual ID if edited, otherwise derive from title
  const effectiveId = idManuallyEdited ? id : title ? slugify(title) : '';

  const handleTitleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value);
  }, []);

  const handleIdChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setIdManuallyEdited(true);
    setId(e.target.value);
  }, []);

  const handleExport = useCallback(() => {
    const trimmedTitle = title.trim();
    const trimmedId = effectiveId.trim() || slugify(trimmedTitle);

    if (!trimmedTitle || !trimmedId) {
      return;
    }

    onExport({ id: trimmedId, title: trimmedTitle });
    onClose();
  }, [title, effectiveId, onExport, onClose]);

  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  const isValid = title.trim().length > 0;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // Allow Enter to submit if valid
      if (e.key === 'Enter') {
        e.preventDefault();
        if (isValid) {
          handleExport();
        }
      }
      // Escape to cancel
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    },
    [isValid, handleExport, handleCancel]
  );

  const buttonText = mode === 'copy' ? 'Copy' : 'Download';

  return (
    <div className={styles.modalContent}>
      <div className={styles.form}>
        <Field label="Guide Title" required>
          <Input
            value={title}
            onChange={handleTitleChange}
            onKeyDown={handleKeyDown}
            placeholder="e.g., Create your first dashboard"
            autoFocus
            data-testid={testIds.wysiwygEditor.exportDialog.titleInput}
          />
        </Field>

        <Field label="Guide ID" description="Unique identifier for the guide. Auto-generated from title if left empty.">
          <Input
            value={effectiveId}
            onChange={handleIdChange}
            onKeyDown={handleKeyDown}
            placeholder="e.g., first-dashboard"
            data-testid={testIds.wysiwygEditor.exportDialog.idInput}
          />
        </Field>

        <div className={styles.buttonGroup}>
          <Button
            variant="secondary"
            onClick={handleCancel}
            data-testid={testIds.wysiwygEditor.exportDialog.cancelButton}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleExport}
            disabled={!isValid}
            icon={mode === 'copy' ? 'copy' : 'download-alt'}
            data-testid={testIds.wysiwygEditor.exportDialog.exportButton}
          >
            {buttonText}
          </Button>
        </div>
      </div>
    </div>
  );
};

/**
 * ExportDialog Component
 *
 * A dialog for entering guide metadata (id and title) before exporting
 * the WYSIWYG editor content as JSON.
 *
 * Uses an inner component pattern so state naturally resets when the dialog
 * closes and reopens (component unmounts/remounts).
 */
export const ExportDialog: React.FC<ExportDialogProps> = ({ isOpen, onClose, onExport, mode }) => {
  const styles = useStyles2(getStyles);

  if (!isOpen) {
    return null;
  }

  const modalTitle = mode === 'copy' ? 'Copy as JSON' : 'Download as JSON';

  return (
    <Modal
      title={modalTitle}
      isOpen={isOpen}
      onDismiss={onClose}
      className={styles.modal}
      data-testid={testIds.wysiwygEditor.exportDialog.modal}
    >
      <ExportDialogContent onClose={onClose} onExport={onExport} mode={mode} styles={styles} />
    </Modal>
  );
};

export default ExportDialog;
