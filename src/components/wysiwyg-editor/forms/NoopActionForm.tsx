import React from 'react';
import { type InteractiveFormProps } from '../types';
import BaseInteractiveForm from './BaseInteractiveForm';
import { getActionConfig } from './actionConfig';
import { ACTION_TYPES } from '../../../constants/interactive-config';

const NoopActionForm = (props: InteractiveFormProps) => {
  const config = getActionConfig(ACTION_TYPES.NOOP);
  if (!config) {
    throw new Error(`Action config not found for ${ACTION_TYPES.NOOP}`);
  }
  return <BaseInteractiveForm config={config} {...props} />;
};

export default NoopActionForm;
