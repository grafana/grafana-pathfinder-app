import React, { useState, useCallback, forwardRef, useImperativeHandle, useEffect } from 'react';
import { Button } from '@grafana/ui';

import { useInteractiveElements } from '../../../interactive.hook';
import { useStepChecker } from '../../../step-checker.hook';
import type { InteractiveStepProps } from './interactive-section';

export const InteractiveStep = forwardRef<
  { executeStep: () => Promise<boolean> },
  InteractiveStepProps
>(({
  targetAction,
  refTarget,
  targetValue,
  title,
  description,
  children,
  requirements,
  objectives,
  hints,
  onComplete,
  disabled = false,
  className,
  // New unified state management props (passed by parent)
  stepId,
  isEligibleForChecking = true,
  isCompleted: parentCompleted = false,
  isCurrentlyExecuting = false,
  onStepComplete,
  resetTrigger,
}, ref) => {
  // Local UI state
  const [isLocallyCompleted, setIsLocallyCompleted] = useState(false);
  const [isShowRunning, setIsShowRunning] = useState(false);
  const [isDoRunning, setIsDoRunning] = useState(false);
  
  // Handle reset trigger from parent section
  useEffect(() => {
    if (resetTrigger && resetTrigger > 0) {
      console.log(`🔄 Resetting step local completion: ${stepId}`);
      setIsLocallyCompleted(false);
    }
  }, [resetTrigger, stepId]);
  
  // Combined completion state (parent takes precedence for coordination)
  const isCompleted = parentCompleted || isLocallyCompleted;
  
  // Get the interactive functions from the hook
  const { executeInteractiveAction } = useInteractiveElements();
  
  // Use the new step requirements hook with parent coordination
  const checker = useStepChecker({
    requirements,
    hints,
    stepId: stepId || `step-${Date.now()}`, // Fallback if no stepId provided
    isEligibleForChecking: isEligibleForChecking && !isCompleted
  });
  
  // Combined completion state: objectives always win (clarification 1, 2)
  const isCompletedWithObjectives = parentCompleted || isLocallyCompleted || (checker.completionReason === 'objectives');
  
  // Execution logic (shared between individual and sequence execution)
  const executeStep = useCallback(async (): Promise<boolean> => {
    if (!checker.isEnabled || isCompletedWithObjectives || disabled) {
      console.warn(`⚠️ Step execution blocked: ${stepId}`, {
        enabled: checker.isEnabled,
        completed: isCompletedWithObjectives,
        disabled
      });
      return false;
    }
    
    try {
      console.log(`🚀 Executing step: ${stepId} (${targetAction}: ${refTarget})`);
      
      // Execute the action using existing interactive logic
      await executeInteractiveAction(targetAction, refTarget, targetValue, 'do');
      
      // Mark as completed locally and notify parent
      setIsLocallyCompleted(true);
      
      // Notify parent if we have the callback (section coordination)
      if (onStepComplete && stepId) {
        onStepComplete(stepId);
      }
      
      // Call the original onComplete callback if provided
      if (onComplete) {
        onComplete();
      }
      
      console.log(`✅ Step completed: ${stepId}`);
      return true;
    } catch (error) {
      console.error(`❌ Step execution failed: ${stepId}`, error);
      return false;
    }
  }, [
    checker.isEnabled,
    isCompletedWithObjectives,
    disabled,
    stepId,
    targetAction,
    refTarget,
    targetValue,
    executeInteractiveAction,
    onStepComplete,
    onComplete
  ]);
  
  // Expose execute method for parent (sequence execution)
  useImperativeHandle(ref, () => ({
    executeStep
  }), [executeStep]);
  
  // Handle individual "Show me" action
  const handleShowAction = useCallback(async () => {
    if (disabled || isShowRunning || isCompletedWithObjectives || !checker.isEnabled) {
      return;
    }
    
    setIsShowRunning(true);
    try {
      await executeInteractiveAction(targetAction, refTarget, targetValue, 'show');
    } catch (error) {
      console.error('Interactive show action failed:', error);
    } finally {
      setIsShowRunning(false);
    }
  }, [targetAction, refTarget, targetValue, disabled, isShowRunning, isCompletedWithObjectives, checker.isEnabled, executeInteractiveAction]);
  
  // Handle individual "Do it" action (delegates to executeStep)
  const handleDoAction = useCallback(async () => {
    if (disabled || isDoRunning || isCompletedWithObjectives || !checker.isEnabled) {
      return;
    }
    
    setIsDoRunning(true);
    try {
      await executeStep();
    } catch (error) {
      console.error('Interactive do action failed:', error);
    } finally {
      setIsDoRunning(false);
    }
  }, [disabled, isDoRunning, isCompletedWithObjectives, checker.isEnabled, executeStep]);
  
  const getActionDescription = () => {
    switch (targetAction) {
      case 'button': return `Click "${refTarget}"`;
      case 'highlight': return `Highlight element`;
      case 'formfill': return `Fill form with "${targetValue || 'value'}"`;
      case 'navigate': return `Navigate to ${refTarget}`;
      case 'sequence': return `Run sequence`;
      default: return targetAction;
    }
  };
  
  const isAnyActionRunning = isShowRunning || isDoRunning || isCurrentlyExecuting;
  
  return (
    <div className={`interactive-step${className ? ` ${className}` : ''}${isCompletedWithObjectives ? ' completed' : ''}${isCurrentlyExecuting ? ' executing' : ''}`}>
      <div className="interactive-step-content">
        {title && <div className="interactive-step-title">{title}</div>}
        {description && <div className="interactive-step-description">{description}</div>}
        {children}
      </div>
      
      <div className="interactive-step-actions">
        <div className="interactive-step-action-buttons">
          <Button
            onClick={handleShowAction}
            disabled={disabled || isCompletedWithObjectives || isAnyActionRunning || (!checker.isEnabled && checker.completionReason !== 'objectives')}
            size="sm"
            variant="secondary"
            className="interactive-step-show-btn"
            title={
              checker.completionReason === 'objectives' ? 'Already done!' :
              checker.isChecking ? 'Checking requirements...' :
              hints || `Show me: ${getActionDescription()}`
            }
          >
            {checker.completionReason === 'objectives' ? 'Already done!' :
             checker.isChecking ? 'Checking...' :
             isShowRunning ? 'Showing...' : 
             !checker.isEnabled && !isCompletedWithObjectives ? 'Requirements not met' :
             'Show me'}
          </Button>
          
          { 
            // Only show the do it button if the step is eligible or already completed.
            // Objectives always win over requirements (clarification 2)
            (checker.isEnabled || isCompletedWithObjectives || checker.completionReason === 'objectives') && (
              <Button
              onClick={handleDoAction}
              disabled={disabled || isCompletedWithObjectives || isAnyActionRunning || (!checker.isEnabled && checker.completionReason !== 'objectives')}
              size="sm"
              variant="primary"
              className="interactive-step-do-btn"
              title={
                checker.completionReason === 'objectives' ? 'Already done!' :
                checker.isChecking ? 'Checking requirements...' :
                hints || `Do it: ${getActionDescription()}`
              }
            >
              {checker.completionReason === 'objectives' ? 'Already done!' :
              checker.isChecking ? 'Checking...' :
              isCompletedWithObjectives ? '✓ Completed' : 
              isDoRunning || isCurrentlyExecuting ? 'Executing...' : 
              'Do it'}
            </Button>
          )}
        </div>
        
        {isCompletedWithObjectives && <span className="interactive-step-completed-indicator">✓</span>}
      </div>
      
      {/* Show explanation text when requirements aren't met, but objectives always win (clarification 2) */}
      {checker.completionReason !== 'objectives' && !checker.isEnabled && !isCompletedWithObjectives && !checker.isChecking && checker.explanation && (
        <div className="interactive-step-requirement-explanation" style={{ 
          color: '#ff8c00', 
          fontSize: '0.875rem', 
          marginTop: '8px',
          fontStyle: 'italic',
          lineHeight: '1.4',
          paddingLeft: '12px'
        }}>
          {checker.explanation}
          <button
            onClick={() => {
              checker.checkStep();
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
    </div>
  );
});

// Add display name for debugging
InteractiveStep.displayName = 'InteractiveStep'; 
