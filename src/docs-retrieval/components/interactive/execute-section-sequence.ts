import React from 'react';
import { ActionMonitor } from '../../../interactive-engine';
import { INTERACTIVE_CONFIG } from '../../../constants/interactive-config';
import type { StepInfo } from '../../../types/component-props.types';
import { reportSectionExecution } from './section-analytics';

/**
 * Dependencies required for section sequence execution
 * Uses dependency injection pattern to make the function testable
 */
export interface SectionExecutionDeps {
  // Step data
  stepComponents: StepInfo[];
  sectionId: string;
  title: string;
  requirements: string | undefined;
  startIndex: number;

  // Interactive engine
  executeInteractiveAction: (...args: any[]) => Promise<void>;
  checkRequirementsFromData: (data: any) => Promise<any>;
  startSectionBlocking: (sectionId: string, data: any, onCancel: () => void) => void;
  stopSectionBlocking: (sectionId: string) => void;

  // Step execution
  executeStep: (stepInfo: StepInfo) => Promise<boolean>;
  handleStepComplete: (stepId: string, skipStateUpdate?: boolean) => void;

  // Refs (imperative state)
  isCancelledRef: React.MutableRefObject<boolean>;
  isProgrammaticScrollRef: React.MutableRefObject<boolean>;
  userScrolledRef: React.MutableRefObject<boolean>;
  stepRefs: React.MutableRefObject<Map<string, any>>;

  // State setters
  setCompletedSteps: React.Dispatch<React.SetStateAction<Set<string>>>;
  setCurrentlyExecutingStep: (stepId: string | null) => void;
  setExecutingStepNumber: (n: number) => void;
  setCurrentStepIndex: (n: number) => void;
  setIsRunning: (running: boolean) => void;

  // Scroll
  scrollToStep: (stepId: string) => void;

  // Persistence
  persistCompletedSteps: (ids: Set<string>) => void;

  // Cancel handler
  handleSectionCancel: () => void;
}

/**
 * Execute a section's steps in sequence
 *
 * This is the core section execution engine extracted from handleDoSection.
 * It orchestrates:
 * - Section-level requirements checking and fixing
 * - Step-by-step execution with show/execute phases
 * - Cancellation handling
 * - Guided step pausing
 * - Step requirements checking and skipping
 * - Analytics reporting
 *
 * @param deps - All dependencies injected as a single object
 */
export async function executeSectionSequence(deps: SectionExecutionDeps): Promise<void> {
  const {
    stepComponents,
    sectionId,
    title,
    requirements,
    startIndex,
    executeInteractiveAction,
    checkRequirementsFromData,
    startSectionBlocking,
    stopSectionBlocking,
    executeStep,
    handleStepComplete,
    isCancelledRef,
    isProgrammaticScrollRef,
    userScrolledRef,
    stepRefs,
    setCompletedSteps,
    setCurrentlyExecutingStep,
    setExecutingStepNumber,
    setCurrentStepIndex,
    setIsRunning,
    scrollToStep,
    persistCompletedSteps,
    handleSectionCancel,
  } = deps;

  setIsRunning(true);
  setExecutingStepNumber(0); // Reset step counter
  userScrolledRef.current = false; // Reset user scroll tracking
  // Keep isProgrammaticScroll TRUE for entire section execution
  // This prevents step execution (button clicks, etc.) from triggering the cancel
  isProgrammaticScrollRef.current = true;

  // Force-disable action monitor during section execution to prevent auto-completion conflicts
  // Using forceDisable() to bypass reference counting during automated execution
  const actionMonitor = ActionMonitor.getInstance();
  actionMonitor.forceDisable();

  // Clear any existing highlights before starting section execution
  const { NavigationManager } = await import('../../../interactive-engine');
  const navigationManager = new NavigationManager();
  navigationManager.clearAllHighlights();

  isCancelledRef.current = false; // Reset ref as well

  // Check section-level requirements first and apply same priority logic
  if (requirements) {
    const sectionRequirementsData = {
      requirements: requirements,
      targetaction: 'section',
      reftarget: `section-${sectionId}`,
      targetvalue: undefined,
      textContent: title || 'Interactive section',
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
            const { NavigationManager } = await import('../../../interactive-engine');
            const navigationManager = new NavigationManager();

            if (fixableError?.fixType === 'expand-parent-navigation' && fixableError.targetHref) {
              await navigationManager.expandParentNavigationSection(fixableError.targetHref);
            } else if (fixableError?.fixType === 'location' && fixableError.targetHref) {
              await navigationManager.fixLocationRequirement(fixableError.targetHref);
            } else if (requirements.includes('navmenu-open')) {
              await navigationManager.fixNavigationRequirements();
            }

            // Recheck section requirements after fix attempt
            await new Promise((resolve) => setTimeout(resolve, 200));
            const sectionRecheckResult = await checkRequirementsFromData(sectionRequirementsData);

            if (!sectionRecheckResult.pass) {
              // Section requirements still not met after fix attempt
              console.warn('Section requirements could not be fixed, stopping execution');
              ActionMonitor.getInstance().forceEnable(); // Re-enable monitor
              setIsRunning(false);
              return;
            }
          } catch (fixError) {
            console.warn('Failed to fix section requirements:', fixError);
            ActionMonitor.getInstance().forceEnable(); // Re-enable monitor
            setIsRunning(false);
            return;
          }
        } else {
          // No fix available for section requirements
          console.warn('Section requirements not met and no fix available, stopping execution');
          ActionMonitor.getInstance().forceEnable(); // Re-enable monitor
          setIsRunning(false);
          return;
        }
      }
    } catch (error) {
      console.warn('Section requirements check failed:', error);
      ActionMonitor.getInstance().forceEnable(); // Re-enable monitor
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
    textContent: title || 'Interactive section',
    timestamp: Date.now(),
    isPartOfSection: true,
  };
  startSectionBlocking(sectionId, dummyData, handleSectionCancel);

  let stoppedDueToRequirements = false;
  let completedStepsCount = startIndex; // Track number of completed steps for analytics (starts at startIndex since those are already done)

  try {
    for (let i = startIndex; i < stepComponents.length; i++) {
      // Check for cancellation before each step
      if (isCancelledRef.current) {
        break;
      }

      const stepInfo = stepComponents[i];

      // PAUSE: If this is a guided step, stop automated execution
      // User must manually click the guided step's "Do it" button
      // Once complete, they can click "Resume" to continue
      if (stepInfo.isGuided) {
        ActionMonitor.getInstance().forceEnable(); // Re-enable monitor for guided mode
        setCurrentStepIndex(i); // Mark where we stopped
        setIsRunning(false); // Stop the automated loop
        stopSectionBlocking(sectionId); // Remove blocking overlay

        // Don't set currentlyExecutingStep - let the guided step handle its own execution
        return; // Exit the section execution loop
      }

      setCurrentlyExecutingStep(stepInfo.stepId);
      setExecutingStepNumber(i + 1); // 1-indexed for display
      scrollToStep(stepInfo.stepId); // Auto-scroll to the step

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
                const { NavigationManager } = await import('../../../interactive-engine');
                const navigationManager = new NavigationManager();

                if (fixableError?.fixType === 'expand-parent-navigation' && fixableError.targetHref) {
                  await navigationManager.expandParentNavigationSection(fixableError.targetHref);
                } else if (fixableError?.fixType === 'location' && fixableError.targetHref) {
                  await navigationManager.fixLocationRequirement(fixableError.targetHref);
                } else if (fixableError?.fixType === 'navigation') {
                  await navigationManager.fixNavigationRequirements();
                } else if (stepInfo.requirements?.includes('navmenu-open')) {
                  // Only fix navigation requirements if no other specific fix type is available
                  await navigationManager.fixNavigationRequirements();
                }

                // Recheck requirements after fix attempt
                await new Promise((resolve) => setTimeout(resolve, 200)); // Wait for UI to settle
                const recheckResult = await checkRequirementsFromData(stepRequirementsData);

                if (!recheckResult.pass) {
                  // Fix didn't work - check if step is skippable
                  // Priority 3: Skip if possible
                  if (stepInfo.skippable) {
                    // Skip this step properly using the step's own markSkipped function
                    const stepRef = stepRefs.current.get(stepInfo.stepId);
                    if (stepRef?.markSkipped) {
                      stepRef.markSkipped(); // This handles the blue state properly
                      handleStepComplete(stepInfo.stepId, true); // This handles the flow continuation
                    }
                    continue; // Continue to next step
                  } else {
                    // Priority 4: Stop execution if not skippable
                    setCurrentStepIndex(i);
                    stoppedDueToRequirements = true;
                    break;
                  }
                }
                // If recheck passed, continue with normal execution below
              } catch (fixError) {
                console.warn(`Failed to fix requirements for step ${i + 1}:`, fixError);

                // Fix failed - check if step is skippable
                if (stepInfo.skippable) {
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
              // No fix available - check if step is skippable
              // Priority 3: Skip if possible
              if (stepInfo.skippable) {
                // Skip this step properly using the step's own markSkipped function
                const stepRef = stepRefs.current.get(stepInfo.stepId);
                if (stepRef?.markSkipped) {
                  stepRef.markSkipped(); // This handles the blue state properly
                  handleStepComplete(stepInfo.stepId, true); // This handles the flow continuation
                }
                continue; // Continue to next step
              } else {
                // Priority 4: Stop execution if not skippable and no fix available
                setCurrentStepIndex(i);
                stoppedDueToRequirements = true;
                break;
              }
            }
          }
        } catch (error) {
          console.warn(`Step ${i + 1} requirements check failed, stopping section execution:`, error);
          setCurrentStepIndex(i);
          stoppedDueToRequirements = true;
          break;
        }
      }

      // First, show the step (highlight it) - skip for multi-step components OR if showMe is false
      if (!stepInfo.isMultiStep && stepInfo.showMe !== false) {
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

      // Then, execute the step (verifyStepResult already has retry logic)
      const success = await executeStep(stepInfo);

      if (success) {
        // Track completed step for analytics
        completedStepsCount = i + 1; // i is 0-indexed, so +1 gives count of completed steps

        // Mark step as completed immediately and persistently
        setCompletedSteps((prev) => {
          const newSet = new Set([...prev, stepInfo.stepId]);
          // Persist immediately to ensure green state is preserved
          persistCompletedSteps(newSet);
          return newSet;
        });

        // Also call the standard completion handler for other side effects (skip state update to avoid double-setting)
        handleStepComplete(stepInfo.stepId, true);

        // Wait between steps for both visual feedback AND DOM settling
        // This ensures the next step's requirements are ready before checking
        if (i < stepComponents.length - 1) {
          // First: Wait for React updates to propagate
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

          // Then: Wait for visual feedback with cancellation checks
          for (let j = 0; j < INTERACTIVE_CONFIG.delays.section.betweenStepsIterations; j++) {
            if (isCancelledRef.current) {
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.section.baseInterval));
          }
        }
      } else {
        // Step execution failed after retries - stop and don't auto-complete remaining steps
        setCurrentStepIndex(i);
        stoppedDueToRequirements = true;

        // Wait for state to settle, then trigger reactive check
        // This ensures remaining steps update their eligibility based on completed steps
        setTimeout(() => {
          import('../../../requirements-manager').then(({ SequentialRequirementsManager }) => {
            const manager = SequentialRequirementsManager.getInstance();
            manager.triggerReactiveCheck();
          });
        }, 200);

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
    // Re-enable action monitor after section execution completes
    ActionMonitor.getInstance().forceEnable();

    // Stop section-level blocking
    stopSectionBlocking(sectionId);
    setIsRunning(false);
    setCurrentlyExecutingStep(null);
    setExecutingStepNumber(0);
    // Reset programmatic scroll flag now that section is done
    isProgrammaticScrollRef.current = false;
    // Keep isCancelled state for UI feedback, will be reset on next run

    // Track "Do Section" analytics after completion (success or cancel)
    reportSectionExecution({
      sectionId,
      title,
      totalSectionSteps: stepComponents.length,
      completedStepsCount,
      startIndex,
      wasCanceled: isCancelledRef.current || stoppedDueToRequirements,
    });
  }
}
