import type { JsonStep } from '../../../types/json-guide.types';

export const stepMultistepToGuided = (step: JsonStep): JsonStep => ({
  ...step,
  description: step.tooltip || step.description,
  tooltip: undefined,
});

export const stepGuidedToMultistep = (step: JsonStep): JsonStep => ({
  ...step,
  tooltip: step.description || step.tooltip,
  description: undefined,
});
