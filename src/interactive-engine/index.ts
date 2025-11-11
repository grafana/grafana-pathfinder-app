/**
 * Interactive Engine Module
 * Centralized exports for the interactive tutorial system
 */

// Core interactive hook
export { useInteractiveElements } from './interactive.hook';
export type { InteractiveRequirementsCheck, CheckResult } from './interactive.hook';

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

// Action handlers (re-export from action-handlers index)
export {
  FocusHandler,
  ButtonHandler,
  NavigateHandler,
  FormFillHandler,
  HoverHandler,
  GuidedHandler,
} from './action-handlers';

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
} from './auto-completion';
export type { DetectedAction, StepActionConfig, DetectedActionEvent } from './auto-completion';
