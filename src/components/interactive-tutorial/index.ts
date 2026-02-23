// Interactive components
export {
  InteractiveSection,
  resetInteractiveCounters,
  registerSectionSteps,
  getDocumentStepPosition,
  getTotalDocumentSteps,
} from './interactive-section';
export { InteractiveStep } from './interactive-step';
export { InteractiveMultiStep } from './interactive-multi-step';
export { InteractiveGuided } from './interactive-guided';
export { InteractiveQuiz } from './interactive-quiz';
export { InteractiveConditional } from './interactive-conditional';
export { InputBlock } from './input-block';

// Shared types from centralized location
export type {
  BaseInteractiveProps,
  InteractiveStepProps,
  InteractiveSectionProps,
  StepInfo,
} from '../../types/component-props.types';
