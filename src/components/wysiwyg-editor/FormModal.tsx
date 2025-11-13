import React from 'react';
import { Modal, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { Editor } from '@tiptap/react';

import { EditState, InteractiveAttributesOutput } from './types';
import { InteractiveFormContent } from './forms/InteractiveFormContent';

interface FormModalProps {
  isOpen: boolean;
  onClose: () => void;
  editor: Editor | null;
  editState: EditState | null;
  onFormSubmit: (attributes: InteractiveAttributesOutput) => void;
}

const getStyles = (theme: GrafanaTheme2) => ({
  modalContent: css({
    padding: theme.spacing(2),
  }),
  modal: css({
    width: '600px',
    maxWidth: '90vw',
  }),
});

/**
 * FormModal Component
 *
 * Renders a Grafana UI Modal containing the appropriate form based on the current edit state.
 * Uses a centered modal that doesn't interfere with sidebars.
 * Implements two-step flow: select action type, then configure and insert.
 */
export const FormModal: React.FC<FormModalProps> = ({ isOpen, onClose, editor, editState, onFormSubmit }) => {
  const styles = useStyles2(getStyles);

  // Track selected action type during creation (when editState is null)
  const [selectedActionType, setSelectedActionType] = React.useState<string | null>(null);

  // Reset selectedActionType when modal closes
  React.useEffect(() => {
    if (!isOpen) {
      setSelectedActionType(null);
    }
  }, [isOpen]);


  const getTitle = () => {
    // Determine action type from either editState or selectedActionType
    const actionType = editState ? editState.attributes['data-targetaction'] : selectedActionType;

    if (!actionType) {
      return 'Select Action Type';
    }

    const prefix = editState ? 'Edit' : 'Create';
    return `${prefix} ${actionType}`;
  };

  // Don't render modal at all when closed to prevent auto-opening
  if (!isOpen) {
    return null;
  }

  return (
    <Modal title={getTitle()} isOpen={isOpen} onDismiss={onClose} className={styles.modal}>
      <div className={styles.modalContent}>
        <InteractiveFormContent
          editor={editor}
          editState={editState}
          selectedActionType={selectedActionType}
          onSelectActionType={setSelectedActionType}
          onFormSubmit={onFormSubmit}
          onCancel={onClose}
        />
      </div>
    </Modal>
  );
};

export default FormModal;
