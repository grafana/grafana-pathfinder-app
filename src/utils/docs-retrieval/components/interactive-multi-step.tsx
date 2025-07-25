import React, { useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Button } from '@grafana/ui';
import { useInteractiveElements } from '../../interactive.hook';
import { useStepRequirements } from '../../step-requirements.hook';
import { getRequirementExplanation } from '../../requirement-explanations';

// Types for internal actions extracted from HTML
interface InternalAction {
  requirements?: string;
  targetAction: string;
  refTarget: string;
  targetValue?: string;
}

interface InteractiveMultiStepProps {
  internalActions: InternalAction[];
  
  // Standard InteractiveStep props for parent coordination
  stepId?: string;
  isEligibleForChecking?: boolean;
  isCompleted?: boolean;
  isCurrentlyExecuting?: boolean;
  onStepComplete?: (stepId: string) => void;
  
  // Content and styling
  title?: string; // Add title prop like InteractiveStep
  children?: React.ReactNode;
  className?: string;
  disabled?: boolean;
  hints?: string;
  requirements?: string; // Overall requirements for the multi-step
  onComplete?: () => void;
}

/**
 * Just-in-time requirements checker for individual actions within a multi-step
 * Similar to useStepRequirements but designed for dynamic checking during execution
 * 
 * NOTE: This follows the same pattern as useStepRequirements but is simplified for
 * one-time checks without state management. If requirements checking logic becomes
 * more complex, consider refactoring both to share a common base function.
 */
async function checkActionRequirements(
  action: InternalAction, 
  actionIndex: number,
  checkElementRequirements: (element: HTMLElement) => Promise<any>
): Promise<{ pass: boolean; explanation?: string }> {
  
  if (!action.requirements) {
    return { pass: true };
  }
  
  try {
    // Create mock element for requirements checking (same pattern as useStepRequirements)
    const mockElement = document.createElement('div');
    mockElement.setAttribute('data-requirements', action.requirements);
    mockElement.setAttribute('data-targetaction', action.targetAction);
    mockElement.setAttribute('data-reftarget', action.refTarget);
    if (action.targetValue) {
      mockElement.setAttribute('data-targetvalue', action.targetValue);
    }
    
    // Check requirements with timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Requirements check timeout')), 5000);
    });
    
    const result = await Promise.race([
      checkElementRequirements(mockElement),
      timeoutPromise
    ]);
    
    if (result.pass) {
      return { pass: true };
    }
    
    // Generate user-friendly explanation
    const errorMessage = result.error?.map((e: any) => e.error || e.requirement).join(', ');
    const explanation = getRequirementExplanation(action.requirements, undefined, errorMessage);
    
    return { 
      pass: false, 
      explanation: `Step ${actionIndex + 1} requirements not met: ${explanation}`
    };
    
  } catch (error) {
    console.error(`Requirements check failed for action ${actionIndex + 1}:`, error);
    return { 
      pass: false, 
      explanation: `Step ${actionIndex + 1}: Failed to check requirements`
    };
  }
}

export const InteractiveMultiStep = forwardRef<
  { executeStep: () => Promise<boolean> },
  InteractiveMultiStepProps
>(({
  internalActions,
  stepId,
  isEligibleForChecking = true,
  isCompleted: parentCompleted = false,
  isCurrentlyExecuting = false,
  onStepComplete,
  title, // Add title prop
  children,
  className,
  disabled = false,
  hints,
  requirements,
  onComplete,
}, ref) => {
  // Local UI state (similar to InteractiveStep)
  const [isLocallyCompleted, setIsLocallyCompleted] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [currentActionIndex, setCurrentActionIndex] = useState(-1);
  const [executionError, setExecutionError] = useState<string | null>(null);
  
  // Combined completion state (parent takes precedence for coordination)
  const isCompleted = parentCompleted || isLocallyCompleted;
  
  // Get the interactive functions from the hook
  const { executeInteractiveAction, checkElementRequirements } = useInteractiveElements();
  
  // Use step requirements hook for overall multi-step requirements (like any other step)
  const requirementsChecker = useStepRequirements({
    requirements,
    hints,
    stepId: stepId || `multistep-${Date.now()}`,
    isEligibleForChecking: isEligibleForChecking && !isCompleted
  });
  
  // Main execution logic (similar to InteractiveSection's sequence execution)
  const executeStep = useCallback(async (): Promise<boolean> => {
    if (!requirementsChecker.isEnabled || isCompleted || disabled || isExecuting) {
      console.warn(`⚠️ Multi-step execution blocked: ${stepId}`, {
        enabled: requirementsChecker.isEnabled,
        completed: isCompleted,
        disabled,
        executing: isExecuting
      });
      return false;
    }
    
    console.log(`🚀 Starting multi-step execution: ${stepId} (${internalActions.length} actions)`);
    setIsExecuting(true);
    setExecutionError(null);
    setCurrentActionIndex(-1);
    
    try {
      // Execute each internal action in sequence (same pattern as InteractiveSection)
      for (let i = 0; i < internalActions.length; i++) {
        const action = internalActions[i];
        setCurrentActionIndex(i);
        
        console.log(`🔍 Checking requirements for action ${i + 1}/${internalActions.length}`);
        
        // Just-in-time requirements check for this specific action
        const requirementsCheck = await checkActionRequirements(action, i, checkElementRequirements);
        if (!requirementsCheck.pass) {
          const errorMsg = requirementsCheck.explanation || `Step ${i + 1} requirements not met`;
          console.error(`❌ Multi-step stopped at action ${i + 1}: ${errorMsg}`);
          setExecutionError(errorMsg);
          return false;
        }
        
        // Show the action (highlight)
        console.log(`👁️ Showing action ${i + 1}: ${action.targetAction} → ${action.refTarget}`);
        await executeInteractiveAction(
          action.targetAction,
          action.refTarget,
          action.targetValue,
          'show'
        );
        
        // Wait for highlight to be visible
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Execute the action
        console.log(`🎯 Executing action ${i + 1}: ${action.targetAction} → ${action.refTarget}`);
        await executeInteractiveAction(
          action.targetAction,
          action.refTarget,
          action.targetValue,
          'do'
        );
        
        // Wait between actions for visual feedback
        if (i < internalActions.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      // All actions completed successfully
      console.log(`✅ Multi-step completed successfully: ${stepId}`);
      setIsLocallyCompleted(true);
      
      // Notify parent if we have the callback (section coordination)
      if (onStepComplete && stepId) {
        onStepComplete(stepId);
      }
      
      // Call the original onComplete callback if provided
      if (onComplete) {
        onComplete();
      }
      
      return true;
      
    } catch (error) {
      const errorMsg = `Execution failed at step ${currentActionIndex + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(`❌ Multi-step execution failed: ${stepId}`, error);
      setExecutionError(errorMsg);
      return false;
      
    } finally {
      setIsExecuting(false);
      setCurrentActionIndex(-1);
    }
  }, [
    requirementsChecker.isEnabled,
    isCompleted,
    disabled,
    isExecuting,
    stepId,
    internalActions,
    currentActionIndex,
    checkElementRequirements,
    executeInteractiveAction,
    onStepComplete,
    onComplete
  ]);
  
  // Expose execute method for parent (sequence execution)
  useImperativeHandle(ref, () => ({
    executeStep
  }), [executeStep]);
  
  // Handle "Do it" button click
  const handleDoAction = useCallback(async () => {
    if (disabled || isExecuting || isCompleted || !requirementsChecker.isEnabled) {
      return;
    }
    
    await executeStep();
  }, [disabled, isExecuting, isCompleted, requirementsChecker.isEnabled, executeStep]);
  
  const isAnyActionRunning = isExecuting || isCurrentlyExecuting;
  
  // Generate button text based on current state
  const getButtonText = () => {
    if (requirementsChecker.isChecking) {
      return 'Checking...';
    }
    if (isCompleted) {
      return '✓ Completed';
    }
    if (isExecuting) {
      return `Executing ${currentActionIndex + 1}/${internalActions.length}...`;
    }
    if (executionError) {
      return executionError;
    }
    if (!requirementsChecker.isEnabled && !isCompleted) {
      return 'Requirements not met';
    }
    return 'Do it';
  };
  
  // Generate button title/tooltip
  const getButtonTitle = () => {
    if (requirementsChecker.isChecking) {
      return 'Checking requirements...';
    }
    if (executionError) {
      return executionError;
    }
    return hints || `Execute ${internalActions.length} steps in sequence`;
  };
  
  return (
    <div className={`interactive-step${className ? ` ${className}` : ''}${isCompleted ? ' completed' : ''}${isCurrentlyExecuting ? ' executing' : ''}`}>
      <div className="interactive-step-content">
        {title && <div className="interactive-step-title">{title}</div>}
        {children}
      </div>
      
      <div className="interactive-step-actions">
        <div className="interactive-step-action-buttons">
          {/* Only show "Do it" button when requirements are met OR step is completed */}
          {(requirementsChecker.isEnabled || isCompleted) && (
            <Button
              onClick={handleDoAction}
              disabled={disabled || isCompleted || isAnyActionRunning || (!requirementsChecker.isEnabled && !isCompleted)}
              size="sm"
              variant="primary"
              className="interactive-step-do-btn"
              title={getButtonTitle()}
            >
              {getButtonText()}
            </Button>
          )}
        </div>
        
        {isCompleted && <span className="interactive-step-completed-indicator">✓</span>}
      </div>
      
      {/* Show explanation text when requirements aren't met (same pattern as InteractiveStep) */}
      {!requirementsChecker.isEnabled && !isCompleted && !requirementsChecker.isChecking && requirementsChecker.explanation && (
        <div className="interactive-step-requirement-explanation" style={{ 
          color: '#ff8c00', 
          fontSize: '0.875rem', 
          marginTop: '8px',
          fontStyle: 'italic',
          lineHeight: '1.4',
          paddingLeft: '12px'
        }}>
          {requirementsChecker.explanation}
          <button
            onClick={() => {
              requirementsChecker.checkRequirements();
            }}
            style={{
              marginLeft: '8px',
              padding: '2px 8px',
              fontSize: '0.75rem',
              border: '1px solid #ff8c00',
              background: 'transparent',
              color: '#ff8c00',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Retry
          </button>
        </div>
      )}
      
      {/* Show execution error when available */}
      {executionError && !requirementsChecker.isChecking && (
        <div className="interactive-step-requirement-explanation" style={{ 
          color: '#dc3545', 
          fontSize: '0.875rem', 
          marginTop: '8px',
          fontStyle: 'italic',
          lineHeight: '1.4',
          paddingLeft: '12px'
        }}>
          {executionError}
          <button
            onClick={() => {
              setExecutionError(null);
              requirementsChecker.checkRequirements();
            }}
            style={{
              marginLeft: '8px',
              padding: '2px 8px',
              fontSize: '0.75rem',
              border: '1px solid #dc3545',
              background: 'transparent',
              color: '#dc3545',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
});

// Add display name for debugging
InteractiveMultiStep.displayName = 'InteractiveMultiStep'; 
