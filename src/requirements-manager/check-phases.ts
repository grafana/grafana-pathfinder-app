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

  // Check for fixable errors and extract fix information
  const fixableError = failedChecks.find((e) => e.canFix);
  const fixType = fixableError?.fixType || (requirements.includes('navmenu-open') ? 'navigation' : undefined);
  const targetHref = fixableError?.targetHref;
  const scrollContainer = fixableError?.scrollContainer;
  const canFixRequirement = !!fixableError || requirements.includes('navmenu-open');

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
  };
}

/**
 * Create error state when check fails
 */
export function createErrorState(
  errorMessage: string,
  requirements: string | undefined,
  objectives: string | undefined,
  hints: string | undefined,
  skippable: boolean
): BaseStepState {
  return {
    isEnabled: false,
    isCompleted: false,
    isChecking: false,
    isSkipped: false,
    completionReason: 'none',
    explanation: getRequirementExplanation(requirements || objectives, hints, errorMessage, skippable),
    error: errorMessage,
    canFixRequirement: false,
    canSkip: skippable,
    fixType: undefined,
    targetHref: undefined,
    scrollContainer: undefined,
    retryCount: 0,
    maxRetries: INTERACTIVE_CONFIG.delays.requirements.maxRetries,
    isRetrying: false,
  };
}
