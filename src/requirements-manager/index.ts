/**
 * Requirement Manager Module
 * Centralized exports for requirements checking system
 */

// Re-export from canonical location for backward compatibility
export { waitForReactUpdates } from '../lib/async-utils';

// Core requirements checking manager
export { SequentialRequirementsManager } from './requirements-checker.hook';

export type { RequirementsState } from './requirements-checker.hook';

// React Context for requirements manager (replaces singleton pattern)
export {
  RequirementsContext,
  RequirementsProvider,
  useRequirementsManager,
  useIsInsideRequirementsProvider,
} from './requirements-context';

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

// Step state machine (optional: for components that want explicit state management)
export {
  stepReducer,
  createInitialState,
  deriveIsEnabled,
  deriveIsCompleted,
  deriveIsChecking,
  deriveIsSkipped,
  deriveIsRetrying,
  toLegacyState,
} from './step-state';

export type { StepStatus, CompletionReason, StepState, StepAction } from './step-state';
