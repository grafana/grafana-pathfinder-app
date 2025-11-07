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
export { matchesStepAction, matchesElementBounds, isNonFocusableInteractive, ActionMatcher } from './action-matcher';
export type { StepActionConfig, DetectedActionEvent } from './action-matcher';

// Action Monitor - Global singleton for monitoring user interactions
export { ActionMonitor, getActionMonitor } from './action-monitor';
