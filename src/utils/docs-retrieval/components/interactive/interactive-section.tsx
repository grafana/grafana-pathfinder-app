import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Button } from '@grafana/ui';

import { useInteractiveElements } from '../../../interactive.hook';
import { useStepChecker } from '../../../step-checker.hook';
import { InteractiveStep } from './interactive-step';
import { InteractiveMultiStep } from './interactive-multi-step';

// Shared type definitions
export interface BaseInteractiveProps {
  requirements?: string;
  objectives?: string;
  hints?: string;
  onComplete?: () => void;
  disabled?: boolean;
  className?: string;
}

export interface InteractiveStepProps extends BaseInteractiveProps {
  targetAction: 'button' | 'highlight' | 'formfill' | 'navigate' | 'sequence';
  refTarget: string;
  targetValue?: string;
  title?: string;
  description?: string;
  children?: React.ReactNode;
  
  // New unified state management props (added by parent)
  stepId?: string;
  isEligibleForChecking?: boolean;
  isCompleted?: boolean;
  isCurrentlyExecuting?: boolean;
  onStepComplete?: (stepId: string) => void;
}

export interface InteractiveSectionProps extends BaseInteractiveProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  isSequence?: boolean;
}

// Types for unified state management
export interface StepInfo {
  stepId: string;
  element: React.ReactElement<InteractiveStepProps> | React.ReactElement<any>;
  index: number;
  targetAction?: string; // Optional for multi-step
  refTarget?: string; // Optional for multi-step
  targetValue?: string;
  requirements?: string;
  isMultiStep: boolean; // Flag to identify component type
}

// Simple counter for sequential section IDs
let interactiveSectionCounter = 0;

// Function to reset counters (can be called when new content loads)
export function resetInteractiveCounters() {
  interactiveSectionCounter = 0;
}

export function InteractiveSection({
  title,
  description,
  children,
  isSequence = false,
  requirements,
  objectives,
  hints,
  onComplete,
  disabled = false,
  className,
}: InteractiveSectionProps) {
  // Generate simple sequential section ID
  const sectionId = useMemo(() => {
    interactiveSectionCounter++;
    return `section-${interactiveSectionCounter}`;
  }, []);

  // Sequential state management
  const [completedSteps, setCompletedSteps] = useState(new Set<string>());
  const [currentlyExecutingStep, setCurrentlyExecutingStep] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  // Get the interactive functions from the hook
  const { executeInteractiveAction } = useInteractiveElements();

  // Extract step information from children first (needed for completion calculation)
  const stepComponents = useMemo((): StepInfo[] => {
    const steps: StepInfo[] = [];
    
    React.Children.forEach(children, (child, index) => {
      if (React.isValidElement(child) && 
          (child as any).type === InteractiveStep) {
        const props = child.props as InteractiveStepProps;
        const stepId = `${sectionId}-step-${index + 1}`;
        
        steps.push({
          stepId,
          element: child as React.ReactElement<InteractiveStepProps>,
          index,
          targetAction: props.targetAction,
          refTarget: props.refTarget,
          targetValue: props.targetValue,
          requirements: props.requirements,
          isMultiStep: false,
        });
      } else if (React.isValidElement(child) && 
                 (child as any).type === InteractiveMultiStep) {
        const props = child.props as any; // InteractiveMultiStepProps
        const stepId = `${sectionId}-multistep-${index + 1}`;
        
        steps.push({
          stepId,
          element: child as React.ReactElement<any>,
          index,
          targetAction: undefined, // Multi-step handles internally
          refTarget: undefined,
          targetValue: undefined,
          requirements: props.requirements,
          isMultiStep: true,
        });
      }
    });
    
    return steps;
  }, [children, sectionId]);

  if (objectives) {
    console.log("🔍 [DEBUG] InteractiveSection: " + sectionId + " objectives", objectives);
  }
  
  // Calculate base completion (steps completed) - needed for completion logic
  const stepsCompleted = stepComponents.length > 0 && completedSteps.size >= stepComponents.length;
  
  // Add objectives checking for section - disable if steps are already completed
  const objectivesChecker = useStepChecker({
    objectives,
    stepId: sectionId,
    isEligibleForChecking: !stepsCompleted // Stop checking once steps are done
  });
  
  // UNIFIED completion calculation - objectives always win (clarification 1, 2)
  const isCompleted = (objectivesChecker.completionReason === 'objectives') || stepsCompleted;

  // When section objectives are met, mark all child steps as complete (clarification 2, 16)
  useEffect(() => {
    if (objectivesChecker.completionReason === 'objectives' && stepComponents.length > 0) {
      const allStepIds = new Set(stepComponents.map(step => step.stepId));

      if (completedSteps && completedSteps.size !== allStepIds.size) {
        setCompletedSteps(allStepIds);
        console.log(`✅ Section objectives met for ${sectionId}, marking all ${allStepIds.size} child steps as complete`);
      }
    }
  }, [objectivesChecker, stepComponents, sectionId, completedSteps]);

  // Calculate which step is eligible for checking (sequential logic)
  const getStepEligibility = useCallback((stepIndex: number) => {
    // First step is always eligible (Trust but Verify)
    if (stepIndex === 0) {return true;}
    
    // Subsequent steps are eligible if all previous steps are completed
    for (let i = 0; i < stepIndex; i++) {
      const prevStepId = stepComponents[i].stepId;
      if (!completedSteps.has(prevStepId)) {
        return false;
      }
    }
    return true;
  }, [completedSteps, stepComponents]);

  // Handle individual step completion
  const handleStepComplete = useCallback((stepId: string) => {
    console.log(`🎯 Step completed: ${stepId}`);
    setCompletedSteps(prev => new Set([...prev, stepId]));
    setCurrentlyExecutingStep(null);
    
    // Check if all steps are completed
    if (completedSteps.size + 1 >= stepComponents.length) {
      console.log(`🏁 Section completed: ${sectionId}`);
      onComplete?.();
    }
  }, [completedSteps.size, stepComponents.length, sectionId, onComplete]);

  // Execute a single step (shared between individual and sequence execution)
  const executeStep = useCallback(async (stepInfo: StepInfo): Promise<boolean> => {
    // For multi-step components, skip execution here - they handle their own execution
    if (stepInfo.isMultiStep) {
      console.log(`🔄 Skipping section-level execution for multi-step: ${stepInfo.stepId} (handled internally)`);
      return true; // Multi-step components handle their own execution
    }
    
    console.log(`🚀 Executing step: ${stepInfo.stepId} (${stepInfo.targetAction}: ${stepInfo.refTarget})`);
    
    try {
      // Execute the action using existing interactive logic
      await executeInteractiveAction(
        stepInfo.targetAction!,
        stepInfo.refTarget!,
        stepInfo.targetValue,
        'do'
      );
      
      return true;
    } catch (error) {
      console.error(`❌ Step execution failed: ${stepInfo.stepId}`, error);
      return false;
    }
  }, [executeInteractiveAction]);

  // Handle sequence execution (do section)
  const handleDoSection = useCallback(async () => {
    if (disabled || isRunning || stepComponents.length === 0) {
      return;
    }

    console.log(`🚀 Starting section sequence: ${sectionId} (${stepComponents.length} steps)`);
    setIsRunning(true);
    
    // Reset completion state for re-runs
    setCompletedSteps(new Set());

    try {
      for (let i = 0; i < stepComponents.length; i++) {
        const stepInfo = stepComponents[i];
        setCurrentlyExecutingStep(stepInfo.stepId);

        // First, show the step (highlight it) - skip for multi-step components
        if (!stepInfo.isMultiStep) {
          console.log(`👁️ Showing step: ${stepInfo.stepId}`);
          await executeInteractiveAction(
            stepInfo.targetAction!,
            stepInfo.refTarget!,
            stepInfo.targetValue,
            'show'
          );

          // Wait for highlight to be visible
          await new Promise(resolve => setTimeout(resolve, 1500));
        }

        // Then, execute the step
        const success = await executeStep(stepInfo);
        
        if (success) {
          // Mark step as completed
          handleStepComplete(stepInfo.stepId);
          
          // Wait between steps for visual feedback
          if (i < stepComponents.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } else {
          console.warn(`⚠️ Breaking section sequence at step ${i + 1} due to execution failure`);
          break;
        }
      }

      console.log(`🏁 Section sequence completed: ${sectionId}`);
    } catch (error) {
      console.error('Error running section sequence:', error);
    } finally {
      setIsRunning(false);
      setCurrentlyExecutingStep(null);
    }
  }, [disabled, isRunning, stepComponents, sectionId, executeStep, executeInteractiveAction, handleStepComplete]);

  // Render enhanced children with coordination props
  const enhancedChildren = useMemo(() => {
    return React.Children.map(children, (child, index) => {
      if (React.isValidElement(child) && 
          (child as any).type === InteractiveStep) {
        const stepInfo = stepComponents[index];
        if (!stepInfo) {return child;}
        
        const isEligibleForChecking = getStepEligibility(index);
        const isCompleted = completedSteps.has(stepInfo.stepId);
        const isCurrentlyExecuting = currentlyExecutingStep === stepInfo.stepId;
        
        return React.cloneElement(child as React.ReactElement<InteractiveStepProps>, {
          ...child.props,
          stepId: stepInfo.stepId,
          isEligibleForChecking,
          isCompleted,
          isCurrentlyExecuting,
          onStepComplete: handleStepComplete,
          disabled: disabled || isRunning,
          key: stepInfo.stepId,
        });
      } else if (React.isValidElement(child) && 
                 (child as any).type === InteractiveMultiStep) {
        const stepInfo = stepComponents[index];
        if (!stepInfo) {return child;}
        
        const isEligibleForChecking = getStepEligibility(index);
        const isCompleted = completedSteps.has(stepInfo.stepId);
        const isCurrentlyExecuting = currentlyExecutingStep === stepInfo.stepId;
        
        return React.cloneElement(child as React.ReactElement<any>, {
          ...(child.props as any),
          stepId: stepInfo.stepId,
          isEligibleForChecking,
          isCompleted,
          isCurrentlyExecuting,
          onStepComplete: handleStepComplete,
          disabled: disabled || isRunning,
          key: stepInfo.stepId,
        });
      }
      return child;
    });
  }, [children, stepComponents, getStepEligibility, completedSteps, currentlyExecutingStep, handleStepComplete, disabled, isRunning]);

  return (
    <div className={`interactive-section${className ? ` ${className}` : ''}${isCompleted ? ' completed' : ''}`}>
      <div className="interactive-section-header">
        <div className="interactive-section-title-container">
          <span className="interactive-section-title">{title}</span>
          {isCompleted && <span className="interactive-section-checkmark">✓</span>}
          {isRunning && <span className="interactive-section-spinner">⟳</span>}
        </div>
        {hints && (
          <span className="interactive-section-hint" title={hints}>
            ⓘ
          </span>
        )}
      </div>
      
      {description && (
        <div className="interactive-section-description">{description}</div>
      )}
      
      <div className="interactive-section-content">
        {enhancedChildren}
      </div>
      
      <div className="interactive-section-actions">
        <Button
          onClick={handleDoSection}
          disabled={disabled || isRunning || stepComponents.length === 0 || objectivesChecker.completionReason === 'objectives'}
          size="md"
          variant={isCompleted ? "secondary" : "primary"}
          className="interactive-section-do-button"
          title={
            objectivesChecker.completionReason === 'objectives' ? 'Already done!' :
            isCompleted ? 'Run the section again' :
            isRunning ? `Running Step ${currentlyExecutingStep ? stepComponents.findIndex(s => s.stepId === currentlyExecutingStep) + 1 : '?'}/${stepComponents.length}...` :
            hints || `Run through all ${stepComponents.length} steps in sequence`
          }
        >
          {objectivesChecker.completionReason === 'objectives' ? 'Already done!' :
           isCompleted ? `Redo Section (${stepComponents.length} steps)` :
           isRunning ? `Running Step ${currentlyExecutingStep ? stepComponents.findIndex(s => s.stepId === currentlyExecutingStep) + 1 : '?'}/${stepComponents.length}...` : 
           `Do Section (${stepComponents.length} steps)`}
        </Button>
      </div>
    </div>
  );
} 
