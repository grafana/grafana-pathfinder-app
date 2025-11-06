/**
 * Requirement Manager Module
 * Centralized exports for requirements checking system
 */

// Core requirements checking hook
export {
  waitForReactUpdates,
  useRequirementsChecker,
  SequentialRequirementsManager,
  useSequentialRequirements,
} from './requirements-checker.hook';

export type {
  RequirementsState,
  RequirementsCheckResultLegacy,
  UseRequirementsCheckerProps,
  UseRequirementsCheckerReturn,
} from './requirements-checker.hook';

// Step checker hook (unified requirements + objectives)
export { useStepChecker } from './step-checker.hook';

export type {
  UseStepCheckerProps,
  UseStepCheckerReturn,
} from './step-checker.hook';

// Pure requirements checking utilities
export { checkRequirements, checkPostconditions } from './requirements-checker.utils';

export type {
  RequirementsCheckResult,
  CheckResultError,
  RequirementsCheckOptions,
} from './requirements-checker.utils';

// Requirement explanations and messages
export {
  mapRequirementToUserFriendlyMessage,
  getRequirementExplanation,
  getPostVerifyExplanation,
} from './requirements-explanations';

