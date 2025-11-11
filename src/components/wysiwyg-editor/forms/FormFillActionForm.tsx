import React from 'react';
import { type InteractiveFormProps } from '../types';
import BaseInteractiveForm from './BaseInteractiveForm';
import { getActionConfig } from './actionConfig';
import { ACTION_TYPES } from '../../../constants/interactive-config';

const FormFillActionForm = (props: InteractiveFormProps) => {
  const config = getActionConfig(ACTION_TYPES.FORM_FILL);
  if (!config) {
    throw new Error(`Action config not found for ${ACTION_TYPES.FORM_FILL}`);
  }
  return <BaseInteractiveForm config={config} {...props} />;
};

export default FormFillActionForm;
