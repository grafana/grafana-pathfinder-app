/**
 * Interactive action type definitions
 * Centralized types for internal actions used in multi-step and guided components
 */

import type { CheckResultError, ConditionInput } from './requirements.types';
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

export const MAX_GUIDED_STEP_TIMEOUT_MS = 600_000;

export interface GuidedAction extends InternalAction {
  targetAction: 'hover' | 'button' | 'highlight' | 'noop' | 'formfill';
  isSkippable?: boolean;
  formHint?: string;
  validateInput?: boolean;
  lazyRender?: boolean;
  scrollContainer?: string;
}

export type GuidedSubstepStatus = 'completed' | 'timeout' | 'cancelled' | 'skipped' | 'error';

export interface GuidedSubstepResult {
  index: number;
  action: GuidedAction['targetAction'];
  status: GuidedSubstepStatus;
  durationMs: number;
}

export type GuidedRequirementsCheck = (action: GuidedAction) => Promise<{ pass: boolean; error: CheckResultError[] }>;

export interface GuidedStepOptions {
  checkRequirements?: GuidedRequirementsCheck;
  onSettled?: (result: GuidedSubstepResult) => void;
}

/**
 * Multi-step action interface (flexible)
 * Used for automated multi-step sequences
 * Same as base InternalAction but provides semantic clarity
 */
export type MultiStepAction = InternalAction;
