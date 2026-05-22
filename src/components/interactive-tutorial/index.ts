// Interactive components
export {
  InteractiveSection,
  resetInteractiveCounters,
  registerSectionSteps,
  getDocumentStepPosition,
  getTotalDocumentSteps,
  DEFAULT_INTERACTIVE_SECTION_TITLE,
  PASSIVE_SECTION_TITLE,
} from './interactive-section';
export { InteractiveStep } from './interactive-step';
export { InteractiveMultiStep } from './interactive-multi-step';
export { InteractiveGuided } from './interactive-guided';
export { InteractiveQuiz } from './interactive-quiz';
export { InteractiveConditional } from './interactive-conditional';
export { InputBlock } from './input-block';
export { TerminalStep, resetTerminalStepCounter } from './terminal-step';
export { TerminalConnectStep, resetTerminalConnectStepCounter } from './terminal-connect-step';
export { CodeBlockStep, resetCodeBlockStepCounter } from './code-block-step';
export { ChallengeBlock, resetChallengeCounter } from './challenge-block';
export { GrotGuideBlock } from './grot-guide-block';

export { STEP_TYPE_PARSE_KEYS, STEP_TYPE_SCHEMAS } from './step-type-registry';
export type { ParseTypeKey, StepTypeKind } from './step-type-registry';

// Shared types from centralized location
export type {
  BaseInteractiveProps,
  InteractiveStepProps,
  InteractiveSectionProps,
  StepInfo,
} from '../../types/component-props.types';
