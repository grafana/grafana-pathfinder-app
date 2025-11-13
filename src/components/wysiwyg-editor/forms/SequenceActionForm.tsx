import React, { useMemo } from 'react';
import { type InteractiveFormProps } from '../types';
import BaseInteractiveForm from './BaseInteractiveForm';
import { getActionConfig } from './actionConfig';
import { ACTION_TYPES } from '../../../constants/interactive-config';
import { generateUniqueSequenceId } from '../services/editorOperations';

const SequenceActionForm = (props: InteractiveFormProps) => {
  const config = getActionConfig(ACTION_TYPES.SEQUENCE);
  if (!config) {
    throw new Error(`Action config not found for ${ACTION_TYPES.SEQUENCE}`);
  }

  // Generate a unique default ID if we're creating a new sequence (no initialValues.id)
  const defaultInitialValues = useMemo(() => {
    if (!props.initialValues?.id && props.editor) {
      const uniqueId = generateUniqueSequenceId(props.editor);
      return {
        ...props.initialValues,
        id: uniqueId,
      };
    }
    return props.initialValues;
  }, [props.initialValues, props.editor]);

  return <BaseInteractiveForm config={config} {...props} initialValues={defaultInitialValues} />;
};

export default SequenceActionForm;
