/**
 * Interactive Engine Module
 * Centralized exports for the interactive guide system
 */

// Core interactive hook
export { useInteractiveElements } from './interactive.hook';
export type { InteractiveRequirementsCheck, CheckResult } from './interactive.hook';

// Theme utilities for interactive elements
export { updateInteractiveThemeColors } from '../styles/interactive.styles';

// Navigation manager
export { NavigationManager } from './navigation-manager';
export type { NavigationOptions } from './navigation-manager';

// State management
export { InteractiveStateManager } from './interactive-state-manager';
export type { InteractiveState, StateManagerOptions } from './interactive-state-manager';

export { SequenceManager } from './sequence-manager';

export { default as GlobalInteractionBlocker } from './global-interaction-blocker';

// Sequential step state hook
export { useSequentialStepState } from './use-sequential-step-state.hook';

// Action handlers (re-export only handlers used externally)
export { GuidedHandler, clearAndInsertCode } from './action-handlers';
export type { CodeBlockInsertResult } from './action-handlers';

// Auto-completion (re-export from auto-completion index)
export {
  detectActionType,
  getActionDescription,
  shouldCaptureElement,
  extractElementSelector,
  findInteractiveParent,
  canHaveFocus,
  canBeTabbed,
  matchesStepAction,
  matchesElementBounds,
  isNonFocusableInteractive,
  ActionMatcher,
  ActionMonitor,
  getActionMonitor,
  // Auto-detection hooks
  useAutoDetection,
  useSingleActionDetection,
  resolveTargetElement,
  // Regex pattern matching utilities
  isRegexPattern,
  parseRegexPattern,
  matchesRegexPattern,
  matchFormValue,
  // Form validation hooks
  useFormValidation,
  useFormElementValidation,
} from './auto-completion';
export type {
  DetectedAction,
  StepActionConfig,
  DetectedActionEvent,
  ActionToDetect,
  MatchResult,
  UseAutoDetectionOptions,
  FormfillMatchResult,
  FormValidationState,
  FormValidationResult,
  UseFormValidationOptions,
} from './auto-completion';
