/**
 * Hook for checking tutorial-specific objectives for interactive elements
 * Reuses the requirements checking logic internally for consistency
 */

import { useState, useCallback, useEffect } from 'react';
import { useInteractiveElements } from './interactive.hook';

export interface UseStepObjectivesProps {
  objectives?: string;
  stepId: string;
  isEligibleForChecking: boolean;
}

export interface UseStepObjectivesReturn {
  isObjectiveMet: boolean;
  isChecking: boolean;
  error?: string;
  checkObjectives: () => Promise<void>;
}

export function useStepObjectives({
  objectives,
  stepId,
  isEligibleForChecking
}: UseStepObjectivesProps): UseStepObjectivesReturn {
  const [state, setState] = useState({
    isObjectiveMet: false,
    isChecking: false,
    error: undefined as string | undefined,
  });

  // Get the requirements checking function to reuse its logic
  const { checkElementRequirements } = useInteractiveElements();

  const checkObjectives = useCallback(async () => {
    // If no objectives defined, they are not met (as per clarification 0)
    if (!objectives || objectives.trim() === '') {
      setState({
        isObjectiveMet: false,
        isChecking: false,
        error: undefined,
      });
      return;
    }

    // Skip checking if not eligible (e.g., already completed)
    if (!isEligibleForChecking || state.isObjectiveMet) {
      return;
    }

    setState(prev => ({ ...prev, isChecking: true }));
    
    try {
      // Create mock element for objectives checking, reusing requirements logic
      const mockElement = document.createElement('div');
      mockElement.setAttribute('data-requirements', objectives); // Reuse requirements checking
      mockElement.setAttribute('data-targetaction', 'button');
      mockElement.setAttribute('data-reftarget', stepId);
      
      // Add timeout to prevent hanging (same as requirements checking)
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Objectives check timeout')), 5000);
      });
      
      console.log("🔍 [DEBUG] Checking objectives for", stepId, "with mock element", mockElement.outerHTML, ": " + objectives);
      const result = await Promise.race([
        checkElementRequirements(mockElement),
        timeoutPromise
      ]);
      
      console.log("🔍 [DEBUG] Result of objectives check for", stepId, ":", result);
      // For objectives: ALL must be met (AND logic as per clarification 3)
      const objectivesMet = result.pass;
      
      setState({
        isObjectiveMet: objectivesMet,
        isChecking: false,
        error: objectivesMet ? undefined : result.error?.map((e: any) => e.error || e.requirement).join(', '),
      });
    } catch (error) {
      // If objective check fails due to network/API error, objective is not met (clarification 11)
      console.error(`Objectives check failed for ${stepId}:`, error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to check objectives';
      
      setState({
        isObjectiveMet: false,
        isChecking: false,
        error: errorMessage,
      });
    }
  }, [objectives, stepId, isEligibleForChecking, checkElementRequirements, state.isObjectiveMet]);
  
  // Auto-check objectives when eligibility changes (same model as requirements checking - clarification 4)
  useEffect(() => {
    checkObjectives();
  }, [checkObjectives]);
  
  return {
    ...state,
    checkObjectives,
  };
} 
