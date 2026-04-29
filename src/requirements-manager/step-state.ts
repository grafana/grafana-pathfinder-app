/**
 * Step State Machine
 * Explicit state management for interactive tutorial steps
 *
 * This module replaces boolean flag combinations with a proper state machine,
 * making state transitions explicit and preventing impossible states.
 *
 * State Flow:
 * idle -> checking -> (blocked | enabled)
 * enabled -> checking -> (blocked | enabled | completed)
 * blocked -> checking -> (blocked | enabled)
 * completed is a terminal state (can only be reset to idle)
 */

import { INTERACTIVE_CONFIG } from '../constants/interactive-config';

/**
 * Step status enum representing all possible step states
 */
export type StepStatus = 'idle' | 'checking' | 'blocked' | 'enabled' | 'completed';

/**
 * Reason why a step was completed
 */
export type CompletionReason = 'none' | 'objectives' | 'manual' | 'skipped';

/**
 * Unified step state
 */
export interface StepState {
  status: StepStatus;
  completionReason: CompletionReason;
  error?: string;
  explanation?: string;
  canFix: boolean;
  fixType?: string;
  targetHref?: string;
  /** CSS selector for the scroll container when the failure can be fixed via lazy scroll. */
  scrollContainer?: string;
  retryCount: number;
  maxRetries: number;
  canSkip: boolean;
}

/**
 * Actions that can modify step state
 */
export type StepAction =
  | { type: 'START_CHECK' }
  | { type: 'SET_BLOCKED'; error: string; explanation?: string }
  | {
      type: 'SET_ENABLED';
      canFix?: boolean;
      fixType?: string;
      targetHref?: string;
      scrollContainer?: string;
    }
  | { type: 'SET_COMPLETED'; reason: CompletionReason; explanation?: string }
  | {
      type: 'SET_ERROR';
      error: string;
      explanation?: string;
      canFix?: boolean;
      fixType?: string;
      targetHref?: string;
      scrollContainer?: string;
    }
  | { type: 'UPDATE_RETRY'; retryCount: number; isRetrying: boolean }
  | { type: 'RESET'; canSkip?: boolean };

/**
 * Create initial state for a step
 */
export function createInitialState(options?: { canSkip?: boolean }): StepState {
  return {
    status: 'idle',
    completionReason: 'none',
    error: undefined,
    explanation: undefined,
    canFix: false,
    fixType: undefined,
    targetHref: undefined,
    scrollContainer: undefined,
    retryCount: 0,
    maxRetries: INTERACTIVE_CONFIG.delays.requirements.maxRetries,
    canSkip: options?.canSkip ?? false,
  };
}

/**
 * Step state reducer
 * Implements the state machine transitions
 */
export function stepReducer(state: StepState, action: StepAction): StepState {
  switch (action.type) {
    case 'START_CHECK':
      // Can start checking from any non-completed state
      if (state.status === 'completed') {
        return state; // No-op for completed steps
      }
      return {
        ...state,
        status: 'checking',
        error: undefined,
        retryCount: 0,
      };

    case 'SET_BLOCKED':
      return {
        ...state,
        status: 'blocked',
        error: action.error,
        explanation: action.explanation,
        canFix: false,
        fixType: undefined,
        targetHref: undefined,
        scrollContainer: undefined,
      };

    case 'SET_ENABLED':
      return {
        ...state,
        status: 'enabled',
        error: undefined,
        explanation: undefined,
        canFix: action.canFix ?? false,
        fixType: action.fixType,
        targetHref: action.targetHref,
        scrollContainer: action.scrollContainer,
      };

    case 'SET_COMPLETED':
      // Clear *all* fix metadata (canFix / fixType / targetHref / scrollContainer).
      // A completed step has nothing to fix, and stale values would leak into
      // consumers like the `data-test-fix-type` attribute. This matches the
      // shape of `createObjectivesCompletedState`, which the old setState path
      // overwrote wholesale.
      return {
        ...state,
        status: 'completed',
        completionReason: action.reason,
        explanation: action.explanation ?? 'Completed',
        error: undefined,
        canFix: false,
        fixType: undefined,
        targetHref: undefined,
        scrollContainer: undefined,
      };

    case 'SET_ERROR':
      return {
        ...state,
        status: 'blocked',
        error: action.error,
        explanation: action.explanation,
        canFix: action.canFix ?? false,
        fixType: action.fixType,
        targetHref: action.targetHref,
        scrollContainer: action.scrollContainer,
      };

    case 'UPDATE_RETRY':
      return {
        ...state,
        retryCount: action.retryCount,
      };

    case 'RESET':
      return createInitialState({ canSkip: action.canSkip ?? state.canSkip });

    default: {
      // Exhaustiveness check: if a new variant is added to `StepAction` and
      // not handled above, this assignment fails to compile, surfacing the
      // missing case at the type-check stage instead of silently returning
      // the previous state at runtime.
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}

/**
 * Helper functions to derive boolean flags from state
 * These maintain backward compatibility with the existing API
 *
 * Legacy quirk: a step is "enabled" in the user-facing sense (Redo is
 * available) when its FSM status is `enabled` *or* it's been completed
 * because objectives were already met. Consumers like
 * `interactive-step.tsx`, `interactive-multi-step.tsx`, and
 * `interactive-guided.tsx` depend on this. `toLegacyState` delegates here
 * so the two can never drift.
 */
export function deriveIsEnabled(state: StepState): boolean {
  return state.status === 'enabled' || (state.status === 'completed' && state.completionReason === 'objectives');
}

export function deriveIsCompleted(state: StepState): boolean {
  return state.status === 'completed';
}

export function deriveIsChecking(state: StepState): boolean {
  return state.status === 'checking';
}

export function deriveIsSkipped(state: StepState): boolean {
  return state.status === 'completed' && state.completionReason === 'skipped';
}

export function deriveIsRetrying(state: StepState): boolean {
  return state.status === 'checking' && state.retryCount > 0;
}

/**
 * Convert new StepState to legacy state object format.
 * Used for backward compatibility during migration so consumers of useStepChecker
 * keep seeing the same shape they always have.
 *
 * The legacy "objectives-completed → isEnabled: true" quirk lives in
 * `deriveIsEnabled`; this function just delegates so the two API surfaces
 * (the barrel-exported helper and the legacy shape) cannot disagree.
 */
export function toLegacyState(state: StepState) {
  return {
    isEnabled: deriveIsEnabled(state),
    isCompleted: deriveIsCompleted(state),
    isChecking: deriveIsChecking(state),
    isSkipped: deriveIsSkipped(state),
    completionReason: state.completionReason,
    explanation: state.explanation,
    error: state.error,
    canFixRequirement: state.canFix,
    canSkip: state.canSkip,
    fixType: state.fixType,
    targetHref: state.targetHref,
    scrollContainer: state.scrollContainer,
    retryCount: state.retryCount,
    maxRetries: state.maxRetries,
    isRetrying: deriveIsRetrying(state),
  };
}
