/**
 * Auto-completion Module
 * Exports for automatic step completion detection system
 */

// Action Detector - Identifies action types from DOM elements
export {
  detectActionType,
  getActionDescription,
  shouldCaptureElement,
  extractElementSelector,
  findInteractiveParent,
  canHaveFocus,
  canBeTabbed,
} from '../../lib/dom/action-detector';
export type { DetectedAction } from '../../lib/dom/action-detector';

// Form value matching
export { isRegexPattern, parseRegexPattern, matchesRegexPattern, matchFormValue } from './action-matcher';
export type { FormfillMatchResult } from './action-matcher';

export { resolveTargetElement } from './resolve-target-element';

// Form Validation Hook - Debounced form validation with regex support
export { useFormValidation, useFormElementValidation } from './useFormValidation';
export type { FormValidationState, FormValidationResult, UseFormValidationOptions } from './useFormValidation';
