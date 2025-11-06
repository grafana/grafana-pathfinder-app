/**
 * Requirement Manager Module
 * Centralized exports for requirements checking system
 */

// Core requirements checking hook
export {
  waitForReactUpdates,
  RequirementsState,
  RequirementsCheckResultLegacy,
  UseRequirementsCheckerProps,
  UseRequirementsCheckerReturn,
  useRequirementsChecker,
  SequentialRequirementsManager,
  useSequentialRequirements,
} from './requirements-checker.hook';

// Step checker hook (unified requirements + objectives)
export {
  UseStepCheckerProps,
  UseStepCheckerReturn,
  useStepChecker,
} from './step-checker.hook';

// Pure requirements checking utilities
export {
  RequirementsCheckResult,
  CheckResultError,
  RequirementsCheckOptions,
  checkRequirements,
  checkPostconditions,
} from './requirements-checker.utils';

// Requirement explanations and messages
export {
  mapRequirementToUserFriendlyMessage,
  getRequirementExplanation,
  getPostVerifyExplanation,
} from './requirement-explanations';

