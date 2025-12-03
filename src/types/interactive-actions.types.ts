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
  requirements?: string;
  targetComment?: string; // Optional comment to display during this step
}

/**
 * Guided action interface (strict)
 * Used for guided interactions where users manually perform actions
 * Extends InternalAction with stricter types and additional fields
 */
export interface GuidedAction extends InternalAction {
  targetAction: 'hover' | 'button' | 'highlight' | 'noop';
  refTarget?: string; // Required for hover/button/highlight, optional for noop
  targetComment?: string; // Optional comment to display in tooltip during this step
  isSkippable?: boolean; // Whether this specific step can be skipped
}

/**
 * Multi-step action interface (flexible)
 * Used for automated multi-step sequences
 * Same as base InternalAction but provides semantic clarity
 */
export type MultiStepAction = InternalAction;
