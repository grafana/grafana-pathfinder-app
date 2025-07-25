import { useState, useCallback, useEffect } from 'react';
import { useInteractiveElements } from './interactive.hook';
import { getRequirementExplanation } from './requirement-explanations';

interface UseStepRequirementsProps {
  requirements?: string;
  hints?: string;
  stepId: string;
  isEligibleForChecking: boolean; // Passed by parent based on sequential logic
}

interface StepRequirementsState {
  isEnabled: boolean;
  explanation: string;
  isChecking: boolean;
  error?: string;
}

interface UseStepRequirementsReturn extends StepRequirementsState {
  checkRequirements: () => Promise<void>;
}

/**
 * Hook for requirements checking logic that can be reused across components
 * Handles the requirements checking but delegates sequential logic to parent
 */
export function useStepRequirements({
  requirements,
  hints,
  stepId,
  isEligibleForChecking
}: UseStepRequirementsProps): UseStepRequirementsReturn {
  const [state, setState] = useState<StepRequirementsState>({
    isEnabled: false,
    explanation: '',
    isChecking: false,
  });
  
  const { checkElementRequirements } = useInteractiveElements();
  
  const checkRequirements = useCallback(async () => {
    // If not eligible for checking due to sequential dependencies
    if (!isEligibleForChecking) {
      setState({
        isEnabled: false,
        explanation: 'Complete the previous steps in order before this one becomes available.',
        isChecking: false,
        error: 'Sequential dependency not met'
      });
      return;
    }
    
    // If no requirements, step is enabled
    if (!requirements) {
      setState({
        isEnabled: true,
        explanation: '',
        isChecking: false,
      });
      return;
    }
    
    setState(prev => ({ ...prev, isChecking: true }));
    
    try {
      // Create mock element for requirements checking (reusing existing logic)
      const mockElement = document.createElement('div');
      mockElement.setAttribute('data-requirements', requirements);
      mockElement.setAttribute('data-targetaction', 'button');
      mockElement.setAttribute('data-reftarget', stepId);
      
      // Add timeout to prevent hanging  
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Requirements check timeout')), 5000);
      });
      
      const result = await Promise.race([
        checkElementRequirements(mockElement),
        timeoutPromise
      ]);
      
      const errorMessage = result.pass ? undefined : result.error?.map((e: any) => e.error || e.requirement).join(', ');
      const explanation = result.pass ? '' : getRequirementExplanation(requirements, hints, errorMessage);
      
      setState({
        isEnabled: result.pass,
        explanation,
        isChecking: false,
        error: errorMessage,
      });
    } catch (error) {
      console.error(`Requirements check failed for ${stepId}:`, error);
      const errorMessage = 'Failed to check requirements';
      const explanation = getRequirementExplanation(requirements, hints, errorMessage);
      
      setState({
        isEnabled: false,
        explanation,
        isChecking: false,
        error: errorMessage,
      });
    }
  }, [requirements, hints, stepId, isEligibleForChecking, checkElementRequirements]);
  
  // Auto-check requirements when eligibility changes
  useEffect(() => {
    checkRequirements();
  }, [checkRequirements]);
  
  return {
    ...state,
    checkRequirements,
  };
} 