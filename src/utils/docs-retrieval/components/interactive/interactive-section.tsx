import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Button } from '@grafana/ui';

import { useInteractiveElements } from '../../../interactive.hook';
import { useStepChecker } from '../../../step-checker.hook';
import { InteractiveStep } from './interactive-step';
import { InteractiveMultiStep } from './interactive-multi-step';
import { INTERACTIVE_CONFIG } from '../../../../constants/interactive-config';

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
  postVerify?: string;
  targetComment?: string;
  doIt?: boolean; // Control whether "Do it" button appears (defaults to true)
  skipable?: boolean; // Whether this step can be skipped if requirements fail
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
  id?: string; // HTML id attribute for section identification
}

// Types for unified state management
export interface StepInfo {
  stepId: string;
  element: React.ReactElement<InteractiveStepProps> | React.ReactElement<any>;
  index: number;
  targetAction?: string; // Optional for multi-step
  refTarget?: string; // Optional for multi-step
  targetValue?: string;
  targetComment?: string; // Optional comment to show during execution
  requirements?: string;
  postVerify?: string;
  skipable?: boolean; // Whether this step can be skipped
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
  id, // HTML id attribute from parsed content
}: InteractiveSectionProps) {
  // Use provided HTML id or generate sequential fallback
  const sectionId = useMemo(() => {
    if (id) {
      // Use the HTML id attribute, prefixed with section- for consistency
      const generatedId = `section-${id}`;
      return generatedId;
    }
    // Fallback to sequential ID for sections without explicit id
    interactiveSectionCounter++;
    const generatedId = `section-${interactiveSectionCounter}`;
    return generatedId;
  }, [id]);

  // Sequential state management
  const [completedSteps, setCompletedSteps] = useState(new Set<string>());
  const [currentlyExecutingStep, setCurrentlyExecutingStep] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0); // Track next uncompleted step
  const [resetTrigger, setResetTrigger] = useState(0); // Trigger to reset child steps

  // --- Persistence helpers (restore across refresh) ---
  const getContentKey = useCallback((): string => {
    try {
      const tabId = (window as any).__DocsPluginActiveTabId as string | undefined;
      const tabUrl = (window as any).__DocsPluginActiveTabUrl as string | undefined;
      const contentKey = (window as any).__DocsPluginContentKey as string | undefined;
      // Prefer tabId for uniqueness across multiple open tutorials
      if (tabId && tabId.length > 0) {
        return `tab:${tabId}`;
      }
      if (tabUrl && tabUrl.length > 0) {
        return tabUrl;
      }
      if (contentKey && contentKey.length > 0) {
        return contentKey;
      }
    } catch {
      // no-op
    }
    // Fallback: use current location
    return typeof window !== 'undefined' ? window.location.pathname : 'unknown';
  }, []);

  const getStorageKey = useCallback(() => {
    const contentKey = getContentKey();
    return `docsPlugin:completedSteps:${contentKey}:${sectionId}`;
  }, [getContentKey, sectionId]);

  // Load persisted completed steps on mount/section change (declared after stepComponents)

  const persistCompletedSteps = useCallback(
    (ids: Set<string>) => {
      try {
        const key = getStorageKey();
        localStorage.setItem(key, JSON.stringify(Array.from(ids)));
      } catch {
        // ignore persistence errors
      }
    },
    [getStorageKey]
  );

  // Use ref for cancellation to avoid closure issues
  const isCancelledRef = useRef(false);

  // Store refs to multistep components for section-level execution
  const multiStepRefs = useRef<Map<string, { executeStep: () => Promise<boolean> }>>(new Map());
  
  // Store refs to regular step components for skip functionality
  const stepRefs = useRef<Map<string, { executeStep: () => Promise<boolean>; markSkipped?: () => void }>>(new Map());

  // Get the interactive functions from the hook
  const { executeInteractiveAction, startSectionBlocking, stopSectionBlocking, verifyStepResult, checkRequirementsFromData } =
    useInteractiveElements();

  // Create cancellation handler
  const handleSectionCancel = useCallback(() => {
    isCancelledRef.current = true; // Set ref for immediate access
    // The running loop will detect this and break
  }, []);

  // Use executeInteractiveAction directly (no wrapper needed)
  // Section-level blocking is managed separately at the section level

  // Extract step information from children first (needed for completion calculation)
  const stepComponents = useMemo((): StepInfo[] => {
    const steps: StepInfo[] = [];

    React.Children.forEach(children, (child, index) => {
      if (React.isValidElement(child) && (child as any).type === InteractiveStep) {
        const props = child.props as InteractiveStepProps;
        const stepId = `${sectionId}-step-${index + 1}`;

        steps.push({
          stepId,
          element: child as React.ReactElement<InteractiveStepProps>,
          index,
          targetAction: props.targetAction,
          refTarget: props.refTarget,
          targetValue: props.targetValue,
          targetComment: props.targetComment,
          requirements: props.requirements,
          postVerify: props.postVerify,
          skipable: props.skipable,
          isMultiStep: false,
        });
      } else if (React.isValidElement(child) && (child as any).type === InteractiveMultiStep) {
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
          skipable: props.skipable,
          isMultiStep: true,
        });
      }
    });

    return steps;
  }, [children, sectionId]);

  // Load persisted completed steps on mount/section change (declared after stepComponents)
  useEffect(() => {
    try {
      const key = getStorageKey();
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed: string[] = JSON.parse(raw);
        // Only keep steps that exist in current content
        const validIds = new Set(stepComponents.map((s) => s.stepId));
        const filtered = parsed.filter((id) => validIds.has(id));
        if (filtered.length > 0) {
          const restored = new Set(filtered);
          setCompletedSteps(restored);
          // Move index to next uncompleted
          const nextIdx = stepComponents.findIndex((s) => !restored.has(s.stepId));
          setCurrentStepIndex(nextIdx === -1 ? stepComponents.length : nextIdx);
        }
      }
    } catch {
      // ignore persistence errors
    }
  }, [getStorageKey, stepComponents]);

  // Objectives checking is handled by the step checker hook

  // Calculate base completion (steps completed) - needed for completion logic
  const stepsCompleted = stepComponents.length > 0 && completedSteps.size >= stepComponents.length;

  // Add objectives checking for section - disable if steps are already completed
  const objectivesChecker = useStepChecker({
    objectives,
    stepId: sectionId,
    isEligibleForChecking: !stepsCompleted, // Stop checking once steps are done
  });



  // UNIFIED completion calculation - objectives always win (clarification 1, 2)
  const isCompletedByObjectives = objectivesChecker.completionReason === 'objectives';
  const isCompleted = isCompletedByObjectives || stepsCompleted;

  // Section completion status tracking (debug logging removed)

  // When section objectives are met, mark all child steps as complete (clarification 2, 16)
  useEffect(() => {
    if (isCompletedByObjectives && stepComponents.length > 0) {
      const allStepIds = new Set(stepComponents.map((step) => step.stepId));

      if (completedSteps && completedSteps.size !== allStepIds.size) {
        setCompletedSteps(allStepIds);
        setCurrentStepIndex(stepComponents.length); // Mark as all completed
      }
    }
  }, [isCompletedByObjectives, stepComponents, sectionId, completedSteps]);

  // Trigger reactive checks when section completion status changes
  useEffect(() => {
    if (isCompleted && stepComponents.length > 0) {
      // Import and use the SequentialRequirementsManager to trigger reactive checks
      import('../../../requirements-checker.hook').then(({ SequentialRequirementsManager }) => {
        const manager = SequentialRequirementsManager.getInstance();

        // Trigger reactive check for all steps that might depend on this section
        manager.triggerReactiveCheck();

        // Also trigger DOM event for any steps listening for section completion
        const completionEvent = new CustomEvent('section-completed', {
          detail: { sectionId },
        });
        document.dispatchEvent(completionEvent);

        // Multiple delayed triggers to ensure dependent steps get unlocked
        setTimeout(() => {
          manager.triggerReactiveCheck();
          document.dispatchEvent(completionEvent);
        }, 100);
        setTimeout(() => {
          manager.triggerReactiveCheck();
        }, 300);
      });
    }
  }, [isCompleted, sectionId, stepComponents.length]);

  // Calculate which step is eligible for checking (sequential logic)
  const getStepEligibility = useCallback(
    (stepIndex: number) => {
      // First step is always eligible (Trust but Verify)
      if (stepIndex === 0) {
        return true;
      }

      // Subsequent steps are eligible if all previous steps are completed
      for (let i = 0; i < stepIndex; i++) {
        const prevStepId = stepComponents[i].stepId;
        if (!completedSteps.has(prevStepId)) {
          return false;
        }
      }
      return true;
    },
    [completedSteps, stepComponents]
  );

  // Calculate resume information for button display
  const getResumeInfo = useCallback(() => {
    if (stepComponents.length === 0) {
      return { nextStepIndex: 0, remainingSteps: 0, isResume: false };
    }

    // Use currentStepIndex directly - no iteration needed!
    const nextStepIndex = currentStepIndex;

    // If currentStepIndex is beyond the end, it means all steps are completed
    const allCompleted = nextStepIndex >= stepComponents.length;
    const remainingSteps = allCompleted ? stepComponents.length : stepComponents.length - nextStepIndex;
    const isResume = !allCompleted && nextStepIndex > 0;

    return { nextStepIndex, remainingSteps, isResume };
  }, [stepComponents.length, currentStepIndex]);

  // Handle individual step completion
  const handleStepComplete = useCallback(
    (stepId: string, skipStateUpdate = false) => {
      if (!skipStateUpdate) {
        const newCompletedSteps = new Set([...completedSteps, stepId]);
        setCompletedSteps(newCompletedSteps);
      }
      setCurrentlyExecutingStep(null);

      // Advance currentStepIndex to the next uncompleted step
      const currentIndex = stepComponents.findIndex((step) => step.stepId === stepId);
      if (currentIndex >= 0) {
        setCurrentStepIndex(currentIndex + 1);
      }

      // Check if all steps are completed (only when we actually updated the state)
      if (!skipStateUpdate) {
        const newCompletedSteps = new Set([...completedSteps, stepId]);
        // Persist
        persistCompletedSteps(newCompletedSteps);
        const allStepsCompleted = newCompletedSteps.size >= stepComponents.length;

        if (allStepsCompleted) {
          onComplete?.();
        }
      }
    },
    [completedSteps, stepComponents, onComplete, persistCompletedSteps]
  );

  // Handle individual step reset (redo functionality)
  const handleStepReset = useCallback(
    (stepId: string) => {
      setCompletedSteps((prev) => {
        const newSet = new Set(prev);
        newSet.delete(stepId);
        // Persist removal
        persistCompletedSteps(newSet);
        return newSet;
      });

      // Move currentStepIndex back if we're resetting an earlier step
      const resetIndex = stepComponents.findIndex((step) => step.stepId === stepId);
      if (resetIndex >= 0 && resetIndex < currentStepIndex) {
        setCurrentStepIndex(resetIndex);
      }

      // Also clear currently executing step if it matches
      if (currentlyExecutingStep === stepId) {
        setCurrentlyExecutingStep(null);
      }
    },
    [currentlyExecutingStep, stepComponents, currentStepIndex, persistCompletedSteps]
  );

  // Execute a single step (shared between individual and sequence execution)
  const executeStep = useCallback(
    async (stepInfo: StepInfo): Promise<boolean> => {
      // For multi-step components, call their executeStep method via stored ref
      if (stepInfo.isMultiStep) {
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

      try {
        // Execute the action using existing interactive logic
        await executeInteractiveAction(
          stepInfo.targetAction!,
          stepInfo.refTarget!,
          stepInfo.targetValue,
          'do',
          stepInfo.targetComment
        );

        // Prefer explicit postVerify over generic requirements for post-checking
        const postConditions =
          stepInfo.postVerify && stepInfo.postVerify.trim() !== '' ? stepInfo.postVerify : stepInfo.requirements;
        if (postConditions && postConditions.trim() !== '') {
          const result = await verifyStepResult(
            postConditions,
            stepInfo.targetAction || 'button',
            stepInfo.refTarget || '',
            stepInfo.targetValue,
            stepInfo.stepId
          );
          if (!result.pass) {
            console.warn(`⛔ Post-verify failed for ${stepInfo.stepId}:`, result.error);
            return false;
          }
        }

        return true;
      } catch (error) {
        console.error(`❌ Step execution failed: ${stepInfo.stepId}`, error);
        return false;
      }
    },
    [executeInteractiveAction, verifyStepResult]
  );

  // Handle sequence execution (do section)
  const handleDoSection = useCallback(async () => {
    if (disabled || isRunning || stepComponents.length === 0) {
      return;
    }

    setIsRunning(true);

    isCancelledRef.current = false; // Reset ref as well

    // Use currentStepIndex as the starting point - much more efficient!
    let startIndex = currentStepIndex;

    // If currentStepIndex is beyond the end, it means all steps are completed - reset for full re-run
    if (startIndex >= stepComponents.length) {
      setCompletedSteps(new Set());
      setCurrentStepIndex(0);
      startIndex = 0;
    }

    // Check section-level requirements first and apply same priority logic
    if (requirements) {
      const sectionRequirementsData = {
        requirements: requirements,
        targetaction: 'section',
        reftarget: `section-${sectionId}`,
        targetvalue: undefined,
        textContent: title || 'Interactive Section',
        tagName: 'section',
      };

      try {
        const sectionRequirementsResult = await checkRequirementsFromData(sectionRequirementsData);
        if (!sectionRequirementsResult.pass) {
          // Section requirements not met - try to fix
          if (sectionRequirementsResult.error?.some((e: any) => e.canFix)) {
            const fixableError = sectionRequirementsResult.error.find((e: any) => e.canFix);
            
            try {
              // Try to fix the section requirement automatically
              const { NavigationManager } = await import('../../../navigation-manager');
              const navigationManager = new NavigationManager();
              
              if (fixableError?.fixType === 'expand-parent-navigation' && fixableError.targetHref) {
                await navigationManager.expandParentNavigationSection(fixableError.targetHref);
              } else if (requirements.includes('navmenu-open')) {
                await navigationManager.fixNavigationRequirements();
              }
              
              // Recheck section requirements after fix attempt
              await new Promise(resolve => setTimeout(resolve, 200));
              const sectionRecheckResult = await checkRequirementsFromData(sectionRequirementsData);
              
              if (!sectionRecheckResult.pass) {
                // Section requirements still not met after fix attempt
                console.warn('⚠️ Section requirements could not be fixed, stopping execution');
                setIsRunning(false);
                return;
              }
            } catch (fixError) {
              console.warn('⚠️ Failed to fix section requirements:', fixError);
              setIsRunning(false);
              return;
            }
          } else {
            // No fix available for section requirements
            console.warn('⚠️ Section requirements not met and no fix available, stopping execution');
            setIsRunning(false);
            return;
          }
        }
      } catch (error) {
        console.warn('⚠️ Section requirements check failed:', error);
        setIsRunning(false);
        return;
      }
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
      isPartOfSection: true,
    };
    startSectionBlocking(sectionId, dummyData, handleSectionCancel);

    let stoppedDueToRequirements = false;

    try {
      for (let i = startIndex; i < stepComponents.length; i++) {
        // Check for cancellation before each step
        if (isCancelledRef.current) {
          break;
        }

        const stepInfo = stepComponents[i];
        setCurrentlyExecutingStep(stepInfo.stepId);

        // Check step requirements before attempting execution
        if (stepInfo.requirements) {
          const stepRequirementsData = {
            requirements: stepInfo.requirements,
            targetaction: stepInfo.targetAction || 'button',
            reftarget: stepInfo.refTarget || '',
            targetvalue: stepInfo.targetValue,
            textContent: stepInfo.stepId,
            tagName: 'div',
          };

          try {
            const requirementsResult = await checkRequirementsFromData(stepRequirementsData);
            if (!requirementsResult.pass) {
              // Requirements not met - apply priority logic
              
              // Priority 2: Try to fix the requirement if possible
              if (requirementsResult.error?.some((e: any) => e.canFix)) {
                const fixableError = requirementsResult.error.find((e: any) => e.canFix);
                
                try {
                  // Try to fix the requirement automatically
                  const { NavigationManager } = await import('../../../navigation-manager');
                  const navigationManager = new NavigationManager();
                  
                  if (fixableError?.fixType === 'expand-parent-navigation' && fixableError.targetHref) {
                    await navigationManager.expandParentNavigationSection(fixableError.targetHref);
                  } else if (fixableError?.fixType === 'navigation' || stepInfo.requirements?.includes('navmenu-open')) {
                    await navigationManager.fixNavigationRequirements();
                  }
                  
                  // Recheck requirements after fix attempt
                  await new Promise(resolve => setTimeout(resolve, 200)); // Wait for UI to settle
                  const recheckResult = await checkRequirementsFromData(stepRequirementsData);
                  
                  if (!recheckResult.pass) {
                    // Fix didn't work - check if step is skipable
                    // Priority 3: Skip if possible
                    if (stepInfo.skipable) {
                      // Skip this step properly using the step's own markSkipped function
                      const stepRef = stepRefs.current.get(stepInfo.stepId);
                      if (stepRef?.markSkipped) {
                        stepRef.markSkipped(); // This handles the blue state properly
                        handleStepComplete(stepInfo.stepId, true); // This handles the flow continuation
                      }
                      continue; // Continue to next step
                    } else {
                      // Priority 4: Stop execution if not skipable
                      setCurrentStepIndex(i);
                      stoppedDueToRequirements = true;
                      break;
                    }
                  }
                  // If recheck passed, continue with normal execution below
                } catch (fixError) {
                  console.warn(`⚠️ Failed to fix requirements for step ${i + 1}:`, fixError);
                  
                  // Fix failed - check if step is skipable
                  if (stepInfo.skipable) {
                    // Skip this step properly using the step's own markSkipped function
                    const stepRef = stepRefs.current.get(stepInfo.stepId);
                    if (stepRef?.markSkipped) {
                      stepRef.markSkipped(); // This handles the blue state properly
                      handleStepComplete(stepInfo.stepId, true); // This handles the flow continuation
                    }
                    continue;
                  } else {
                    // Stop execution
                    setCurrentStepIndex(i);
                    stoppedDueToRequirements = true;
                    break;
                  }
                }
              } else {
                // No fix available - check if step is skipable
                // Priority 3: Skip if possible
                if (stepInfo.skipable) {
                  // Skip this step properly using the step's own markSkipped function
                  const stepRef = stepRefs.current.get(stepInfo.stepId);
                  if (stepRef?.markSkipped) {
                    stepRef.markSkipped(); // This handles the blue state properly
                    handleStepComplete(stepInfo.stepId, true); // This handles the flow continuation
                  }
                  continue; // Continue to next step
                } else {
                  // Priority 4: Stop execution if not skipable and no fix available
                  setCurrentStepIndex(i);
                  stoppedDueToRequirements = true;
                  break;
                }
              }
            }
          } catch (error) {
            console.warn(`⚠️ Step ${i + 1} requirements check failed, stopping section execution:`, error);
            setCurrentStepIndex(i);
            stoppedDueToRequirements = true;
            break;
          }
        }

        // First, show the step (highlight it) - skip for multi-step components
        if (!stepInfo.isMultiStep) {
          await executeInteractiveAction(
            stepInfo.targetAction!,
            stepInfo.refTarget!,
            stepInfo.targetValue,
            'show',
            stepInfo.targetComment
          );

          // Wait for highlight to be visible and animation to complete
          // Check cancellation during wait
          for (let j = 0; j < INTERACTIVE_CONFIG.delays.section.showPhaseIterations; j++) {
            if (isCancelledRef.current) {
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.section.baseInterval));
          }
          if (isCancelledRef.current) {
            continue;
          } // Skip to cancellation check at loop start
        }

        // Then, execute the step
        const success = await executeStep(stepInfo);

        if (success) {
          // Mark step as completed immediately and persistently
          setCompletedSteps((prev) => {
            const newSet = new Set([...prev, stepInfo.stepId]);
            return newSet;
          });

          // Also call the standard completion handler for other side effects (skip state update to avoid double-setting)
          handleStepComplete(stepInfo.stepId, true);

          // Wait between steps for visual feedback
          // Check cancellation during wait
          if (i < stepComponents.length - 1) {
            for (let j = 0; j < INTERACTIVE_CONFIG.delays.section.betweenStepsIterations; j++) {
              if (isCancelledRef.current) {
                break;
              }
              await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.section.baseInterval));
            }
          }
        } else {
          break;
        }
      }

      // Section sequence completed or cancelled
      if (!isCancelledRef.current && !stoppedDueToRequirements) {
        // Only auto-complete all steps if we actually completed the entire sequence
        // Don't auto-complete if we stopped due to requirements failure
        const allStepIds = new Set(stepComponents.map((step) => step.stepId));
        setCompletedSteps(allStepIds);
        setCurrentStepIndex(stepComponents.length);

        // Force re-evaluation of section completion state
        setTimeout(() => {
          // This will trigger the completion effects now that all steps are marked complete
        }, 100);
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
  }, [
    disabled,
    isRunning,
    stepComponents,
    sectionId,
    executeStep,
    executeInteractiveAction,
    handleStepComplete,
    startSectionBlocking,
    stopSectionBlocking,
    title,
    handleSectionCancel,
    currentStepIndex,
    checkRequirementsFromData,
  ]);

  // Handle section reset (clear completed steps and reset individual step states)
  const handleResetSection = useCallback(() => {
    if (disabled || isRunning) {
      return;
    }

    setCompletedSteps(new Set());
    setCurrentlyExecutingStep(null);
    setCurrentStepIndex(0); // Reset to start from beginning
    setResetTrigger((prev) => prev + 1); // Signal child steps to reset their local state
    
    // Trigger reactive check to properly re-enable steps based on current requirements
    setTimeout(() => {
      const { SequentialRequirementsManager } = require('../../../requirements-checker.hook');
      SequentialRequirementsManager.getInstance().triggerReactiveCheck();
    }, 100);
    
    // Clear persistence
    try {
      localStorage.removeItem(getStorageKey());
    } catch {
      // ignore
    }
  }, [disabled, isRunning, getStorageKey]);

  // Render enhanced children with coordination props
  const enhancedChildren = useMemo(() => {
    return React.Children.map(children, (child, index) => {
      if (React.isValidElement(child) && (child as any).type === InteractiveStep) {
        const stepInfo = stepComponents[index];
        if (!stepInfo) {
          return child;
        }

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
          ref: (ref: { executeStep: () => Promise<boolean>; markSkipped?: () => void } | null) => {
            if (ref) {
              stepRefs.current.set(stepInfo.stepId, ref);
            } else {
              stepRefs.current.delete(stepInfo.stepId);
            }
          },
        });
      } else if (React.isValidElement(child) && (child as any).type === InteractiveMultiStep) {
        const stepInfo = stepComponents[index];
        if (!stepInfo) {
          return child;
        }

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
          ref: (
            ref: {
              executeStep: () => Promise<boolean>;
            } | null
          ) => {
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
  }, [
    children,
    stepComponents,
    getStepEligibility,
    completedSteps,
    currentlyExecutingStep,
    handleStepComplete,
    handleStepReset,
    disabled,
    isRunning,
    resetTrigger,
  ]);

  return (
    <div
      id={sectionId}
      className={`interactive-section${className ? ` ${className}` : ''}${isCompleted ? ' completed' : ''}`}
    >
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

      {description && <div className="interactive-section-description">{description}</div>}

      <div className="interactive-section-content">{enhancedChildren}</div>



      <div className="interactive-section-actions">
        <Button
          onClick={stepsCompleted && !isCompletedByObjectives ? handleResetSection : handleDoSection}
          disabled={disabled || isRunning || stepComponents.length === 0 || isCompletedByObjectives}
          size="md"
          variant={isCompleted ? 'secondary' : 'primary'}
          className="interactive-section-do-button"
          title={(() => {
            const resumeInfo = getResumeInfo();
            if (isCompletedByObjectives) {
              return 'Already done!';
            }
            if (stepsCompleted && !isCompletedByObjectives) {
              return 'Reset section and clear all step completion to allow manual re-interaction';
            }
            if (isRunning) {
              return `Running Step ${
                currentlyExecutingStep ? stepComponents.findIndex((s) => s.stepId === currentlyExecutingStep) + 1 : '?'
              }/${stepComponents.length}...`;
            }
            if (resumeInfo.isResume) {
              return `Resume from step ${resumeInfo.nextStepIndex + 1}, ${resumeInfo.remainingSteps} steps remaining`;
            }
            return hints || `Run through all ${stepComponents.length} steps in sequence`;
          })()}
        >
          {(() => {
            const resumeInfo = getResumeInfo();
            if (isCompletedByObjectives) {
              return 'Already done!';
            }
            if (stepsCompleted && !isCompletedByObjectives) {
              return 'Reset Section';
            }
            if (isRunning) {
              return `Running Step ${
                currentlyExecutingStep ? stepComponents.findIndex((s) => s.stepId === currentlyExecutingStep) + 1 : '?'
              }/${stepComponents.length}...`;
            }
            if (resumeInfo.isResume) {
              return `Resume (${resumeInfo.remainingSteps} steps)`;
            }
            return `Do Section (${stepComponents.length} steps)`;
          })()}
        </Button>
      </div>
    </div>
  );
}
