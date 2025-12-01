import React from 'react';
import { type InteractiveFormProps } from '../types';
import MultistepActionForm from './MultistepActionForm';
import { ACTION_TYPES } from '../../../constants/interactive-config';

/**
 * Guided action form - uses the same step recording flow as MultistepActionForm
 * Both action types (multistep and guided) share the same recording behavior,
 * only differing in how they're executed at runtime.
 */
const GuidedActionForm = (props: InteractiveFormProps) => {
  return <MultistepActionForm {...props} actionType={ACTION_TYPES.GUIDED} />;
};

export default GuidedActionForm;
