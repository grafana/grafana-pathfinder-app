/**
 * Interactive action type definitions
 * Centralized types for internal actions used in multi-step and guided components
 */

import type { ConditionInput } from './requirements.types';
import type { InteractiveActionType } from './interactive.types';

/**
 * Guided verbs that drive a DOM element. `GuidedHandler.attachCompletionListener`
 * is total over exactly these.
 */
export const GUIDED_DOM_ACTION_TYPES = ['hover', 'button', 'highlight', 'formfill'] as const;

/**
 * Every verb a guided block may author. `satisfies` proves it stays a subset of
 * the canonical vocabulary, so a verb cannot be guided-only.
 */
export const GUIDED_ACTION_TYPES = [
  ...GUIDED_DOM_ACTION_TYPES,
  'noop',
] as const satisfies readonly InteractiveActionType[];

export type GuidedDomActionType = (typeof GUIDED_DOM_ACTION_TYPES)[number];
export type GuidedActionType = (typeof GUIDED_ACTION_TYPES)[number];

export const isGuidedActionType = (action: InteractiveActionType): action is GuidedActionType =>
  (GUIDED_ACTION_TYPES as readonly InteractiveActionType[]).includes(action);

export const isGuidedDomActionType = (action: InteractiveActionType): action is GuidedDomActionType =>
  (GUIDED_DOM_ACTION_TYPES as readonly InteractiveActionType[]).includes(action);
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
  openGuide?: string; // Guide to open in sidebar after navigation
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
}

/**
 * A guided step as authored, before the verb is checked. `convertGuidedBlock`
 * builds these from `JsonStepSchema`, which admits every authorable verb — not
 * just the ones `GuidedHandler` can drive. Narrow with `isGuidedDomActionType`
 * at the point of use; the authoring gate in `validate-guide.ts` rejects the
 * rest before a guide ships, so this only widens for already-published content.
 */
export type AuthoredGuidedAction = Omit<GuidedAction, 'targetAction'> & {
  targetAction: InteractiveActionType;
};

/**
 * Multi-step action interface (flexible)
 * Used for automated multi-step sequences
 * Same as base InternalAction but provides semantic clarity
 */
export type MultiStepAction = InternalAction;
