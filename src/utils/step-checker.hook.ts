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

export interface UseStepCheckerProps {
  requirements?: string;
  objectives?: string;
  hints?: string;
  stepId: string;
  isEligibleForChecking: boolean;
}

export interface UseStepCheckerReturn {
  // Unified state
  isEnabled: boolean;
  isCompleted: boolean;
  isChecking: boolean;

  // Diagnostics
  completionReason: 'none' | 'objectives' | 'manual';
  explanation?: string;
  error?: string;
  canFixRequirement?: boolean; // Whether the requirement can be automatically fixed

  // Actions
  checkStep: () => Promise<void>;
  markCompleted: () => void;
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
  isEligibleForChecking = true,
}: UseStepCheckerProps): UseStepCheckerReturn {
  const [state, setState] = useState({
    isEnabled: false,
    isCompleted: false,
    isChecking: false,
    completionReason: 'none' as 'none' | 'objectives' | 'manual',
    explanation: undefined as string | undefined,
    error: undefined as string | undefined,
  });

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

  // Check if this step has navigation requirements that can be fixed
  const canFixRequirement = requirements?.includes('navmenu-open') || false;

  /**
   * Check conditions (requirements or objectives) using proper DOM check functions
   */
  const checkConditions = useCallback(
    async (conditions: string, type: 'requirements' | 'objectives') => {
      try {
        // Create proper InteractiveElementData structure
        const actionData = {
          requirements: conditions,
          targetaction: 'button' as const,
          reftarget: stepId,
          textContent: stepId,
          tagName: 'div' as const,
          objectives: type === 'objectives' ? conditions : undefined,
        };

        // Add timeout to prevent hanging (same as original hooks)
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`${type} check timeout`)), 5000);
        });

        const result = await Promise.race([checkRequirementsFromData(actionData), timeoutPromise]);

        // For objectives: ALL must be met (AND logic as per specification)
        // For requirements: ALL must be met (same logic)
        const conditionsMet = result.pass;
        const errorMessage = conditionsMet
          ? undefined
          : result.error?.map((e: any) => e.error || e.requirement).join(', ');

        return { pass: conditionsMet, error: errorMessage };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : `Failed to check ${type}`;
        return { pass: false, error: errorMessage };
      }
    },
    [stepId, checkRequirementsFromData]
  );

  /**
   * Core checking logic with proper priority:
   * 1. Objectives first (always win if met)
   * 2. Eligibility check (sequential dependencies)
   * 3. Requirements (only if objectives not met)
   */
  const checkStep = useCallback(async () => {
    setState((prev) => ({ ...prev, isChecking: true, error: undefined }));

    try {
      // STEP 1: Check objectives first (they always win)
      if (objectives && objectives.trim() !== '') {
        console.log(`🎯 [DEBUG] Checking objectives for ${stepId}: ${objectives}`);

        const objectivesResult = await checkConditions(objectives, 'objectives');
        if (objectivesResult.pass) {
          console.log(`✅ [DEBUG] Objectives met for ${stepId}, auto-completing`);
          const finalState = {
            isEnabled: true,
            isCompleted: true,
            isChecking: false,
            completionReason: 'objectives' as const,
            explanation: 'Already done!',
            error: undefined,
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
        // console.log(`⏭️ [DEBUG] Step ${stepId} not eligible due to sequential dependency`);
        const blockedState = {
          isEnabled: false,
          isCompleted: false,
          isChecking: false,
          completionReason: 'none' as const,
          explanation: 'Complete the previous steps in order before this one becomes available.',
          error: 'Sequential dependency not met',
        };
        setState(blockedState);
        updateManager(blockedState);
        return;
      }

      // STEP 3: Check requirements (only if objectives not met and eligible)
      if (requirements && requirements.trim() !== '') {
        console.warn(`🔍 [DEBUG] Checking requirements for ${stepId}: ${requirements}`);

        const requirementsResult = await checkConditions(requirements, 'requirements');
        console.warn(`📋 [DEBUG] Requirements result for ${stepId}:`, {
          pass: requirementsResult.pass,
          error: requirementsResult.error,
          requirements,
        });

        const explanation = requirementsResult.pass
          ? undefined
          : getRequirementExplanation(requirements, hints, requirementsResult.error);

        const requirementsState = {
          isEnabled: requirementsResult.pass,
          isCompleted: false, // Requirements enable, don't auto-complete
          isChecking: false,
          completionReason: 'none' as const,
          explanation,
          error: requirementsResult.pass ? undefined : requirementsResult.error,
        };

        console.warn(`🎯 [DEBUG] Setting requirements state for ${stepId}:`, requirementsState);
        setState(requirementsState);
        updateManager(requirementsState);
        return;
      }

      // STEP 4: No conditions - always enabled
      const enabledState = {
        isEnabled: true,
        isCompleted: false,
        isChecking: false,
        completionReason: 'none' as const,
        explanation: undefined,
        error: undefined,
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
        completionReason: 'none' as const,
        explanation: getRequirementExplanation(requirements || objectives, hints, errorMessage),
        error: errorMessage,
      };
      setState(errorState);
      updateManager(errorState);
    }
  }, [objectives, requirements, hints, stepId, isEligibleForChecking, updateManager, checkConditions]);

  /**
   * Fix navigation requirements by opening and docking the menu
   */
  const fixRequirement = useCallback(async () => {
    if (!canFixRequirement || !fixNavigationRequirements) {
      return;
    }

    try {
      setState((prev) => ({ ...prev, isChecking: true }));

      // Use the fix function from the interactive hook
      await fixNavigationRequirements();

      // After fixing, recheck the requirements
      await new Promise((resolve) => setTimeout(resolve, 100)); // Small delay for UI to update

      // Trigger a requirements check to see if the fix worked
      await checkStep();
    } catch (error) {
      console.error('Failed to fix navigation requirements:', error);
      setState((prev) => ({
        ...prev,
        isChecking: false,
        error: 'Failed to fix navigation requirements',
      }));
    }
  }, [canFixRequirement, fixNavigationRequirements, checkStep]);

  /**
   * Manual completion (for user-executed steps)
   */
  const markCompleted = useCallback(() => {
    console.log(`🎯 [DEBUG] Manually marking ${stepId} as completed`);
    const completedState = {
      ...state,
      isCompleted: true,
      isEnabled: false, // Completed steps are disabled
      completionReason: 'manual' as const,
      explanation: 'Completed',
    };
    setState(completedState);
    updateManager(completedState);
  }, [stepId, state, updateManager]);

  // Auto-check when eligibility or conditions change
  useEffect(() => {
    // Skip checking if already completed (prevent redundant checks)
    if (!state.isCompleted) {
      checkStep();
    }
  }, [checkStep, state.isCompleted]);

  // Register with manager for reactive re-checking
  useEffect(() => {
    if (managerRef.current) {
      const unregisterChecker = managerRef.current.registerStepCheckerByID(stepId, () => {
        if (!state.isCompleted) {
          checkStep();
        }
      });

      return () => {
        unregisterChecker();
      };
    }
    return undefined;
  }, [stepId, checkStep, state.isCompleted]);

  // Listen for section completion events (for section dependencies)
  useEffect(() => {
    const handleSectionCompletion = () => {
      if (!state.isCompleted && requirements?.includes('section-completed:')) {
        checkStep();
      }
    };

    document.addEventListener('section-completed', handleSectionCompletion);
    return () => {
      document.removeEventListener('section-completed', handleSectionCompletion);
    };
  }, [checkStep, state.isCompleted, requirements]);

  return {
    ...state,
    checkStep,
    markCompleted,
    canFixRequirement,
    fixRequirement: canFixRequirement ? fixRequirement : undefined,
  };
}
