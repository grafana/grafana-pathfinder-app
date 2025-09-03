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

export interface UseStepCheckerProps {
  requirements?: string;
  objectives?: string;
  hints?: string;
  stepId: string;
  targetAction?: string; // Add targetAction to pass through to requirements checking
  refTarget?: string; // Add refTarget to pass through to requirements checking
  isEligibleForChecking: boolean;
  skipable?: boolean; // Whether this step can be skipped if requirements fail
}

export interface UseStepCheckerReturn {
  // Unified state
  isEnabled: boolean;
  isCompleted: boolean;
  isChecking: boolean;
  isSkipped?: boolean; // Whether this step was skipped due to failed requirements

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
  skipable = false,
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
    canSkip: skipable,
    fixType: undefined as string | undefined,
    targetHref: undefined as string | undefined,
  });

  const timeoutManager = useTimeoutManager();

  // Requirements checking is now handled by the pure requirements utility

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
  const { checkRequirementsFromData, fixNavigationRequirements } = useInteractiveElements();

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
        // Create proper InteractiveElementData structure
        const actionData = {
          requirements: conditions,
          targetaction: targetAction || 'button',
          reftarget: refTarget || stepId, // Use actual refTarget if available, fallback to stepId
          textContent: stepId,
          tagName: 'div' as const,
          objectives: type === 'objectives' ? conditions : undefined,
        };

        // Add timeout to prevent hanging - PERFORMANCE FIX: Reduced timeout for faster UX
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`${type} check timeout`)), 3000); // Reduced from 5000ms to 3000ms
        });

        const result = await Promise.race([checkRequirementsFromData(actionData), timeoutPromise]);

        // For objectives: ALL must be met (AND logic as per specification)
        // For requirements: ALL must be met (same logic)
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

    setState((prev) => ({ ...prev, isChecking: true, error: undefined }));

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
            canSkip: skipable,
            fixType: undefined,
            targetHref: undefined,
          };
          setState(finalState);
          updateManager(finalState);
          return;
        } else if (objectivesResult.error) {
          // Objectives check failed - log error but continue to requirements (per spec)
          console.error(`⚠️ Objectives check failed for ${stepId}:`, objectivesResult.error);
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
          };
          setState(blockedState);
          updateManager(blockedState);
          return;
        }
      }

      // STEP 3: Check requirements (only if objectives not met and eligible)
      if (requirements && requirements.trim() !== '') {
        const requirementsResult = await checkConditions(requirements, 'requirements');

        const explanation = requirementsResult.pass
          ? undefined
          : getRequirementExplanation(requirements, hints, requirementsResult.error, skipable);

        const requirementsState = {
          isEnabled: requirementsResult.pass,
          isCompleted: false, // Requirements enable, don't auto-complete
          isChecking: false,
          isSkipped: false,
          completionReason: 'none' as const,
          explanation,
          error: requirementsResult.pass ? undefined : requirementsResult.error,
          canFixRequirement: requirementsResult.canFix || requirements.includes('navmenu-open'),
          canSkip: skipable,
          fixType: requirementsResult.fixType || (requirements.includes('navmenu-open') ? 'navigation' : undefined),
          targetHref: requirementsResult.targetHref,
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
        canSkip: skipable,
        fixType: undefined,
        targetHref: undefined,
      };
      setState(enabledState);
      updateManager(enabledState);
    } catch (error) {
      console.error(`❌ Step checking failed for ${stepId}:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to check step conditions';
      const errorState = {
        isEnabled: false,
        isCompleted: false,
        isChecking: false,
        isSkipped: false,
        completionReason: 'none' as const,
        explanation: getRequirementExplanation(requirements || objectives, hints, errorMessage, skipable),
        error: errorMessage,
        canFixRequirement: false,
        canSkip: skipable,
        fixType: undefined,
        targetHref: undefined,
      };
      setState(errorState);
      updateManager(errorState);
    }
  }, [objectives, requirements, hints, stepId, isEligibleForChecking, skipable, updateManager]); // eslint-disable-line react-hooks/exhaustive-deps

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
      } else if (requirements?.includes('navmenu-open') && fixNavigationRequirements) {
        // Fix basic navigation requirements (menu open/dock)
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
   * Mark step as skipped (for steps that can't meet requirements but are skipable)
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
      canSkip: skipable,
      fixType: undefined,
      targetHref: undefined,
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
  }, [skipable, updateManager, stepId, timeoutManager]); // Removed checkStep to prevent infinite loops

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

  // Check requirements when step becomes eligible
  useEffect(() => {
    if (isEligibleForChecking && !state.isCompleted && !state.isChecking) {
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
  }, [checkStep, state.isCompleted, requirements, stepId, markSkipped]); // eslint-disable-line react-hooks/exhaustive-deps -- Intentionally minimal dependencies for event listeners

  return {
    ...state,
    checkStep,
    markCompleted,
    markSkipped: skipable ? markSkipped : undefined,
    resetStep,
    canFixRequirement: state.canFixRequirement,
    fixRequirement: state.canFixRequirement ? fixRequirement : undefined,
  };
}
