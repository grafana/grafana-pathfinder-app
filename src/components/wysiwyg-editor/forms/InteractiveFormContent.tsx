import React from 'react';
import { Editor } from '@tiptap/react';
import ActionSelector from './ActionSelector';
import SequenceActionForm from './SequenceActionForm';
import { EditState, InteractiveAttributesOutput } from '../types';
import { error as logError } from '../utils/logger';
import { insertNewInteractiveElement } from '../services/editorOperations';
import { getActionDefinition } from './actionRegistry';

interface InteractiveFormContentProps {
  editor: Editor | null;
  editState: EditState | null;
  selectedActionType: string | null;
  onSelectActionType: (actionType: string) => void;
  onFormSubmit: (attributes: InteractiveAttributesOutput) => void;
  onCancel: () => void;
  onSwitchType?: () => void;
}

/**
 * Shared form content component used by FormPanel
 * Contains all the form rendering logic and state management
 */
export const InteractiveFormContent: React.FC<InteractiveFormContentProps> = ({
  editor,
  editState,
  selectedActionType,
  onSelectActionType,
  onFormSubmit,
  onCancel,
  onSwitchType,
}) => {
  if (!editor) {
    return null;
  }

  // Determine which action type to use
  let actionType: string;

  if (editState) {
    // Edit mode: use action type from editState
    actionType = editState.attributes['data-targetaction'] || '';
  } else if (selectedActionType) {
    // Creation mode after action selection
    actionType = selectedActionType;
  } else {
    // Creation mode: show action selector
    return <ActionSelector onSelect={onSelectActionType} onCancel={onCancel} />;
  }

  // Build form props for both edit and create modes
  const formProps = {
    editor,
    initialValues: editState ? editState.attributes : undefined,
    onApply: (attrs: InteractiveAttributesOutput) => {
      try {
        if (editState) {
          // Edit mode: update existing element
          onFormSubmit(attrs);
        } else {
          // Creation mode: insert new element
          insertNewInteractiveElement(editor, attrs);
        }
        onCancel();
      } catch (err) {
        logError('[InteractiveFormContent] Failed to apply changes:', err);
        // Keep form open on error so user can retry
      }
    },
    onCancel,
    onSwitchType,
  };

  // Get action definition from unified registry
  const actionDef = getActionDefinition(actionType);

  if (!actionDef) {
    // Unknown action type, show selector
    return <ActionSelector onSelect={onSelectActionType} onCancel={onCancel} />;
  }

  // Special handling for SequenceActionForm (needs unique ID generation)
  if (actionType === 'sequence') {
    return <SequenceActionForm {...formProps} />;
  }

  // Use form component from registry
  const FormComponent = actionDef.formComponent;
  return <FormComponent {...formProps} />;
};
