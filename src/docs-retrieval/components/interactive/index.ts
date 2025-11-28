// Interactive components
export { InteractiveSection, resetInteractiveCounters } from './interactive-section';
export { InteractiveStep } from './interactive-step';
export { InteractiveMultiStep } from './interactive-multi-step';
export { InteractiveGuided } from './interactive-guided';
export { InteractiveQuiz } from './interactive-quiz';

// Shared types from centralized location
export type {
  BaseInteractiveProps,
  InteractiveStepProps,
  InteractiveSectionProps,
  StepInfo,
} from '../../../types/component-props.types';
