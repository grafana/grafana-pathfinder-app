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
} from './action-detector';
export type { DetectedAction } from './action-detector';

// Action Matcher - Matches detected actions against step configurations
export {
  matchesStepAction,
  matchesElementBounds,
  isNonFocusableInteractive,
  ActionMatcher,
  // Regex pattern matching utilities
  isRegexPattern,
  parseRegexPattern,
  matchesRegexPattern,
  matchFormValue,
} from './action-matcher';
export type { StepActionConfig, DetectedActionEvent, FormfillMatchResult } from './action-matcher';

// Action Monitor - Global singleton for monitoring user interactions
export { ActionMonitor, getActionMonitor } from './action-monitor';

// Auto-detection Hook - Shared hook for interactive elements
export { useAutoDetection, useSingleActionDetection, resolveTargetElement } from './useAutoDetection';
export type { ActionToDetect, MatchResult, UseAutoDetectionOptions } from './useAutoDetection';

// Form Validation Hook - Debounced form validation with regex support
export { useFormValidation, useFormElementValidation } from './useFormValidation';
export type { FormValidationState, FormValidationResult, UseFormValidationOptions } from './useFormValidation';
