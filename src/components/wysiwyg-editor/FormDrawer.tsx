import React from 'react';
import { Modal } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { Editor } from '@tiptap/react';

// Form imports
import ActionSelector from './forms/ActionSelector';
import ButtonActionForm from './forms/ButtonActionForm';
import HighlightActionForm from './forms/HighlightActionForm';
import FormFillActionForm from './forms/FormFillActionForm';
import NavigateActionForm from './forms/NavigateActionForm';
import HoverActionForm from './forms/HoverActionForm';
import MultistepActionForm from './forms/MultistepActionForm';
import SequenceActionForm from './forms/SequenceActionForm';
import { EditState } from './types';
import { ACTION_TYPES } from '../../constants/interactive-config';

interface FormModalProps {
  isOpen: boolean;
  onClose: () => void;
  editor: Editor | null;
  editState: EditState | null;
  onFormSubmit: (attributes: Record<string, any>) => void;
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
 */
export const FormModal: React.FC<FormModalProps> = ({
  isOpen,
  onClose,
  editor,
  editState,
  onFormSubmit,
}) => {
  const styles = useStyles2(getStyles);

  // Determine which form to show based on edit state
  const renderForm = () => {
    if (!editor) {
      return null;
    }

    // If no edit state, show action selector for new interactive element
    if (!editState) {
      return (
        <ActionSelector
          onSelect={(actionType: string) => {
            // Close drawer - parent will handle opening with new edit state
            onClose();
          }}
          onCancel={onClose}
        />
      );
    }

    // Get action type from attributes
    const { attributes } = editState;
    const actionType = attributes['data-targetaction'] || '';

    const formProps = {
      editor,
      initialValues: attributes as any, // Convert Record<string, string> to form input format
      onApply: (attrs: Record<string, any>) => {
        onFormSubmit(attrs);
        onClose();
      },
      onCancel: onClose,
    };

    // Render appropriate form based on action type from attributes
    switch (actionType) {
      case ACTION_TYPES.BUTTON:
        return <ButtonActionForm {...formProps} />;
      case ACTION_TYPES.HIGHLIGHT:
        return <HighlightActionForm {...formProps} />;
      case ACTION_TYPES.FORM_FILL:
        return <FormFillActionForm {...formProps} />;
      case ACTION_TYPES.NAVIGATE:
        return <NavigateActionForm {...formProps} />;
      case ACTION_TYPES.HOVER:
        return <HoverActionForm {...formProps} />;
      case ACTION_TYPES.MULTISTEP:
        return <MultistepActionForm {...formProps} />;
      case ACTION_TYPES.SEQUENCE:
        return <SequenceActionForm {...formProps} />;
      default:
        // No action type set, show selector
        return <ActionSelector onSelect={onClose} onCancel={onClose} />;
    }
  };

  const getTitle = () => {
    if (!editState) {
      return 'Select Action Type';
    }

    const actionType = editState.attributes['data-targetaction'] || '';
    
    const typeLabels: Record<string, string> = {
      [ACTION_TYPES.BUTTON]: 'Button Action',
      [ACTION_TYPES.HIGHLIGHT]: 'Highlight Action',
      [ACTION_TYPES.FORM_FILL]: 'Form Fill Action',
      [ACTION_TYPES.NAVIGATE]: 'Navigate Action',
      [ACTION_TYPES.HOVER]: 'Hover Action',
      [ACTION_TYPES.MULTISTEP]: 'Multi-Step Action',
      [ACTION_TYPES.SEQUENCE]: 'Sequence Section',
    };

    return typeLabels[actionType] || 'Edit Interactive Element';
  };

  // Don't render modal at all when closed to prevent auto-opening
  if (!isOpen) {
    return null;
  }

  return (
    <Modal
      title={getTitle()}
      isOpen={isOpen}
      onDismiss={onClose}
      className={styles.modal}
    >
      <Modal.Content>
        <div className={styles.modalContent}>
          <p style={{ marginBottom: '16px', color: '#999' }}>Configure interactive tutorial element</p>
          {renderForm()}
        </div>
      </Modal.Content>
    </Modal>
  );
};

export default FormModal;

