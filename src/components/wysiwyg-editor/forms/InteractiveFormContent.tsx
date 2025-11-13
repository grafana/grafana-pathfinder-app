import React from 'react';
import { Editor } from '@tiptap/react';
import ActionSelector from './ActionSelector';
import ButtonActionForm from './ButtonActionForm';
import HighlightActionForm from './HighlightActionForm';
import FormFillActionForm from './FormFillActionForm';
import NavigateActionForm from './NavigateActionForm';
import HoverActionForm from './HoverActionForm';
import MultistepActionForm from './MultistepActionForm';
import SequenceActionForm from './SequenceActionForm';
import { EditState, InteractiveAttributesOutput } from '../types';
import { ACTION_TYPES } from '../../../constants/interactive-config';
import { error as logError } from '../utils/logger';
import { insertNewInteractiveElement } from '../services/editorOperations';

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
 * Shared form content component used by both FormModal and FormPanel
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

  // Render appropriate form based on action type
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
      return <ActionSelector onSelect={onSelectActionType} onCancel={onCancel} />;
  }
};
