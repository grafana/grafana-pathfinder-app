/**
 * Requirement Manager Module
 * Centralized exports for requirements checking system
 */

// Core requirements checking manager
export { waitForReactUpdates, SequentialRequirementsManager } from './requirements-checker.hook';

export type { RequirementsState } from './requirements-checker.hook';

// Step checker hook (unified requirements + objectives)
export { useStepChecker } from './step-checker.hook';

export type { UseStepCheckerProps, UseStepCheckerReturn } from '../types/hooks.types';

// Pure requirements checking utilities
export { checkRequirements, checkPostconditions, validateInteractiveRequirements } from './requirements-checker.utils';

export type { RequirementsCheckResult, CheckResultError, RequirementsCheckOptions } from './requirements-checker.utils';

// Requirement explanations and messages
export {
  mapRequirementToUserFriendlyMessage,
  getRequirementExplanation,
  getPostVerifyExplanation,
} from './requirements-explanations';
