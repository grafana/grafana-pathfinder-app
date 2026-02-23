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

import { useState, useCallback, useEffect, useRef } from 'react';
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
import { useInteractiveElements, useSequentialStepState } from '../interactive-engine';
import { INTERACTIVE_CONFIG, isFirstStep } from '../constants/interactive-config';
import { useTimeoutManager } from '../utils/timeout-manager';
import { checkRequirements } from './requirements-checker.utils';
import type { UseStepCheckerProps, UseStepCheckerReturn } from '../types/hooks.types';

// Re-export for convenience
export type { UseStepCheckerProps, UseStepCheckerReturn };

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
    isEligibleForChecking = true,
    skippable = false,
    stepIndex,
    lazyRender,
    scrollContainer,
    disabled = false,
    onStepComplete,
    onComplete,
  } = props;
  const [state, setState] = useState({
    isEnabled: false,
    isCompleted: false,
    isChecking: false,
    isSkipped: false,
    completionReason: 'none' as 'none' | 'objectives' | 'manual' | 'skipped',
    explanation: undefined as string | undefined,
    error: undefined as string | undefined,
    canFixRequirement: false,
    canSkip: skippable,
    fixType: undefined as string | undefined,
    targetHref: undefined as string | undefined,
    scrollContainer: undefined as string | undefined, // For lazy-scroll fixes
    retryCount: 0,
    maxRetries: INTERACTIVE_CONFIG.delays.requirements.maxRetries as number,
    isRetrying: false,
  });

  // REACT: Track mounted state to prevent state updates after unmount (R4)
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Safe setState wrapper that checks if component is still mounted
  const safeSetState = useCallback((updater: typeof state | ((prev: typeof state) => typeof state)) => {
    if (isMountedRef.current) {
      setState(updater as any);
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

  const timeoutManager = useTimeoutManager();

  // Requirements checking is now handled by the pure requirements utility
  const { checkRequirementsFromData } = useInteractiveElements();

  // Subscribe to manager state changes via useSyncExternalStore
  // This ensures React renders are synchronized with manager state updates
  // Note: We keep this subscription active but don't use the value directly in effects
  // to prevent infinite loops. The registered step checker callback handles rechecks instead.
  useSequentialStepState(stepId);

  // Custom requirements checker that provides state updates for retry feedback
  const checkRequirementsWithStateUpdates = useCallback(
    async (
      options: { requirements: string; targetAction?: string; refTarget?: string; stepId?: string },
      onStateUpdate: (retryCount: number, maxRetries: number, isRetrying: boolean) => void
    ) => {
      const { requirements, targetAction = 'button', refTarget = '', stepId: optionsStepId } = options;
      // When lazyRender is enabled, don't do automatic retries - let the button handle lazy scroll
      // This prevents continuous checking loop before user initiates lazy scroll
      const maxRetries = lazyRender ? 0 : INTERACTIVE_CONFIG.delays.requirements.maxRetries;

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

      return attemptCheck(0);
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
   * Check conditions (requirements or objectives) using proper DOM check functions
   */
  const checkConditions = useCallback(
    async (conditions: string, type: 'requirements' | 'objectives') => {
      try {
        // For objectives, still use the original method since objectives don't need retries
        if (type === 'objectives') {
          // Create proper InteractiveElementData structure
          const actionData = {
            requirements: conditions,
            targetaction: targetAction || 'button',
            reftarget: refTarget || stepId, // Use actual refTarget if available, fallback to stepId
            textContent: stepId,
            tagName: 'div' as const,
            objectives: conditions,
          };

          // Add timeout to prevent hanging
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`${type} check timeout`)), 3000);
          });

          const result = await Promise.race([checkRequirementsFromData(actionData), timeoutPromise]);

          const conditionsMet = result.pass;
          const errorMessage = conditionsMet
            ? undefined
            : result.error?.map((e: any) => e.error || e.requirement).join(', ');

          const fixableError = result.error?.find((e: any) => e.canFix);

          return {
            pass: conditionsMet,
            error: errorMessage,
            canFix: !!fixableError,
            fixType: fixableError?.fixType,
            targetHref: fixableError?.targetHref,
          };
        }

        // For requirements, use the new retry-enabled checker
        const result = await checkRequirements({
          requirements: conditions,
          targetAction: targetAction || 'button',
          refTarget: refTarget || stepId,
          stepId,
          lazyRender,
          scrollContainer,
        });

        const conditionsMet = result.pass;
        const errorMessage = conditionsMet
          ? undefined
          : result.error?.map((e: any) => e.error || e.requirement).join(', ');

        // Check if any error has fix capability
        const fixableError = result.error?.find((e: any) => e.canFix);

        return {
          pass: conditionsMet,
          error: errorMessage,
          canFix: !!fixableError,
          fixType: fixableError?.fixType,
          targetHref: fixableError?.targetHref,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : `Failed to check ${type}`;
        return { pass: false, error: errorMessage };
      }
    },
    [stepId, refTarget, targetAction, checkRequirementsFromData, lazyRender, scrollContainer]
  );

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

    safeSetState((prev) => ({ ...prev, isChecking: true, error: undefined, retryCount: 0, isRetrying: false }));

    try {
      // PHASE 1: Check objectives first (they always win)
      if (objectives && objectives.trim() !== '') {
        const objectivesResult = await checkConditions(objectives, 'objectives');
        if (objectivesResult.pass) {
          const finalState = createObjectivesCompletedState(skippable);
          // REACT: Check mounted before state update (R4)
          if (isMountedRef.current) {
            setState(finalState);
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
        safeSetState(blockedState);
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
          (retryCount, maxRetries, isRetrying) => {
            safeSetState((prev) => ({
              ...prev,
              retryCount,
              maxRetries,
              isRetrying,
              isChecking: true,
            }));
          }
        );

        const requirementsState = createRequirementsState(requirementsResult, requirements, hints, skippable);

        // REACT: Check mounted before state update (R4)
        if (!isMountedRef.current) {
          return;
        }

        const isTransitioningToEnabled = !prevIsEnabledRef.current && requirementsResult.pass;
        if (isTransitioningToEnabled) {
          setState(requirementsState);
          prevIsEnabledRef.current = true;
          enabledTimestampRef.current = Date.now();
          updateManager(requirementsState);
        } else {
          safeSetState(requirementsState);
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

      const wasDisabled = !prevIsEnabledRef.current;
      if (wasDisabled) {
        setState(enabledState);
        prevIsEnabledRef.current = true;
        enabledTimestampRef.current = Date.now();
      } else {
        safeSetState(enabledState);
      }
      updateManager(enabledState);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to check step conditions';
      const errorState = createErrorState(errorMessage, requirements, objectives, hints, skippable);
      safeSetState(errorState);
      updateManager(errorState);
    }
  }, [objectives, requirements, hints, stepId, isEligibleForChecking, skippable, updateManager, safeSetState]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Attempt to automatically fix failed requirements
   */
  const fixRequirement = useCallback(async () => {
    if (!state.canFixRequirement) {
      return;
    }

    // REACT: Check mounted before starting async operation (R4)
    if (!isMountedRef.current) {
      return;
    }

    try {
      safeSetState((prev) => ({ ...prev, isChecking: true }));

      if (state.fixType === 'expand-parent-navigation' && state.targetHref && navigationManagerRef.current) {
        // Attempt to expand parent navigation section
        const success = await navigationManagerRef.current.expandParentNavigationSection(state.targetHref);

        if (!success) {
          console.error('Failed to expand parent navigation section');
          safeSetState((prev) => ({
            ...prev,
            isChecking: false,
            error: 'Failed to expand parent navigation section',
          }));
          return;
        }
      } else if (state.fixType === 'location' && state.targetHref && navigationManagerRef.current) {
        // Fix location requirements by navigating to the expected path
        await navigationManagerRef.current.fixLocationRequirement(state.targetHref);
      } else if (state.fixType === 'lazy-scroll') {
        // lazy-scroll is now handled transparently in Show me/Do it buttons
        // This case should not be reached - buttons are enabled and handle scroll automatically
        console.warn('lazy-scroll fixType should be handled by button click, not fixRequirement');
        safeSetState((prev) => ({ ...prev, isChecking: false }));
        return;
      } else if (state.fixType === 'expand-options-group') {
        // Expand all collapsed Options Group panels in the Grafana panel editor
        const collapsedToggles = document.querySelectorAll(
          'button[data-testid*="Options group"][aria-expanded="false"]'
        ) as NodeListOf<HTMLButtonElement>;

        for (const toggle of collapsedToggles) {
          toggle.click();
        }
        // Wait for React to render the newly expanded children
        await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.navigation.expansionAnimationMs));
      } else if (state.fixType === 'navigation') {
        // Fix basic navigation requirements (menu open/dock)
        await fixNavigationRequirements();
      } else if (requirements?.includes('navmenu-open') && fixNavigationRequirements) {
        // Only fix navigation requirements if no other specific fix type is available
        await fixNavigationRequirements();
      } else {
        console.warn('Unknown fix type:', state.fixType);
        safeSetState((prev) => ({
          ...prev,
          isChecking: false,
          error: 'Unable to automatically fix this requirement',
        }));
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
      safeSetState((prev) => ({
        ...prev,
        isChecking: false,
        error: 'Failed to fix requirements',
      }));
    }
  }, [
    state.canFixRequirement,
    state.fixType,
    state.targetHref,
    requirements,
    fixNavigationRequirements,
    checkStep,
    stepId,
    timeoutManager,
    safeSetState,
  ]);

  /**
   * Manual completion (for user-executed steps)
   */
  const markCompleted = useCallback(() => {
    const completedState = {
      ...state,
      isCompleted: true,
      isEnabled: false, // Completed steps are disabled
      isSkipped: false,
      completionReason: 'manual' as const,
      explanation: 'Completed',
    };
    setState(completedState);
    updateManager(completedState);
  }, [state, updateManager]);

  /**
   * Mark step as skipped (for steps that can't meet requirements but are skippable)
   */
  const markSkipped = useCallback(() => {
    const skippedState = {
      ...state,
      isCompleted: true, // Skipped steps count as completed for flow purposes
      isSkipped: true,
      isEnabled: false, // Skipped steps are disabled
      completionReason: 'skipped' as const,
      explanation: 'Skipped due to requirements',
    };
    setState(skippedState);
    updateManager(skippedState);

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
    const resetState = {
      isEnabled: false,
      isCompleted: false,
      isChecking: false,
      isSkipped: false,
      completionReason: 'none' as const,
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
    };
    setState(resetState);
    updateManager(resetState);

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
