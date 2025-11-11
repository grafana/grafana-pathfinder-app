import React from 'react';
import { type InteractiveFormProps } from '../types';
import BaseInteractiveForm from './BaseInteractiveForm';
import { getActionConfig } from './actionConfig';
import { ACTION_TYPES } from '../../../constants/interactive-config';

const HighlightActionForm = (props: InteractiveFormProps) => {
  const config = getActionConfig(ACTION_TYPES.HIGHLIGHT);
  if (!config) {
    throw new Error(`Action config not found for ${ACTION_TYPES.HIGHLIGHT}`);
  }
  return <BaseInteractiveForm config={config} {...props} />;
};

export default HighlightActionForm;
