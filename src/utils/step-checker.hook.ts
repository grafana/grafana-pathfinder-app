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
import { getRequirementExplanation } from './requirement-explanations';
import { SequentialRequirementsManager } from './requirements-checker.hook';
import { useInteractiveElements } from './interactive.hook';
import { INTERACTIVE_CONFIG } from '../constants/interactive-config';
import { useTimeoutManager } from './timeout-manager';
import { checkRequirements } from './requirements-checker.utils';
import { useSequentialStepState } from './use-sequential-step-state.hook';

export interface UseStepCheckerProps {
  requirements?: string;
  objectives?: string;
  hints?: string;
  stepId: string;
  targetAction?: string; // Add targetAction to pass through to requirements checking
  refTarget?: string; // Add refTarget to pass through to requirements checking
  isEligibleForChecking: boolean;
  skippable?: boolean; // Whether this step can be skipped if requirements fail
}

export interface UseStepCheckerReturn {
  // Unified state
  isEnabled: boolean;
  isCompleted: boolean;
  isChecking: boolean;
  isSkipped?: boolean; // Whether this step was skipped due to failed requirements

  // Retry state
  retryCount?: number; // Current retry attempt
  maxRetries?: number; // Maximum retry attempts
  isRetrying?: boolean; // Whether currently in a retry cycle

  // Diagnostics
  completionReason: 'none' | 'objectives' | 'manual' | 'skipped';
  explanation?: string;
  error?: string;
  canFixRequirement?: boolean; // Whether the requirement can be automatically fixed
  canSkip?: boolean; // Whether this step can be skipped

  // Actions
  checkStep: () => Promise<void>;
  markCompleted: () => void;
  markSkipped?: () => void; // Function to skip this step
  resetStep: () => void; // Reset all step state including skipped
  fixRequirement?: () => Promise<void>; // Function to automatically fix the requirement
}

/**
 * Unified step checker that handles both requirements and objectives
 * Integrates with SequentialRequirementsManager for state propagation
 */
export function useStepChecker({
  requirements,
  objectives,
  hints,
  stepId,
  targetAction,
  refTarget,
  isEligibleForChecking = true,
  skippable = false,
}: UseStepCheckerProps): UseStepCheckerReturn {
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
    retryCount: 0,
    maxRetries: INTERACTIVE_CONFIG.delays.requirements.maxRetries as number,
    isRetrying: false,
  });

  const timeoutManager = useTimeoutManager();

  // Requirements checking is now handled by the pure requirements utility
  const { checkRequirementsFromData } = useInteractiveElements();

  // Subscribe to manager state changes via useSyncExternalStore
  // This ensures React renders are synchronized with manager state updates
  const managerStepState = useSequentialStepState(stepId);

  // Custom requirements checker that provides state updates for retry feedback
  const checkRequirementsWithStateUpdates = useCallback(
    async (
      options: { requirements: string; targetAction?: string; refTarget?: string; stepId?: string },
      onStateUpdate: (retryCount: number, maxRetries: number, isRetrying: boolean) => void
    ) => {
      const { requirements, targetAction = 'button', refTarget = '', stepId: optionsStepId } = options;
      const maxRetries = INTERACTIVE_CONFIG.delays.requirements.maxRetries;

      const attemptCheck = async (retryCount: number): Promise<any> => {
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
          });

          // If successful, return result
          if (result.pass) {
            return result;
          }

          // If failed and we have retries left, wait and retry
          if (retryCount < maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.requirements.retryDelay));
            return attemptCheck(retryCount + 1);
          }

          // No more retries, return failure
          return result;
        } catch (error) {
          // On error, retry if we have attempts left
          if (retryCount < maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.requirements.retryDelay));
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
    [] // checkRequirements is an imported function and doesn't need to be in dependencies
  );

  // Manager integration for state propagation
  const managerRef = useRef<SequentialRequirementsManager | null>(null);

  // Initialize manager reference
  if (!managerRef.current) {
    managerRef.current = SequentialRequirementsManager.getInstance();
  }

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
        });
      }
    },
    [stepId]
  );

  // Get the interactive elements hook for proper requirements checking
  const { fixNavigationRequirements } = useInteractiveElements();

  // Import NavigationManager for parent expansion functionality
  const navigationManagerRef = useRef<any>(null);
  if (!navigationManagerRef.current) {
    // Lazy import to avoid circular dependencies
    import('./navigation-manager').then(({ NavigationManager }) => {
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
    [stepId, refTarget, targetAction, checkRequirementsFromData]
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

    setState((prev) => ({ ...prev, isChecking: true, error: undefined, retryCount: 0, isRetrying: false }));

    try {
      // STEP 1: Check objectives first (they always win)
      if (objectives && objectives.trim() !== '') {
        const objectivesResult = await checkConditions(objectives, 'objectives');
        if (objectivesResult.pass) {
          const finalState = {
            isEnabled: true,
            isCompleted: true,
            isChecking: false,
            isSkipped: false,
            completionReason: 'objectives' as const,
            explanation: 'Already done!',
            error: undefined,
            canFixRequirement: false,
            canSkip: skippable,
            fixType: undefined,
            targetHref: undefined,
            retryCount: 0,
            maxRetries: INTERACTIVE_CONFIG.delays.requirements.maxRetries as number,
            isRetrying: false,
          };
          setState(finalState);
          updateManager(finalState);
          return;
        } else if (objectivesResult.error) {
          // Objectives check failed - log error but continue to requirements (per spec)
          console.warn(`Objectives check failed for ${stepId}:`, objectivesResult.error);
        }
      }

      // STEP 2: Check eligibility (sequential dependencies)
      if (!isEligibleForChecking) {
        // Step is not eligible for checking

        // Check if this step is part of a section (section controls its own eligibility)
        const isPartOfSection = stepId.includes('section-') && stepId.includes('-step-');

        if (isPartOfSection) {
          // Section step not eligible - set blocked state with sequential dependency message
          const sectionBlockedState = {
            isEnabled: false,
            isCompleted: false,
            isChecking: false,
            isSkipped: false,
            completionReason: 'none' as const,
            explanation: 'Complete the previous steps in order before this one becomes available.',
            error: 'Sequential dependency not met',
            canFixRequirement: false,
            canSkip: false, // Never allow skipping for sequential dependencies
            fixType: undefined,
            targetHref: undefined,
            retryCount: 0,
            maxRetries: INTERACTIVE_CONFIG.delays.requirements.maxRetries as number,
            isRetrying: false,
          };
          setState(sectionBlockedState);
          updateManager(sectionBlockedState);
          return;
        } else {
          const blockedState = {
            isEnabled: false,
            isCompleted: false,
            isChecking: false,
            isSkipped: false,
            completionReason: 'none' as const,
            explanation: 'Complete the previous steps in order before this one becomes available.',
            error: 'Sequential dependency not met',
            canFixRequirement: false,
            canSkip: false, // Never allow skipping for sequential dependencies
            fixType: undefined,
            targetHref: undefined,
            retryCount: 0,
            maxRetries: INTERACTIVE_CONFIG.delays.requirements.maxRetries as number,
            isRetrying: false,
          };
          setState(blockedState);
          updateManager(blockedState);
          return;
        }
      }

      // STEP 3: Check requirements (only if objectives not met and eligible)
      if (requirements && requirements.trim() !== '') {
        // Use requirements checker with state updates for retry feedback
        const requirementsResult = await checkRequirementsWithStateUpdates(
          {
            requirements,
            targetAction: targetAction || 'button',
            refTarget: refTarget || stepId,
            stepId,
          },
          (retryCount, maxRetries, isRetrying) => {
            setState((prev) => ({
              ...prev,
              retryCount,
              maxRetries,
              isRetrying,
              isChecking: true,
            }));
          }
        );

        const explanation = requirementsResult.pass
          ? undefined
          : getRequirementExplanation(
              requirements,
              hints,
              requirementsResult.error?.map((e: any) => e.error).join(', '),
              skippable
            );

        // Check for fixable errors and extract fix information
        const fixableError = requirementsResult.error?.find((e: any) => e.canFix);
        const fixType = fixableError?.fixType || (requirements.includes('navmenu-open') ? 'navigation' : undefined);
        const targetHref = fixableError?.targetHref;
        const canFixRequirement = !!fixableError || requirements.includes('navmenu-open');

        const requirementsState = {
          isEnabled: requirementsResult.pass,
          isCompleted: false, // Requirements enable, don't auto-complete
          isChecking: false,
          isSkipped: false,
          completionReason: 'none' as const,
          explanation,
          error: requirementsResult.pass ? undefined : requirementsResult.error?.map((e: any) => e.error).join(', '),
          canFixRequirement,
          canSkip: skippable,
          fixType,
          targetHref,
          retryCount: 0, // Reset retry count after completion
          maxRetries: INTERACTIVE_CONFIG.delays.requirements.maxRetries as number,
          isRetrying: false,
        };

        setState(requirementsState);
        updateManager(requirementsState);
        return;
      }

      // STEP 4: No conditions - always enabled
      const enabledState = {
        isEnabled: true,
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
        retryCount: 0,
        maxRetries: INTERACTIVE_CONFIG.delays.requirements.maxRetries,
        isRetrying: false,
      };
      setState(enabledState);
      updateManager(enabledState);
    } catch (error) {
      console.warn(`Step checking failed for ${stepId}:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to check step conditions';
      const errorState = {
        isEnabled: false,
        isCompleted: false,
        isChecking: false,
        isSkipped: false,
        completionReason: 'none' as const,
        explanation: getRequirementExplanation(requirements || objectives, hints, errorMessage, skippable),
        error: errorMessage,
        canFixRequirement: false,
        canSkip: skippable,
        fixType: undefined,
        targetHref: undefined,
        retryCount: 0,
        maxRetries: INTERACTIVE_CONFIG.delays.requirements.maxRetries,
        isRetrying: false,
      };
      setState(errorState);
      updateManager(errorState);
    }
  }, [objectives, requirements, hints, stepId, isEligibleForChecking, skippable, updateManager]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Attempt to automatically fix failed requirements
   */
  const fixRequirement = useCallback(async () => {
    if (!state.canFixRequirement) {
      return;
    }

    try {
      setState((prev) => ({ ...prev, isChecking: true }));

      if (state.fixType === 'expand-parent-navigation' && state.targetHref && navigationManagerRef.current) {
        // Attempt to expand parent navigation section
        const success = await navigationManagerRef.current.expandParentNavigationSection(state.targetHref);

        if (!success) {
          console.error('Failed to expand parent navigation section');
          setState((prev) => ({
            ...prev,
            isChecking: false,
            error: 'Failed to expand parent navigation section',
          }));
          return;
        }
      } else if (state.fixType === 'location' && state.targetHref && navigationManagerRef.current) {
        // Fix location requirements by navigating to the expected path
        await navigationManagerRef.current.fixLocationRequirement(state.targetHref);
      } else if (state.fixType === 'navigation') {
        // Fix basic navigation requirements (menu open/dock)
        await fixNavigationRequirements();
      } else if (requirements?.includes('navmenu-open') && fixNavigationRequirements) {
        // Only fix navigation requirements if no other specific fix type is available
        await fixNavigationRequirements();
      } else {
        console.warn('Unknown fix type:', state.fixType);
        setState((prev) => ({
          ...prev,
          isChecking: false,
          error: 'Unable to automatically fix this requirement',
        }));
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
      setState((prev) => ({
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
    const isFirstStep = stepId?.includes('-step-1') || (!stepId?.includes('section-') && !stepId?.includes('step-'));
    if (isFirstStep && !state.isCompleted && !state.isChecking) {
      checkStepRef.current();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- Intentionally empty - only run on mount

  // Register step checker with global manager for targeted re-checking
  useEffect(() => {
    if (managerRef.current) {
      const unregisterChecker = managerRef.current.registerStepCheckerByID(stepId, () => {
        const currentState = managerRef.current?.getStepState(stepId);
        if (!currentState?.isCompleted && isEligibleForChecking) {
          checkStepRef.current();
        }
      });

      return () => {
        unregisterChecker();
      };
    }
    return undefined;
  }, [stepId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Check requirements when step eligibility changes (both true and false)
  // Also recheck when manager state changes (via useSyncExternalStore)
  useEffect(() => {
    if (!state.isCompleted) {
      // Always recheck when eligibility changes, whether becoming eligible or ineligible
      // This ensures steps show the correct "blocked" state when they become ineligible
      checkStepRef.current();
    }
  }, [isEligibleForChecking, managerStepState]); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [checkStep, state.isCompleted, requirements, stepId, markSkipped]); // eslint-disable-line react-hooks/exhaustive-deps -- Intentionally minimal dependencies for event listeners

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

    const timeoutId = setTimeout(tick, intervalMs);

    return () => {
      stopped = true;
      clearTimeout(timeoutId);
    };
  }, [requirements, state.isEnabled, state.isCompleted]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    ...state,
    checkStep,
    markCompleted,
    markSkipped: skippable ? markSkipped : undefined,
    resetStep,
    canFixRequirement: state.canFixRequirement,
    fixRequirement: state.canFixRequirement ? fixRequirement : undefined,
  };
}
