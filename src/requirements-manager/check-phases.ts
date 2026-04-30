/**
 * Check Phase Functions
 *
 * Extracted from checkStep to improve readability and testability.
 * These functions implement the three phases of step checking:
 * 1. Objectives Phase - Auto-complete if objectives are met
 * 2. Eligibility Phase - Block if sequential dependencies not met
 * 3. Requirements Phase - Validate requirements if eligible
 */

import { INTERACTIVE_CONFIG } from '../constants/interactive-config';
import { getRequirementExplanation } from './requirements-explanations';

/**
 * Base state shape shared by all phases
 */
interface BaseStepState {
  isEnabled: boolean;
  isCompleted: boolean;
  isChecking: boolean;
  isSkipped: boolean;
  completionReason: 'none' | 'objectives' | 'manual' | 'skipped';
  explanation: string | undefined;
  error: string | undefined;
  canFixRequirement: boolean;
  canSkip: boolean;
  fixType: string | undefined;
  targetHref: string | undefined;
  scrollContainer: string | undefined; // For lazy-scroll fixes
  retryCount: number;
  maxRetries: number;
  isRetrying: boolean;
  /**
   * Structural marker for "blocked because a previous step in the sequence is
   * not yet complete" (Phase 2). Only `createBlockedState` sets this to `true`;
   * everything else sets it to `false`. Consumed by the FSM adapter
   * (`actionFromBaseStepState`) to choose `SET_BLOCKED` over `SET_ERROR`,
   * replacing the previous magic-string check on `error`.
   */
  isSequentialBlock: boolean;
}

/**
 * Phase result: either a final state (phase completed flow) or null (continue to next phase)
 */
export type PhaseResult = BaseStepState | null;

/**
 * Create the default "checking" state at the start of checkStep
 */
export function createCheckingState(skippable: boolean): BaseStepState {
  return {
    isEnabled: false,
    isCompleted: false,
    isChecking: true,
    isSkipped: false,
    completionReason: 'none',
    explanation: undefined,
    error: undefined,
    canFixRequirement: false,
    canSkip: skippable,
    fixType: undefined,
    targetHref: undefined,
    scrollContainer: undefined,
    retryCount: 0,
    maxRetries: INTERACTIVE_CONFIG.delays.requirements.maxRetries,
    isRetrying: false,
    isSequentialBlock: false,
  };
}

/**
 * Phase 1: Check Objectives
 * If objectives are met, the step is auto-completed.
 *
 * @returns Final state if objectives met, null to continue to next phase
 */
export function createObjectivesCompletedState(skippable: boolean): BaseStepState {
  return {
    isEnabled: true,
    isCompleted: true,
    isChecking: false,
    isSkipped: false,
    completionReason: 'objectives',
    explanation: 'Already done!',
    error: undefined,
    canFixRequirement: false,
    canSkip: skippable,
    fixType: undefined,
    targetHref: undefined,
    scrollContainer: undefined,
    retryCount: 0,
    maxRetries: INTERACTIVE_CONFIG.delays.requirements.maxRetries,
    isRetrying: false,
    isSequentialBlock: false,
  };
}

/**
 * Phase 2: Check Eligibility
 * If step is not eligible (sequential dependency not met), block it.
 *
 * @param _stepId - The step's identifier (kept for future customization)
 * @returns Blocked state if not eligible, null to continue to next phase
 */
export function createBlockedState(_stepId: string): BaseStepState {
  // Note: stepId can be used to customize blocked state for sections vs standalone steps
  // Currently both get the same blocked state, but the parameter is kept for future use
  return {
    isEnabled: false,
    isCompleted: false,
    isChecking: false,
    isSkipped: false,
    completionReason: 'none',
    explanation: 'Complete previous step',
    error: 'Sequential dependency not met',
    canFixRequirement: false,
    canSkip: false, // Never allow skipping for sequential dependencies
    fixType: undefined,
    targetHref: undefined,
    scrollContainer: undefined,
    retryCount: 0,
    maxRetries: INTERACTIVE_CONFIG.delays.requirements.maxRetries,
    isRetrying: false,
    // The structural marker the FSM adapter uses to distinguish "blocked by an
    // unmet sequential dependency" from "blocked by a failed requirements
    // check"; the latter routes to SET_ERROR.
    isSequentialBlock: true,
  };
}

/**
 * Phase 3: Create requirements result state
 * Convert requirements check result to step state
 */
export function createRequirementsState(
  requirementsResult: {
    pass: boolean;
    error?: Array<{
      requirement?: string;
      pass?: boolean;
      error?: string;
      canFix?: boolean;
      fixType?: string;
      targetHref?: string;
      scrollContainer?: string;
    }>;
  },
  requirements: string,
  hints: string | undefined,
  skippable: boolean
): BaseStepState {
  // Filter to only failed requirements for clearer user messaging
  const failedChecks = requirementsResult.error?.filter((e) => e.pass === false) ?? [];
  const firstFailedRequirement = failedChecks[0]?.requirement;
  const failedErrors = failedChecks
    .map((e) => e.error)
    .filter(Boolean)
    .join(', ');

  const explanation = requirementsResult.pass
    ? undefined
    : getRequirementExplanation(
        firstFailedRequirement || requirements, // Use specific failing requirement for better message
        hints,
        failedErrors, // Only show errors from failed checks
        skippable
      );

  // Extract fix metadata from the first fixable failed check. The fix-handler
  // registry (`navigation` handler) owns the legacy `navmenu-open` fallback.
  const fixableError = failedChecks.find((e) => e.canFix);
  const fixType = fixableError?.fixType;
  const targetHref = fixableError?.targetHref;
  const scrollContainer = fixableError?.scrollContainer;
  const canFixRequirement = !!fixableError;

  return {
    isEnabled: requirementsResult.pass,
    isCompleted: false, // Requirements enable, don't auto-complete
    isChecking: false,
    isSkipped: false,
    completionReason: 'none',
    explanation,
    error: requirementsResult.pass ? undefined : failedErrors || undefined,
    canFixRequirement,
    canSkip: skippable,
    fixType,
    targetHref,
    scrollContainer,
    retryCount: 0, // Reset retry count after completion
    maxRetries: INTERACTIVE_CONFIG.delays.requirements.maxRetries,
    isRetrying: false,
    isSequentialBlock: false,
  };
}

/**
 * Phase 4: No conditions - create enabled state
 */
export function createEnabledState(skippable: boolean): BaseStepState {
  return {
    isEnabled: true,
    isCompleted: false,
    isChecking: false,
    isSkipped: false,
    completionReason: 'none',
    explanation: undefined,
    error: undefined,
    canFixRequirement: false,
    canSkip: skippable,
    fixType: undefined,
    targetHref: undefined,
    scrollContainer: undefined,
    retryCount: 0,
    maxRetries: INTERACTIVE_CONFIG.delays.requirements.maxRetries,
    isRetrying: false,
    isSequentialBlock: false,
  };
}

/**
 * Create error state when check fails.
 * `conditions` is the requirement-or-objective string to render the explanation against;
 * the caller is responsible for picking the relevant one.
 */
export function createErrorState(
  errorMessage: string,
  conditions: string | undefined,
  hints: string | undefined,
  skippable: boolean
): BaseStepState {
  return {
    isEnabled: false,
    isCompleted: false,
    isChecking: false,
    isSkipped: false,
    completionReason: 'none',
    explanation: getRequirementExplanation(conditions, hints, errorMessage, skippable),
    error: errorMessage,
    canFixRequirement: false,
    canSkip: skippable,
    fixType: undefined,
    targetHref: undefined,
    scrollContainer: undefined,
    retryCount: 0,
    maxRetries: INTERACTIVE_CONFIG.delays.requirements.maxRetries,
    isRetrying: false,
    isSequentialBlock: false,
  };
}
