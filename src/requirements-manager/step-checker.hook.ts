/**
 * Unified hook for checking both tutorial-specific requirements and objectives
 * Combines and replaces useStepRequirements and useStepObjectives
 *
 * Priority Logic (per interactiveRequirements.mdc):
 * 1. Check objectives first (they always win)
 * 2. If not eligible (sequential dependency), block regardless of requirements/objectives
 * 3. Check requirements only if objectives not met
 * 4. Smart performance: skip requirements if objectives are satisfied
 */

import { useReducer, useCallback, useEffect, useMemo, useRef } from 'react';
// getRequirementExplanation is used in check-phases.ts
import {
  createObjectivesCompletedState,
  createBlockedState,
  createRequirementsState,
  createEnabledState,
  createErrorState,
} from './check-phases';
import { SequentialRequirementsManager } from './requirements-checker.hook';
import { useRequirementsManager } from './requirements-context';
import { dispatchFix } from './fix-registry';
import { stepReducer, createInitialState, toLegacyState, type StepAction } from './step-state';
// eslint-disable-next-line no-restricted-imports -- [ratchet] ALLOWED_LATERAL_VIOLATIONS: requirements-manager -> interactive-engine
import { useInteractiveElements, useSequentialStepState } from '../interactive-engine';
import { INTERACTIVE_CONFIG, isFirstStep } from '../constants/interactive-config';
import { useTimeoutManager } from '../utils/timeout-manager';
import { useIsAlignmentPaused } from '../global-state/alignment-pending-context';
import { checkRequirements } from './requirements-checker.utils';
import type { UseStepCheckerProps, UseStepCheckerReturn } from '../types/hooks.types';

// Re-export for convenience
export type { UseStepCheckerProps, UseStepCheckerReturn };

// The legacy state shape returned by check-phases.ts factory functions.
// Used here as the input to `actionFromBaseStepState` (the FSM adapter).
type LegacyStateShape = ReturnType<typeof createObjectivesCompletedState>;

/**
 * Translate a legacy `BaseStepState` (from a check-phases factory) into the
 * matching `StepAction`. This is a transitional adapter: phase factories still
 * compute the user-facing state, the reducer owns transitions. A follow-up
 * refactor will collapse the two by having phase functions return actions
 * directly.
 */
function actionFromBaseStepState(s: LegacyStateShape): StepAction {
  if (s.isCompleted) {
    return { type: 'SET_COMPLETED', reason: s.completionReason, explanation: s.explanation };
  }
  // Structural marker set only by `createBlockedState` (see check-phases.ts).
  // Replaces a fragile `error === 'Sequential dependency not met'` check that
  // would silently misclassify the state as SET_ERROR if the message changed.
  if (s.isSequentialBlock) {
    return { type: 'SET_BLOCKED', error: s.error ?? 'Sequential dependency not met', explanation: s.explanation };
  }
  if (s.isEnabled) {
    return {
      type: 'SET_ENABLED',
      canFix: s.canFixRequirement,
      fixType: s.fixType,
      targetHref: s.targetHref,
      scrollContainer: s.scrollContainer,
    };
  }
  // Failed requirements or check-time errors land here (status -> 'blocked' with metadata).
  return {
    type: 'SET_ERROR',
    error: s.error ?? 'Unknown error',
    explanation: s.explanation,
    canFix: s.canFixRequirement,
    fixType: s.fixType,
    targetHref: s.targetHref,
    scrollContainer: s.scrollContainer,
  };
}

/**
 * Unified step checker that handles both requirements and objectives
 * Integrates with SequentialRequirementsManager for state propagation
 */
export function useStepChecker(props: UseStepCheckerProps): UseStepCheckerReturn {
  const {
    requirements,
    objectives,
    hints,
    stepId,
    targetAction,
    refTarget,
    isEligibleForChecking: rawIsEligibleForChecking = true,
    skippable = false,
    stepIndex,
    lazyRender,
    scrollContainer,
    disabled = false,
    onStepComplete,
    onComplete,
  } = props;

  // Pause requirement checks while an implied-0th-step alignment prompt is
  // pending — keeps step 1 from racing the user's redirect decision and
  // showing a redundant "Fix this" alongside the prompt.
  const isAlignmentPaused = useIsAlignmentPaused();
  const isEligibleForChecking = rawIsEligibleForChecking && !isAlignmentPaused;

  const [fsmState, dispatch] = useReducer(stepReducer, undefined, () => createInitialState({ canSkip: skippable }));
  // Memoize the legacy projection so its identity only changes on real FSM
  // transitions. `toLegacyState` returns a fresh object literal every call, so
  // without this memo every parent re-render would produce a new `state` and
  // recreate downstream `useCallback`s (e.g. `markCompleted` depends on
  // `[state, updateManager]`), propagating new function references to children.
  const state = useMemo(() => toLegacyState(fsmState), [fsmState]);

  // REACT: Track mounted state to prevent state updates after unmount (R4)
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Safe dispatch wrapper that checks if component is still mounted
  const safeDispatch = useCallback((action: StepAction) => {
    if (isMountedRef.current) {
      dispatch(action);
    }
  }, []);

  // Track previous isEnabled state to detect actual transitions
  const prevIsEnabledRef = useRef(state.isEnabled);

  // Track when step became enabled to prevent immediate rechecks
  const enabledTimestampRef = useRef<number>(0);

  // CRITICAL: Track the LATEST eligibility value via ref to avoid stale closures in async checkStep
  // The async checkStep function can be mid-execution when eligibility changes, causing it to
  // use a stale captured value. This ref always has the current value.
  const isEligibleRef = useRef(isEligibleForChecking);
  isEligibleRef.current = isEligibleForChecking;

  // Same stale-closure rationale as `isEligibleRef`. Tracked separately so the
  // alignment pause can short-circuit Phase 1 (objectives) explicitly — the
  // eligibility gate alone only blocks Phase 2/3, which lets a coincidentally
  // satisfied objective auto-complete the step out from under the prompt.
  const isAlignmentPausedRef = useRef(isAlignmentPaused);
  isAlignmentPausedRef.current = isAlignmentPaused;

  const timeoutManager = useTimeoutManager();

  // Subscribe to manager state changes via useSyncExternalStore
  // This ensures React renders are synchronized with manager state updates
  // Note: We keep this subscription active but don't use the value directly in effects
  // to prevent infinite loops. The registered step checker callback handles rechecks instead.
  useSequentialStepState(stepId);

  // Unified condition checker: handles both requirements and objectives.
  // Objectives pass `maxRetriesOverride: 0` and a short `timeoutMs`; requirements
  // get the default retry behaviour and (optional) lazyRender gating.
  const checkRequirementsWithStateUpdates = useCallback(
    async (
      options: {
        requirements: string;
        targetAction?: string;
        refTarget?: string;
        stepId?: string;
        /** Force a specific retry count (0 disables retries entirely). */
        maxRetriesOverride?: number;
        /** Wrap the entire call in Promise.race with this timeout. Reject propagates to caller. */
        timeoutMs?: number;
      },
      onStateUpdate: (retryCount: number, maxRetries: number, isRetrying: boolean) => void
    ) => {
      const {
        requirements,
        targetAction = 'button',
        refTarget = '',
        stepId: optionsStepId,
        maxRetriesOverride,
        timeoutMs,
      } = options;
      // When lazyRender is enabled, don't do automatic retries - let the button handle lazy scroll.
      // The explicit override (passed by the objectives path) takes precedence.
      const maxRetries = maxRetriesOverride ?? (lazyRender ? 0 : INTERACTIVE_CONFIG.delays.requirements.maxRetries);

      const attemptCheck = async (retryCount: number): Promise<any> => {
        // REACT: Check mounted before state updates to prevent updates after unmount (R4)
        if (!isMountedRef.current) {
          return { requirements: requirements || '', pass: false, error: [] };
        }

        // Update state with current retry info
        onStateUpdate(retryCount, maxRetries, retryCount > 0);

        try {
          const result = await checkRequirements({
            requirements,
            targetAction,
            refTarget,
            stepId: optionsStepId,
            retryCount: 0, // Disable internal retry since we're handling it here
            maxRetries: 0,
            lazyRender,
            scrollContainer,
          });

          // REACT: Check mounted before continuing recursive calls (R4)
          if (!isMountedRef.current) {
            return result;
          }

          // If successful, return result
          if (result.pass) {
            return result;
          }

          // If failed and we have retries left, wait and retry
          if (retryCount < maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.requirements.retryDelay));
            // Check mounted again after delay
            if (!isMountedRef.current) {
              return result;
            }
            return attemptCheck(retryCount + 1);
          }

          // No more retries, return failure
          return result;
        } catch (error) {
          // REACT: Check mounted before retry (R4)
          if (!isMountedRef.current) {
            return { requirements: requirements || '', pass: false, error: [] };
          }

          // On error, retry if we have attempts left
          if (retryCount < maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.requirements.retryDelay));
            // Check mounted again after delay
            if (!isMountedRef.current) {
              return { requirements: requirements || '', pass: false, error: [] };
            }
            return attemptCheck(retryCount + 1);
          }

          // No more retries, return error
          return {
            requirements: requirements || '',
            pass: false,
            error: [
              {
                requirement: requirements || 'unknown',
                pass: false,
                error: `Requirements check failed after ${maxRetries + 1} attempts: ${error}`,
              },
            ],
          };
        }
      };

      const work = attemptCheck(0);
      if (timeoutMs === undefined) {
        return work;
      }
      // Capture the timer ID so we can clear it once `work` settles. Without
      // this the rejection handler keeps firing after unmount or success,
      // constructing an Error and rejecting an already-settled promise.
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`Conditions check timed out after ${timeoutMs}ms`)), timeoutMs);
      });
      return Promise.race([work, timeoutPromise]).finally(() => {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
      });
    },
    [lazyRender, scrollContainer] // checkRequirements is an imported function but lazyRender/scrollContainer are props
  );

  // Manager integration for state propagation
  // Use context-based hook with fallback to singleton for backward compatibility
  const { manager } = useRequirementsManager();
  const managerRef = useRef<SequentialRequirementsManager>(manager);

  // Ensure manager has the latest stepIndex
  useEffect(() => {
    if (stepIndex !== undefined && managerRef.current) {
      managerRef.current.updateStep(stepId, { stepIndex });
    }
  }, [stepId, stepIndex]);

  /**
   * Update manager with unified state for cross-step propagation
   */
  const updateManager = useCallback(
    (newState: typeof state) => {
      if (managerRef.current) {
        managerRef.current.updateStep(stepId, {
          isEnabled: newState.isEnabled,
          isCompleted: newState.isCompleted,
          isChecking: newState.isChecking,
          error: newState.error,
          explanation: newState.explanation,
          // Add completion reason for future extensibility
          ...(newState.completionReason !== 'none' && { completionReason: newState.completionReason }),
          stepIndex,
        });
      }
    },
    [stepId, stepIndex]
  );

  // Get the interactive elements hook for proper requirements checking
  const { fixNavigationRequirements } = useInteractiveElements();

  // Import NavigationManager for parent expansion functionality
  const navigationManagerRef = useRef<any>(null);
  if (!navigationManagerRef.current) {
    // Lazy import to avoid circular dependencies
    import('../interactive-engine').then(({ NavigationManager }) => {
      navigationManagerRef.current = new NavigationManager();
    });
  }

  /**
   * Check step conditions with priority logic:
   * 1. Objectives (auto-complete if met)
   * 2. Sequential eligibility (block if previous steps incomplete)
   * 3. Requirements (validate if eligible)
   */
  const checkStep = useCallback(async () => {
    // Prevent infinite loops by checking if we're already in the right state
    if (state.isChecking) {
      return;
    }

    // REACT: Check mounted before starting async operation (R4)
    if (!isMountedRef.current) {
      return;
    }

    // Prevent checking too soon after becoming enabled (let DOM settle)
    const timeSinceEnabled = Date.now() - enabledTimestampRef.current;
    if (state.isEnabled && timeSinceEnabled < 200) {
      // Skip this check - DOM might not be settled yet
      return;
    }

    safeDispatch({ type: 'START_CHECK' });

    try {
      // PHASE 0: Honor the alignment pause as a global freeze.
      //
      // The implied-0th-step alignment prompt asks the user whether to navigate
      // to the guide's `startingLocation` before step 1's checks should
      // produce any UI. `isEligibleForChecking` is already gated against this
      // pause (see line ~104), but that gate only blocks Phase 2 — and Phase 1
      // (objectives) runs first. If the user's current page coincidentally
      // satisfies the objectives selector, Phase 1 would auto-complete the
      // step and dispatch `SET_COMPLETED` *before* the eligibility gate ever
      // ran, bypassing the pause entirely (and racing the user's redirect
      // decision).
      //
      // Dispatch a blocked state (rather than just returning) so the existing
      // "AlignmentPendingContext gate" contract holds — `isEnabled` stays
      // false while the prompt is up, matching what the requirements-only
      // path already produces via Phase 2.
      if (isAlignmentPausedRef.current) {
        const blockedState = createBlockedState(stepId);
        safeDispatch(actionFromBaseStepState(blockedState));
        updateManager(blockedState);
        return;
      }

      // PHASE 1: Check objectives first (they always win).
      // Same checker as requirements; just no retries and a short timeout — objectives are
      // a snapshot of "is this already done?", not a target to wait for.
      //
      // Failures inside this block (including the 3s `timeoutMs` rejection from
      // `checkRequirementsWithStateUpdates`) must NOT abort `checkStep`. The legacy
      // `checkConditions` swallowed timeouts and returned `{ pass: false }`, allowing
      // the flow to fall through to eligibility (Phase 2) and requirements (Phase 3).
      // Letting an objectives-check rejection propagate to the outer `catch` would
      // strand the step in an error state on slow networks. Treat any objectives
      // failure here as "objectives unmet" and continue.
      if (objectives && objectives.trim() !== '') {
        let objectivesPassed = false;
        try {
          const objectivesResult = await checkRequirementsWithStateUpdates(
            {
              requirements: objectives,
              targetAction: targetAction || 'button',
              refTarget: refTarget || stepId,
              stepId,
              maxRetriesOverride: 0,
              timeoutMs: 3000,
            },
            () => {
              /* no-op: objectives don't surface retry state to the UI */
            }
          );
          objectivesPassed = objectivesResult.pass;
        } catch (objectivesError) {
          // Timeout or unexpected error: log and fall through. The outer `catch`
          // is reserved for failures in Phase 2/3, where erroring is the correct
          // user-facing outcome.
          console.warn('Objectives check failed; falling through to requirements:', objectivesError);
        }

        if (objectivesPassed) {
          const finalState = createObjectivesCompletedState(skippable);
          // REACT: Check mounted before state update (R4)
          if (isMountedRef.current) {
            dispatch(actionFromBaseStepState(finalState));
            prevIsEnabledRef.current = true;
            enabledTimestampRef.current = Date.now();
            updateManager(finalState);
          }
          return;
        }
      }

      // PHASE 2: Check eligibility (sequential dependencies)
      // CRITICAL: Use ref to get the LATEST eligibility value, not the stale closure value
      const currentEligibility = isEligibleRef.current;
      if (!currentEligibility) {
        const blockedState = createBlockedState(stepId);
        safeDispatch(actionFromBaseStepState(blockedState));
        updateManager(blockedState);
        return;
      }

      // PHASE 3: Check requirements (only if objectives not met and eligible)
      if (requirements && requirements.trim() !== '') {
        const requirementsResult = await checkRequirementsWithStateUpdates(
          {
            requirements,
            targetAction: targetAction || 'button',
            refTarget: refTarget || stepId,
            stepId,
          },
          (retryCount, _maxRetries, isRetrying) => {
            safeDispatch({ type: 'UPDATE_RETRY', retryCount, isRetrying });
          }
        );

        const requirementsState = createRequirementsState(requirementsResult, requirements, hints, skippable);

        // REACT: Check mounted before state update (R4)
        if (!isMountedRef.current) {
          return;
        }

        const action = actionFromBaseStepState(requirementsState);
        const isTransitioningToEnabled = !prevIsEnabledRef.current && requirementsResult.pass;
        if (isTransitioningToEnabled) {
          dispatch(action);
          prevIsEnabledRef.current = true;
          enabledTimestampRef.current = Date.now();
          updateManager(requirementsState);
        } else {
          safeDispatch(action);
          prevIsEnabledRef.current = requirementsResult.pass;
          if (requirementsResult.pass) {
            enabledTimestampRef.current = Date.now();
          }
          updateManager(requirementsState);
        }
        return;
      }

      // PHASE 4: No conditions - always enabled
      const enabledState = createEnabledState(skippable);

      // REACT: Check mounted before state update (R4)
      if (!isMountedRef.current) {
        return;
      }

      const enabledAction = actionFromBaseStepState(enabledState);
      const wasDisabled = !prevIsEnabledRef.current;
      if (wasDisabled) {
        dispatch(enabledAction);
        prevIsEnabledRef.current = true;
        enabledTimestampRef.current = Date.now();
      } else {
        safeDispatch(enabledAction);
      }
      updateManager(enabledState);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to check step conditions';
      const errorState = createErrorState(errorMessage, requirements || objectives, hints, skippable);
      safeDispatch(actionFromBaseStepState(errorState));
      updateManager(errorState);
    }
  }, [objectives, requirements, hints, stepId, isEligibleForChecking, skippable, updateManager, safeDispatch]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Attempt to automatically fix failed requirements via the fix-handler registry.
   * Wraps `dispatchFix` with mount-safety, the post-fix recheck, and error reporting.
   */
  const fixRequirement = useCallback(async () => {
    if (!state.canFixRequirement) {
      return;
    }

    // REACT: Check mounted before starting async operation (R4)
    if (!isMountedRef.current) {
      return;
    }

    // `lazy-scroll` is a hint to the consumer (the action button in
    // `interactive-step.tsx` runs the discovery scroll via `tryLazyScrollAndExecute`),
    // not a fix the registry can dispatch. Short-circuit so we don't call
    // `dispatchFix` (which would return `{ ok: false }` for an unmatched handler
    // and clobber the state into `SET_ERROR`). Leaving state untouched keeps
    // `canFixRequirement` and `fixType` intact so the action button remains
    // available — matching the pre-FSM behaviour.
    if (state.fixType === 'lazy-scroll') {
      return;
    }

    try {
      safeDispatch({ type: 'START_CHECK' });

      const result = await dispatchFix({
        fixType: state.fixType,
        targetHref: state.targetHref,
        scrollContainer: state.scrollContainer,
        requirements,
        stepId,
        navigationManager: navigationManagerRef.current,
        fixNavigationRequirements,
      });

      if (!result.ok) {
        console.warn('Fix failed:', result.error);
        if (isMountedRef.current) {
          // Preserve the existing fix metadata so the user can retry.
          // The reducer's `SET_ERROR` defaults `canFix` to `false` and clears
          // the rest, so we must pass them explicitly — otherwise the fix
          // button vanishes after a single failed attempt. (The pre-FSM code
          // used `setState(prev => ({ ...prev, error }))`, which preserved
          // these fields via spread.)
          safeDispatch({
            type: 'SET_ERROR',
            error: result.error,
            canFix: state.canFixRequirement,
            fixType: state.fixType,
            targetHref: state.targetHref,
            scrollContainer: state.scrollContainer,
          });
        }
        return;
      }

      // REACT: Check mounted before continuing after async operations (R4)
      if (!isMountedRef.current) {
        return;
      }

      // After fixing, recheck the requirements
      await new Promise<void>((resolve) =>
        timeoutManager.setTimeout(
          `fix-recheck-${stepId}`,
          () => resolve(),
          INTERACTIVE_CONFIG.delays.debouncing.stateSettling
        )
      );
      await checkStep();
    } catch (error) {
      console.error('Failed to fix requirements:', error);
      // Same preservation rationale as the `!result.ok` branch above.
      safeDispatch({
        type: 'SET_ERROR',
        error: 'Failed to fix requirements',
        canFix: state.canFixRequirement,
        fixType: state.fixType,
        targetHref: state.targetHref,
        scrollContainer: state.scrollContainer,
      });
    }
  }, [
    state.canFixRequirement,
    state.fixType,
    state.targetHref,
    state.scrollContainer,
    requirements,
    fixNavigationRequirements,
    checkStep,
    stepId,
    timeoutManager,
    safeDispatch,
  ]);

  /**
   * Manual completion (for user-executed steps)
   */
  const markCompleted = useCallback(() => {
    dispatch({ type: 'SET_COMPLETED', reason: 'manual', explanation: 'Completed' });
    updateManager({
      ...state,
      isCompleted: true,
      isEnabled: false,
      isSkipped: false,
      completionReason: 'manual',
      explanation: 'Completed',
    });
  }, [state, updateManager]);

  /**
   * Mark step as skipped (for steps that can't meet requirements but are skippable)
   */
  const markSkipped = useCallback(() => {
    dispatch({ type: 'SET_COMPLETED', reason: 'skipped', explanation: 'Skipped due to requirements' });
    updateManager({
      ...state,
      isCompleted: true,
      isEnabled: false,
      isSkipped: true,
      completionReason: 'skipped',
      explanation: 'Skipped due to requirements',
    });

    // Trigger check for dependent steps when this step is skipped
    if (managerRef.current) {
      timeoutManager.setTimeout(
        `skip-reactive-check-${stepId}`,
        () => {
          managerRef.current?.triggerReactiveCheck();
        },
        100
      );
    }
  }, [updateManager, stepId, timeoutManager]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Reset step to initial state (including skipped state) and recheck requirements
   */
  const resetStep = useCallback(() => {
    dispatch({ type: 'RESET', canSkip: skippable });
    updateManager({
      isEnabled: false,
      isCompleted: false,
      isChecking: false,
      isSkipped: false,
      completionReason: 'none',
      explanation: undefined,
      error: undefined,
      canFixRequirement: false,
      canSkip: skippable,
      fixType: undefined,
      targetHref: undefined,
      scrollContainer: undefined,
      retryCount: 0,
      maxRetries: INTERACTIVE_CONFIG.delays.requirements.maxRetries,
      isRetrying: false,
    });

    // Recheck requirements after reset
    timeoutManager.setTimeout(
      `reset-recheck-${stepId}`,
      () => {
        checkStepRef.current();
      },
      50
    );
  }, [skippable, updateManager, stepId, timeoutManager]); // Removed checkStep to prevent infinite loops

  /**
   * Stable reference to checkStep function for event-driven triggers
   */
  const checkStepRef = useRef(checkStep);
  checkStepRef.current = checkStep;

  // Initial requirements check for first steps when component mounts
  useEffect(() => {
    // Use helper function to detect first step in a section or standalone step
    if (isFirstStep(stepId) && !state.isCompleted && !state.isChecking) {
      checkStepRef.current();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- Intentionally empty - only run on mount

  // Auto-complete notification when objectives are met
  // When a step's objectives are satisfied, notify the parent via callbacks.
  // This centralizes a bug fix needed across
  // interactive-step, interactive-guided, and interactive-multi-step components.
  useEffect(() => {
    if (state.completionReason === 'objectives' && !disabled) {
      onStepComplete?.(stepId);
      onComplete?.();
    }
  }, [state.completionReason, stepId, disabled, onStepComplete, onComplete]);

  // Register step checker with global manager for targeted re-checking
  // This is called by context changes (EchoSrv), watchNextStep, and triggerStepCheck
  useEffect(() => {
    if (managerRef.current) {
      const unregisterChecker = managerRef.current.registerStepCheckerByID(stepId, () => {
        const currentState = managerRef.current?.getStepState(stepId);
        // Recheck if:
        // 1. Step is not completed
        // 2. Step is not currently checking (prevent concurrent checks)
        // 3. Step is either eligible OR has failed requirements (needs recheck on context change)
        const shouldRecheck = !currentState?.isCompleted && !currentState?.isChecking;

        if (shouldRecheck) {
          checkStepRef.current();
        }
      });

      return () => {
        unregisterChecker();
      };
    }
    return undefined;
  }, [stepId]);

  // Check requirements when step eligibility changes (both true and false)
  // Note: We removed managerStepState from deps to prevent infinite loops
  // The manager state changes are handled by the registered step checker callback instead
  useEffect(() => {
    if (!state.isCompleted && !state.isChecking) {
      // Always recheck when eligibility changes, whether becoming eligible or ineligible
      // This ensures steps show the correct "blocked" state when they become ineligible
      checkStepRef.current();
    }
  }, [isEligibleForChecking]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for section completion events (for section dependencies)
  useEffect(() => {
    const handleSectionCompletion = () => {
      if (!state.isCompleted && requirements?.includes('section-completed:')) {
        checkStep();
      }
    };

    // Listen for auto-skip events from section execution
    const handleAutoSkip = (event: CustomEvent) => {
      if (event.detail?.stepId === stepId && !state.isCompleted) {
        markSkipped();
      }
    };

    document.addEventListener('section-completed', handleSectionCompletion);
    document.addEventListener('step-auto-skipped', handleAutoSkip as EventListener);

    return () => {
      document.removeEventListener('section-completed', handleSectionCompletion);
      document.removeEventListener('step-auto-skipped', handleAutoSkip as EventListener);
    };
  }, [checkStep, state.isCompleted, requirements, stepId, markSkipped]);

  // Track state values in refs to avoid re-subscribing when they change during checks
  const isCheckingRef = useRef(state.isChecking);
  isCheckingRef.current = state.isChecking;

  const isCompletedRef = useRef(state.isCompleted);
  isCompletedRef.current = state.isCompleted;

  const isEnabledRef = useRef(state.isEnabled);
  isEnabledRef.current = state.isEnabled;

  // Track objectives in ref to avoid stale closure issues
  const objectivesRef = useRef(objectives);
  objectivesRef.current = objectives;

  // Subscribe to context changes (EchoSrv events) AND URL changes for blocked steps
  // This ensures steps in "requirements not met" state get rechecked when user performs actions
  useEffect(() => {
    // Only subscribe when step is eligible for checking (sequential dependency met)
    // We check isBlocked inside the callbacks using refs to avoid re-subscription cycles
    if (!isEligibleForChecking) {
      return;
    }

    // If already completed, no need to subscribe
    if (state.isCompleted) {
      return;
    }

    // For lazyRender steps with lazy-scroll fixType, skip continuous rechecking
    // Let the user click the button to trigger lazy scroll instead of auto-rechecking
    if (lazyRender && state.fixType === 'lazy-scroll') {
      return;
    }

    // Subscribe to context changes from EchoSrv
    let contextUnsubscribe: (() => void) | undefined;
    let isSubscribed = true;

    // Shared recheck function that checks current state via refs
    const triggerRecheckIfBlocked = () => {
      // Use refs to get current state without causing re-subscription
      const isCompleted = isCompletedRef.current;
      const isEnabled = isEnabledRef.current;
      const isChecking = isCheckingRef.current;
      const currentObjectives = objectivesRef.current; // Get latest objectives from ref

      // Recheck if:
      // 1. Step is blocked (not enabled) - might become enabled after navigation
      // 2. Step is enabled with objectives - objectives might be satisfied after navigation
      const hasObjectives = currentObjectives && currentObjectives.trim() !== '';
      const shouldRecheck = !isCompleted && !isChecking && (!isEnabled || hasObjectives);

      if (shouldRecheck) {
        checkStepRef.current();
      }
    };

    import('../context-engine').then(({ ContextService }) => {
      if (!isSubscribed) {
        return; // Component unmounted or state changed before import resolved
      }
      contextUnsubscribe = ContextService.onContextChange(() => triggerRecheckIfBlocked());
    });

    // Also subscribe to URL changes (navigation) since EchoSrv doesn't capture menu clicks
    let lastUrl = window.location.href;
    const handleUrlChange = () => {
      const currentUrl = window.location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        // Small delay to let the page settle
        setTimeout(() => {
          if (isSubscribed) {
            triggerRecheckIfBlocked();
          }
        }, 500);
      }
    };

    // Listen for navigation events
    window.addEventListener('popstate', handleUrlChange);
    window.addEventListener('hashchange', handleUrlChange);
    document.addEventListener('grafana:location-changed', handleUrlChange);

    // Also check periodically for SPA navigation that doesn't fire events
    const urlCheckInterval = setInterval(handleUrlChange, 2000);

    return () => {
      isSubscribed = false;
      if (contextUnsubscribe) {
        contextUnsubscribe();
      }
      window.removeEventListener('popstate', handleUrlChange);
      window.removeEventListener('hashchange', handleUrlChange);
      document.removeEventListener('grafana:location-changed', handleUrlChange);
      clearInterval(urlCheckInterval);
    };
  }, [isEligibleForChecking, state.isCompleted, state.fixType, lazyRender, stepId]); // Only re-subscribe when eligibility, completion, or lazy-scroll state changes (objectives tracked via ref)

  // Scoped heartbeat recheck for fragile prerequisites
  useEffect(() => {
    // Guard: feature flag
    if (!INTERACTIVE_CONFIG.requirements?.heartbeat?.enabled) {
      return;
    }

    // Only run when step is enabled, not completed, and requirements are fragile
    const req = requirements || '';
    const isFragile = INTERACTIVE_CONFIG.requirements.heartbeat.onlyForFragile
      ? req.includes('navmenu-open') || req.includes('exists-reftarget') || req.includes('on-page:')
      : !!req;

    if (!isFragile || state.isCompleted || !state.isEnabled) {
      return;
    }

    const intervalMs = INTERACTIVE_CONFIG.requirements.heartbeat.intervalMs;
    const watchWindowMs = INTERACTIVE_CONFIG.requirements.heartbeat.watchWindowMs;

    let stopped = false;
    const start = Date.now();

    const tick = async () => {
      if (stopped) {
        return;
      }
      await checkStepRef.current();
      if (watchWindowMs > 0 && Date.now() - start >= watchWindowMs) {
        stopped = true;
        return;
      }
      // schedule next tick
      setTimeout(tick, intervalMs);
    };

    // Add initial delay before first heartbeat check to let DOM settle
    // This prevents immediate recheck right after step becomes enabled
    const initialDelay = intervalMs + 500; // Add 500ms buffer to normal interval
    const timeoutId = setTimeout(tick, initialDelay);

    return () => {
      stopped = true;
      clearTimeout(timeoutId);
    };
  }, [requirements, state.isEnabled, state.isCompleted]);

  return {
    ...state,
    checkStep,
    markCompleted,
    markSkipped: skippable ? markSkipped : undefined,
    resetStep,
    canFixRequirement: state.canFixRequirement,
    fixType: state.fixType,
    fixRequirement: state.canFixRequirement ? fixRequirement : undefined,
  };
}
