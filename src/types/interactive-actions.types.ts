/**
 * Interactive action type definitions
 * Centralized types for internal actions used in multi-step and guided components
 */

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
  requirements?: string;
  targetComment?: string; // Optional comment to display during this step
}

export const GUIDED_ACTION_TYPES = ['hover', 'button', 'highlight', 'noop', 'formfill'] as const;
export type GuidedActionType = (typeof GUIDED_ACTION_TYPES)[number];

export function isGuidedActionType(value: unknown): value is GuidedActionType {
  return typeof value === 'string' && (GUIDED_ACTION_TYPES as readonly string[]).includes(value);
}

/**
 * Guided action interface (strict)
 * Used for guided interactions where users manually perform actions
 * Extends InternalAction with stricter types and additional fields
 */
export interface GuidedAction extends InternalAction {
  targetAction: GuidedActionType;
  refTarget?: string; // Required for hover/button/highlight/formfill, optional for noop
  targetValue?: string; // Value for formfill actions (supports regex patterns)
  targetComment?: string; // Optional comment to display in tooltip during this step
  isSkippable?: boolean; // Whether this specific step can be skipped
  formHint?: string; // Hint shown when form validation fails (for formfill with regex)
  validateInput?: boolean; // Enable strict validation for formfill (require targetValue match)
  lazyRender?: boolean;
  scrollContainer?: string;
}

export interface GuidedSubstepSettledDetail {
  stepId: string;
  index: number;
  action: GuidedAction['targetAction'];
  outcome: 'passed' | 'skipped';
}

/**
 * Multi-step action interface (flexible)
 * Used for automated multi-step sequences
 * Same as base InternalAction but provides semantic clarity
 */
export type MultiStepAction = InternalAction;
