import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
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
  onStepReset?: (stepId: string) => void; // Signal to parent that step should be reset
  resetTrigger?: number; // Signal from parent to reset local completion state
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
  const [currentStepIndex, setCurrentStepIndex] = useState(0); // Track next uncompleted step
  const [resetTrigger, setResetTrigger] = useState(0); // Trigger to reset child steps
  
  // Use ref for cancellation to avoid closure issues
  const isCancelledRef = useRef(false);
  
  // Store refs to multistep components for section-level execution
  const multiStepRefs = useRef<Map<string, { executeStep: () => Promise<boolean> }>>(new Map());

  // Get the interactive functions from the hook
  const { 
    executeInteractiveAction, 
    startSectionBlocking, 
    stopSectionBlocking 
  } = useInteractiveElements();
  
  // Create cancellation handler
  const handleSectionCancel = useCallback(() => {
    console.warn(`🛑 Section cancelled by user: ${sectionId}`);
    isCancelledRef.current = true; // Set ref for immediate access
    // The running loop will detect this and break
  }, [sectionId]);
  
  // Use executeInteractiveAction directly (no wrapper needed)
  // Section-level blocking is managed separately at the section level

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

  // if (objectives) {
  //   console.log("🔍 [DEBUG] InteractiveSection: " + sectionId + " objectives", objectives);
  // }
  
  // Calculate base completion (steps completed) - needed for completion logic
  const stepsCompleted = stepComponents.length > 0 && completedSteps.size >= stepComponents.length;
  
  // Add objectives checking for section - disable if steps are already completed
  const objectivesChecker = useStepChecker({
    objectives,
    stepId: sectionId,
    isEligibleForChecking: !stepsCompleted // Stop checking once steps are done
  });
  
  // UNIFIED completion calculation - objectives always win (clarification 1, 2)
  const isCompletedByObjectives = objectivesChecker.completionReason === 'objectives';
  const isCompleted = isCompletedByObjectives || stepsCompleted;

  // When section objectives are met, mark all child steps as complete (clarification 2, 16)
  useEffect(() => {
    if (isCompletedByObjectives && stepComponents.length > 0) {
      const allStepIds = new Set(stepComponents.map(step => step.stepId));

      if (completedSteps && completedSteps.size !== allStepIds.size) {
        setCompletedSteps(allStepIds);
        setCurrentStepIndex(stepComponents.length); // Mark as all completed
        console.log(`✅ Section objectives met for ${sectionId}, marking all ${allStepIds.size} child steps as complete`);
      }
    }
  }, [isCompletedByObjectives, stepComponents, sectionId, completedSteps]);

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

  // Calculate resume information for button display
  const getResumeInfo = useCallback(() => {
    if (stepComponents.length === 0) return { nextStepIndex: 0, remainingSteps: 0, isResume: false };
    
    // Use currentStepIndex directly - no iteration needed!
    const nextStepIndex = currentStepIndex;
    
    // If currentStepIndex is beyond the end, it means all steps are completed
    const allCompleted = nextStepIndex >= stepComponents.length;
    const remainingSteps = allCompleted ? stepComponents.length : stepComponents.length - nextStepIndex;
    const isResume = !allCompleted && nextStepIndex > 0;
    
    return { nextStepIndex, remainingSteps, isResume };
  }, [stepComponents.length, currentStepIndex]);

  // Handle individual step completion
  const handleStepComplete = useCallback((stepId: string) => {
    console.log(`🎯 Step completed: ${stepId}`);
    setCompletedSteps(prev => new Set([...prev, stepId]));
    setCurrentlyExecutingStep(null);
    
    // Advance currentStepIndex to the next uncompleted step
    const currentIndex = stepComponents.findIndex(step => step.stepId === stepId);
    if (currentIndex >= 0) {
      setCurrentStepIndex(currentIndex + 1);
      console.log(`📍 Next step index advanced to: ${currentIndex + 1}/${stepComponents.length}`);
    }
    
    // Check if all steps are completed
    if (completedSteps.size + 1 >= stepComponents.length) {
      console.log(`🏁 Section completed: ${sectionId}`);
      onComplete?.();
    }
  }, [completedSteps.size, stepComponents, sectionId, onComplete]);

  // Handle individual step reset (redo functionality)
  const handleStepReset = useCallback((stepId: string) => {
    console.log(`🔄 Step reset requested: ${stepId}`);
    setCompletedSteps(prev => {
      const newSet = new Set(prev);
      newSet.delete(stepId);
      return newSet;
    });
    
    // Move currentStepIndex back if we're resetting an earlier step
    const resetIndex = stepComponents.findIndex(step => step.stepId === stepId);
    if (resetIndex >= 0 && resetIndex < currentStepIndex) {
      setCurrentStepIndex(resetIndex);
      console.log(`📍 Step index moved back to: ${resetIndex}/${stepComponents.length}`);
    }
    
    // Also clear currently executing step if it matches
    if (currentlyExecutingStep === stepId) {
      setCurrentlyExecutingStep(null);
    }
  }, [currentlyExecutingStep, stepComponents, currentStepIndex]);

  // Execute a single step (shared between individual and sequence execution)
  const executeStep = useCallback(async (stepInfo: StepInfo): Promise<boolean> => {
    // For multi-step components, call their executeStep method via stored ref
    if (stepInfo.isMultiStep) {
      console.log(`🔄 Executing multi-step via stored ref: ${stepInfo.stepId}`);
      const multiStepRef = multiStepRefs.current.get(stepInfo.stepId);
      
      if (multiStepRef?.executeStep) {
        try {
          return await multiStepRef.executeStep();
        } catch (error) {
          console.error(`❌ Multi-step execution failed: ${stepInfo.stepId}`, error);
          return false;
        }
      } else {
        console.error(`❌ Multi-step ref not found for: ${stepInfo.stepId}`);
        return false;
      }
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

    isCancelledRef.current = false; // Reset ref as well
    
    // Use currentStepIndex as the starting point - much more efficient!
    let startIndex = currentStepIndex;
    
    // If currentStepIndex is beyond the end, it means all steps are completed - reset for full re-run
    if (startIndex >= stepComponents.length) {
      console.log(`🔄 All steps completed, resetting for full re-run: ${sectionId}`);
      setCompletedSteps(new Set());
      setCurrentStepIndex(0);
      startIndex = 0;
    } else if (startIndex > 0) {
      console.log(`▶️ Resuming section from step ${startIndex + 1}/${stepComponents.length}: ${stepComponents[startIndex].stepId}`);
    }
    
    // Start section-level blocking (persists for entire section)
    const dummyData = {
      reftarget: `section-${sectionId}`,
      targetaction: 'section',
      targetvalue: undefined,
      requirements: undefined,
      tagName: 'section',
      textContent: title || 'Interactive Section',
      timestamp: Date.now(),
      isPartOfSection: true
    };
    startSectionBlocking(sectionId, dummyData, handleSectionCancel);

    try {
      for (let i = startIndex; i < stepComponents.length; i++) {
        // Check for cancellation before each step
        if (isCancelledRef.current) {
          console.warn(`🛑 Section execution cancelled at step ${i + 1}/${stepComponents.length}`);
          console.warn(`📝 Current step "${stepComponents[i].stepId}" left incomplete`);
          break;
        }
        
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

          // Wait for highlight to be visible and animation to complete
          // Check cancellation during wait
          for (let j = 0; j < 20; j++) { // 20 * 100ms = 2000ms
            if (isCancelledRef.current) break;
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          if (isCancelledRef.current) continue; // Skip to cancellation check at loop start
        }

        // Then, execute the step
        const success = await executeStep(stepInfo);
        
        if (success) {
          // Mark step as completed
          handleStepComplete(stepInfo.stepId);
          
          // Wait between steps for visual feedback
          // Check cancellation during wait
          if (i < stepComponents.length - 1) {
            for (let j = 0; j < 12; j++) { // 12 * 100ms = 1200ms
              if (isCancelledRef.current) break;
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }
        } else {
          console.warn(`⚠️ Breaking section sequence at step ${i + 1} due to execution failure`);
          break;
        }
      }

      // Section sequence completed or cancelled
      if (isCancelledRef.current) {
        console.log(`🛑 Section sequence cancelled: ${sectionId}`);
      } else {
        console.log(`🏁 Section sequence completed: ${sectionId}`);
      }

    } catch (error) {
      console.error('Error running section sequence:', error);
    } finally {
      // Stop section-level blocking
      stopSectionBlocking(sectionId);
      setIsRunning(false);
      setCurrentlyExecutingStep(null);
      // Keep isCancelled state for UI feedback, will be reset on next run
    }
  }, [disabled, isRunning, stepComponents, sectionId, executeStep, executeInteractiveAction, handleStepComplete, startSectionBlocking, stopSectionBlocking, title, handleSectionCancel]);

  // Handle section reset (clear completed steps and reset individual step states)
  const handleResetSection = useCallback(() => {
    if (disabled || isRunning) {
      return;
    }

    setCompletedSteps(new Set());
    setCurrentlyExecutingStep(null);
    setCurrentStepIndex(0); // Reset to start from beginning
    setResetTrigger(prev => prev + 1); // Signal child steps to reset their local state
    console.log(`🔄 Section reset: ${sectionId} - starting from step index 0`);
  }, [disabled, isRunning, sectionId]);

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
          onStepReset: handleStepReset, // Add step reset callback
          disabled: disabled || (isRunning && !isCurrentlyExecuting), // Don't disable currently executing step
          resetTrigger, // Pass reset signal to child steps
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
          onStepReset: handleStepReset, // Add step reset callback
          disabled: disabled || (isRunning && !isCurrentlyExecuting), // Don't disable currently executing step
          resetTrigger, // Pass reset signal to child multi-steps
          key: stepInfo.stepId,
          ref: (ref: { executeStep: () => Promise<boolean> } | null) => {
            if (ref) {
              multiStepRefs.current.set(stepInfo.stepId, ref);
            } else {
              multiStepRefs.current.delete(stepInfo.stepId);
            }
          },
        });
      }
      return child;
    });
  }, [children, stepComponents, getStepEligibility, completedSteps, currentlyExecutingStep, handleStepComplete, handleStepReset, disabled, isRunning, resetTrigger]);

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
          onClick={stepsCompleted && !isCompletedByObjectives ? handleResetSection : handleDoSection}
          disabled={disabled || isRunning || stepComponents.length === 0 || isCompletedByObjectives}
          size="md"
          variant={isCompleted ? "secondary" : "primary"}
          className="interactive-section-do-button"
          title={(() => {
            const resumeInfo = getResumeInfo();
            if (isCompletedByObjectives) return 'Already done!';
            if (stepsCompleted && !isCompletedByObjectives) return 'Reset section and clear all step completion to allow manual re-interaction';
            if (isRunning) return `Running Step ${currentlyExecutingStep ? stepComponents.findIndex(s => s.stepId === currentlyExecutingStep) + 1 : '?'}/${stepComponents.length}...`;
            if (resumeInfo.isResume) return `Resume from step ${resumeInfo.nextStepIndex + 1}, ${resumeInfo.remainingSteps} steps remaining`;
            return hints || `Run through all ${stepComponents.length} steps in sequence`;
          })()}
        >
          {(() => {
            const resumeInfo = getResumeInfo();
            if (isCompletedByObjectives) return 'Already done!';
            if (stepsCompleted && !isCompletedByObjectives) return 'Reset Section';
            if (isRunning) return `Running Step ${currentlyExecutingStep ? stepComponents.findIndex(s => s.stepId === currentlyExecutingStep) + 1 : '?'}/${stepComponents.length}...`;
            if (resumeInfo.isResume) return `Resume (${resumeInfo.remainingSteps} steps)`;
            return `Do Section (${stepComponents.length} steps)`;
          })()}
        </Button>
      </div>
    </div>
  );
} 
