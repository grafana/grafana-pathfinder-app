/**
 * Interactive action type definitions
 * Centralized types for internal actions used in multi-step and guided components
 */

import type { ConditionInput } from './requirements.types';

export type GuidedStepOutcome = 'completed' | 'skipped' | 'timeout' | 'cancelled' | 'error';

export interface GuidedSubstepSettledDetail {
  stepId: string;
  index: number;
  total: number;
  action: GuidedAction['targetAction'];
  outcome: GuidedStepOutcome;
  durationMs: number;
  skippable: boolean;
}

export interface GuidedRunSettledDetail {
  stepId: string;
}

export const GUIDED_SUBSTEP_SETTLED_EVENT = 'pathfinder:guided-substep-settled';
export const GUIDED_RUN_SETTLED_EVENT = 'pathfinder:guided-run-settled';

export interface GuidedRequirementsCheckOptions {
  requirements: ConditionInput;
  targetAction?: string;
  refTarget?: string;
  targetValue?: string;
  maxRetries?: number;
  lazyRender?: boolean;
  scrollContainer?: string;
}

export interface GuidedRequirementsCheckResult {
  pass: boolean;
  error: Array<{
    fixType?: string;
  }>;
}

export type GuidedRequirementsChecker = (
  options: GuidedRequirementsCheckOptions
) => Promise<GuidedRequirementsCheckResult>;

export interface GuidedStepExecutionOptions {
  timeout?: number;
  checkRequirements?: GuidedRequirementsChecker;
  onActionCompleted?: () => void;
  onSettled?: (detail: Omit<GuidedSubstepSettledDetail, 'stepId'>) => void;
}
/**
 * Base internal action interface (flexible)
 * Used for multi-step sequences where action types may vary
 */
export interface InternalAction {
  targetAction: string;
  refTarget?: string;
  targetValue?: string;
  /** Desired end state for a toggle target; see `lib/dom/toggle-state`. */
  targetState?: boolean | string;
  requirements?: ConditionInput;
  targetComment?: string; // Optional comment to display during this step
}

/**
 * Guided action interface (strict)
 * Used for guided interactions where users manually perform actions
 * Extends InternalAction with stricter types and additional fields
 */
export interface GuidedAction extends InternalAction {
  targetAction: 'hover' | 'button' | 'highlight' | 'noop' | 'formfill';
  refTarget?: string; // Required for hover/button/highlight/formfill, optional for noop
  targetValue?: string; // Value for formfill actions (supports regex patterns)
  targetComment?: string; // Optional comment to display in tooltip during this step
  isSkippable?: boolean; // Whether this specific step can be skipped
  formHint?: string; // Hint shown when form validation fails (for formfill with regex)
  validateInput?: boolean; // Enable strict validation for formfill (require targetValue match)
  lazyRender?: boolean;
  scrollContainer?: string;
}

/**
 * Multi-step action interface (flexible)
 * Used for automated multi-step sequences
 * Same as base InternalAction but provides semantic clarity
 */
export type MultiStepAction = InternalAction;
