import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Button } from '@grafana/ui';
import { usePluginContext } from '@grafana/data';

import { useInteractiveElements, ActionMonitor } from '../../../interactive-engine';
import { useStepChecker } from '../../../requirements-manager';
import { interactiveStepStorage, sectionCollapseStorage } from '../../../lib/user-storage';
import { getInteractiveConfig } from '../../../constants/interactive-config';
import { getConfigWithDefaults } from '../../../constants';
import type { InteractiveSectionProps, StepInfo } from '../../../types/component-props.types';
import { testIds } from '../../../components/testIds';
import { getContentKey } from './get-content-key';
import {
  nextSectionCounter,
  registerSectionSteps,
  getTotalDocumentSteps,
  getDocumentStepPosition,
} from './step-registry';
import { buildStepInfo } from './build-step-info';
import { useSectionPersistence } from './use-section-persistence';
import { useSectionRequirements } from './use-section-requirements';
import { useScrollTracking } from './use-scroll-tracking';
import { executeSectionSequence } from './execute-section-sequence';
import { enhanceChildren } from './enhance-children';

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
    const generatedId = `section-${nextSectionCounter()}`;
    return generatedId;
  }, [id]);

  // Extract step information from children first (needed for persistence hook)
  const stepComponents = useMemo((): StepInfo[] => buildStepInfo(children, sectionId), [children, sectionId]);

  // Persistence hook (handles completed steps, collapse state, preview mode detection)
  const {
    completedSteps,
    setCompletedSteps,
    currentStepIndex,
    setCurrentStepIndex,
    isCollapsed,
    setIsCollapsed,
    isPreviewMode,
    toggleCollapse,
    persistCompletedSteps,
  } = useSectionPersistence({ sectionId, stepComponents });

  // Sequential state management
  const [currentlyExecutingStep, setCurrentlyExecutingStep] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [executingStepNumber, setExecutingStepNumber] = useState(0); // Track which step is being executed (1-indexed for display)
  const [resetTrigger, setResetTrigger] = useState(0); // Trigger to reset child steps

  // Use ref for cancellation to avoid closure issues
  const isCancelledRef = useRef(false);

  // Track if we've already auto-collapsed to prevent re-collapsing on manual expand
  const hasAutoCollapsedRef = useRef(false);

  // Get the interactive functions from the hook
  const {
    executeInteractiveAction,
    startSectionBlocking,
    stopSectionBlocking,
    verifyStepResult,
    checkRequirementsFromData,
  } = useInteractiveElements();

  // Section requirements checking hook
  const { sectionRequirementsStatus } = useSectionRequirements({
    requirements,
    sectionId,
    title: title || '',
    checkRequirementsFromData,
  });

  // Scroll tracking hook
  const { userScrolledRef, isProgrammaticScrollRef, scrollToStep } = useScrollTracking({ isRunning });

  // Store refs to multistep components for section-level execution
  const multiStepRefs = useRef<Map<string, { executeStep: () => Promise<boolean> }>>(new Map());

  // Store refs to regular step components for skip functionality
  const stepRefs = useRef<Map<string, { executeStep: () => Promise<boolean>; markSkipped?: () => void }>>(new Map());

  // Create cancellation handler
  const handleSectionCancel = useCallback(() => {
    isCancelledRef.current = true; // Set ref for immediate access
    // The running loop will detect this and break
  }, []);

  // Use executeInteractiveAction directly (no wrapper needed)
  // Section-level blocking is managed separately at the section level

  // Objectives checking is handled by the step checker hook

  // Calculate base completion (steps completed) - needed for completion logic
  // Noop steps are always considered complete (they're informational only)
  const nonNoopSteps = stepComponents.filter((s) => s.targetAction !== 'noop');
  const stepsCompleted =
    stepComponents.length > 0 && (nonNoopSteps.length === 0 || nonNoopSteps.every((s) => completedSteps.has(s.stepId)));

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCompletedByObjectives, stepComponents, sectionId, completedSteps]);

  // Auto-collapse section when it becomes complete (but only once, don't override manual expansion)
  // Skip auto-collapse in preview mode - guide authors want to control collapse manually
  useEffect(() => {
    if (isPreviewMode) {
      return; // Don't auto-collapse in preview mode
    }
    if (isCompleted && !hasAutoCollapsedRef.current) {
      hasAutoCollapsedRef.current = true;
      setIsCollapsed(true);
      const contentKey = getContentKey();
      sectionCollapseStorage.set(contentKey, sectionId, true);
    } else if (!isCompleted) {
      // Reset the flag when section becomes incomplete (e.g., after reset)
      hasAutoCollapsedRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCompleted, sectionId, isPreviewMode]);

  // Get plugin configuration to determine if auto-detection is enabled
  const pluginContext = usePluginContext();
  const pluginConfig = useMemo(() => {
    return getConfigWithDefaults(pluginContext?.meta?.jsonData || {});
  }, [pluginContext?.meta?.jsonData]);

  // Get runtime interactive config with plugin overrides
  const interactiveConfig = useMemo(() => {
    return getInteractiveConfig(pluginConfig);
  }, [pluginConfig]);

  // Enable action monitor when component mounts (if feature is enabled in config)
  useEffect(() => {
    const actionMonitor = ActionMonitor.getInstance();

    // Only enable if user has turned on the feature in plugin config
    if (interactiveConfig.autoDetection.enabled) {
      actionMonitor.enable();
    }

    // Cleanup: disable monitor when component unmounts (optional, but good practice)
    return () => {
      // Only disable if no other sections are using it
      // The monitor is a singleton, so this might be shared across sections
    };
  }, [interactiveConfig.autoDetection.enabled]); // Re-run if config changes

  // Track if we've emitted the guide-level completion event for this section
  const hasEmittedGuideCompletionRef = useRef(false);

  // Reset the emission flag when section becomes incomplete (e.g., after reset)
  useEffect(() => {
    if (!isCompleted) {
      hasEmittedGuideCompletionRef.current = false;
    }
  }, [isCompleted]);

  // Trigger reactive checks when section completion status changes
  useEffect(() => {
    if (isCompleted && stepComponents.length > 0) {
      // Notify dependent steps that this section is complete
      const completionEvent = new CustomEvent('section-completed', {
        detail: { sectionId },
      });
      document.dispatchEvent(completionEvent);

      // Emit guide-level completion event (for ContentRenderer tracking)
      // Only emit once per completion to avoid duplicate triggers
      if (!hasEmittedGuideCompletionRef.current) {
        hasEmittedGuideCompletionRef.current = true;
        window.dispatchEvent(
          new CustomEvent('interactive-section-completed', {
            detail: { sectionId },
          })
        );
      }

      // Trigger global reactive check to enable next eligible steps
      // Also trigger watchNextStep to help the next step unlock if it has requirements
      import('../../../requirements-manager').then(({ SequentialRequirementsManager }) => {
        SequentialRequirementsManager.getInstance().triggerReactiveCheck();
        SequentialRequirementsManager.getInstance().watchNextStep(3000); // Watch for 3 seconds
      });
    }
  }, [isCompleted, sectionId, stepComponents.length]);

  // PRE-COMPUTE eligibility for ALL steps once (React best practice)
  // This prevents expensive recalculation on every render
  const stepEligibility = useMemo(() => {
    return stepComponents.map((stepInfo, index) => {
      // First step is always eligible (Trust but Verify)
      if (index === 0) {
        return true;
      }

      // Subsequent steps are eligible if all previous steps are completed
      // Noop steps (informational only) are always considered "complete" for eligibility purposes
      // since they have no action to perform
      return stepComponents
        .slice(0, index)
        .every((prevStep) => prevStep.targetAction === 'noop' || completedSteps.has(prevStep.stepId));
    });
  }, [completedSteps, stepComponents]); // Only recalculate when these change

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
      // GUARD: Skip if already completed - prevents infinite loops when callbacks are
      // retriggered due to useCallback/useEffect dependency chains (R1, R2, R3)
      if (completedSteps.has(stepId)) {
        return;
      }

      if (!skipStateUpdate) {
        // Update state normally - React batches these automatically
        const newCompletedSteps = new Set([...completedSteps, stepId]);
        setCompletedSteps(newCompletedSteps);
        setCurrentlyExecutingStep(null);

        const currentIndex = stepComponents.findIndex((step) => step.stepId === stepId);
        if (currentIndex >= 0) {
          setCurrentStepIndex(currentIndex + 1);
        }

        persistCompletedSteps(newCompletedSteps);

        // React's reactive model handles eligibility updates automatically:
        // 1. State updates are batched and applied
        // 2. stepEligibility useMemo recalculates (triggered by completedSteps change)
        // 3. enhancedChildren useMemo updates (triggered by stepEligibility change)
        // 4. Child InteractiveStep receives new isEligibleForChecking prop
        // 5. useStepChecker's useEffect fires (triggered by isEligibleForChecking change)
        // 6. checkStep runs and next step unlocks

        // useSyncExternalStore ensures manager state stays in sync with React renders
        // No manual synchronization needed!

        // Emit step completion event for fallback guide completion tracking
        window.dispatchEvent(new CustomEvent('interactive-step-completed', { detail: { stepId, sectionId } }));

        // Check if all steps are completed
        const allStepsCompleted = newCompletedSteps.size >= stepComponents.length;
        if (allStepsCompleted) {
          onComplete?.();
          // Note: guide-level completion event is emitted by the useEffect
          // that watches isCompleted state to avoid duplicate emissions
        }
      } else {
        setCurrentlyExecutingStep(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [completedSteps, stepComponents, onComplete, persistCompletedSteps, sectionId]
  );

  /**
   * Handle individual step reset (redo functionality)
   * Removes the target step and all subsequent steps from completion state
   */
  const handleStepReset = useCallback(
    (stepId: string) => {
      // Find the index of the step being reset
      const resetIndex = stepComponents.findIndex((step) => step.stepId === stepId);

      // Update section state - only remove this step AND all subsequent steps
      setCompletedSteps((prev) => {
        const newSet = new Set(prev);

        // Remove the target step and all steps after it
        for (let i = resetIndex; i < stepComponents.length; i++) {
          const stepToRemove = stepComponents[i].stepId;
          newSet.delete(stepToRemove);
        }

        // Persist removal
        persistCompletedSteps(newSet);
        return newSet;
      });

      // Move currentStepIndex back to the reset step
      if (resetIndex >= 0 && resetIndex < currentStepIndex) {
        setCurrentStepIndex(resetIndex);
      }

      // Also clear currently executing step if it matches
      if (currentlyExecutingStep === stepId) {
        setCurrentlyExecutingStep(null);
      }

      // CRITICAL: Increment resetTrigger to notify all child steps to clear their local UI state
      // This ensures green checkmarks are cleared from the UI
      setResetTrigger((prev) => prev + 1);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            console.error(`Multi-step execution failed: ${stepInfo.stepId}`, error);
            return false;
          }
        } else {
          console.error(`Multi-step ref not found for: ${stepInfo.stepId}`);
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

        // Only run post-verification if explicitly specified
        // Don't use requirements as post-verification fallback since many actions
        // (like clicking navigation buttons) are expected to make the original element disappear
        if (stepInfo.postVerify && stepInfo.postVerify.trim() !== '') {
          const result = await verifyStepResult(
            stepInfo.postVerify,
            stepInfo.targetAction || 'button',
            stepInfo.refTarget || '',
            stepInfo.targetValue,
            stepInfo.stepId
          );
          if (!result.pass) {
            console.warn(`Post-verify failed for ${stepInfo.stepId}:`, result.error);
            return false;
          }
        }

        return true;
      } catch (error) {
        console.error(`Step execution failed: ${stepInfo.stepId}`, error);
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

    // Use currentStepIndex as the starting point - much more efficient!
    let startIndex = currentStepIndex;

    // If currentStepIndex is beyond the end, it means all steps are completed - reset for full re-run
    if (startIndex >= stepComponents.length) {
      setCompletedSteps(new Set());
      setCurrentStepIndex(0);
      startIndex = 0;
    }

    // Execute the section sequence using the extracted function
    await executeSectionSequence({
      // Step data
      stepComponents,
      sectionId,
      title: title || '',
      requirements,
      startIndex,

      // Interactive engine
      executeInteractiveAction,
      checkRequirementsFromData,
      startSectionBlocking,
      stopSectionBlocking,

      // Step execution
      executeStep,
      handleStepComplete,

      // Refs (imperative state)
      isCancelledRef,
      isProgrammaticScrollRef,
      userScrolledRef,
      stepRefs,

      // State setters
      setCompletedSteps,
      setCurrentlyExecutingStep,
      setExecutingStepNumber,
      setCurrentStepIndex,
      setIsRunning,

      // Scroll
      scrollToStep,

      // Persistence
      persistCompletedSteps,

      // Cancel handler
      handleSectionCancel,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    requirements,
    checkRequirementsFromData,
    persistCompletedSteps,
    scrollToStep,
  ]);

  /**
   * Handle complete section reset
   * Clears all completion state and resets all steps to initial state
   */
  const handleResetSection = useCallback(() => {
    if (disabled || isRunning) {
      return;
    }

    // Clear section state immediately
    setCompletedSteps(new Set());
    setCurrentlyExecutingStep(null);
    setCurrentStepIndex(0); // Reset to start from beginning

    // Expand the section if it was collapsed
    setIsCollapsed(false);

    // Reset the auto-collapse flag so it can auto-collapse again when completed
    hasAutoCollapsedRef.current = false;

    // Signal all child steps to reset their local state
    setResetTrigger((prev) => prev + 1);

    // Clear storage persistence
    const contentKey = getContentKey();
    interactiveStepStorage.clear(contentKey, sectionId);
    sectionCollapseStorage.clear(contentKey, sectionId); // Clear collapse state

    // Reset all step states in the global manager
    import('../../../requirements-manager').then(({ SequentialRequirementsManager }) => {
      const manager = SequentialRequirementsManager.getInstance();

      // Temporarily stop DOM monitoring during reset
      manager.stopDOMMonitoring();

      // Reset all step states including completion and skipped status
      stepComponents.forEach((step) => {
        manager.updateStep(step.stepId, {
          isEnabled: false,
          isCompleted: false,
          isChecking: false,
          isSkipped: false, // Clear skipped state on reset
          completionReason: 'none',
          explanation: undefined,
          error: undefined,
        });
      });

      // Re-enable monitoring and trigger check for first step after reset
      setTimeout(() => {
        manager.triggerReactiveCheck();
        setTimeout(() => {
          manager.startDOMMonitoring();
        }, 100);
      }, 200);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, isRunning, stepComponents, sectionId]);

  // Register this section's steps in the global registry BEFORE rendering children
  // This must happen in useMemo (not useEffect) to ensure totalDocumentSteps is correct
  // when getDocumentStepPosition is called during the enhancedChildren memo
  useMemo(() => {
    registerSectionSteps(sectionId, stepComponents.length);
  }, [sectionId, stepComponents.length]);

  // Expose current step context globally for analytics (when section is active)
  useEffect(() => {
    try {
      // Set total steps for the entire document
      (window as any).__DocsPluginTotalSteps = getTotalDocumentSteps();

      // Set current step index based on section execution state
      if (currentlyExecutingStep) {
        const executingStepInfo = stepComponents.find((s) => s.stepId === currentlyExecutingStep);
        if (executingStepInfo) {
          const { stepIndex: documentStepIndex } = getDocumentStepPosition(sectionId, executingStepInfo.index);
          (window as any).__DocsPluginCurrentStepIndex = documentStepIndex;
        }
      }
    } catch {
      // no-op
    }
  }, [currentlyExecutingStep, stepComponents, sectionId]);

  // Render enhanced children with coordination props
  const enhancedChildren = useMemo(() => {
    return enhanceChildren({
      children,
      stepComponents,
      stepEligibility,
      completedSteps,
      currentlyExecutingStep,
      sectionId,
      title: title || '',
      disabled,
      isRunning,
      resetTrigger,
      sectionRequirementsPassed: sectionRequirementsStatus.passed,
      handleStepComplete,
      handleStepReset,
      stepRefs,
      multiStepRefs,
    });
  }, [
    children,
    stepComponents,
    stepEligibility, // Pre-computed array instead of callback
    completedSteps, // This should trigger re-render when completedSteps changes
    currentlyExecutingStep,
    handleStepComplete,
    handleStepReset,
    disabled,
    isRunning,
    resetTrigger,
    sectionId,
    title,
    sectionRequirementsStatus.passed, // Section requirements gate child steps
  ]);

  return (
    <div
      id={sectionId}
      className={`interactive-section${className ? ` ${className}` : ''}${isCompleted ? ' completed' : ''}${
        isCollapsed ? ' collapsed' : ''
      }`}
      data-testid={testIds.interactive.section(sectionId)}
      data-interactive-section="true"
    >
      <div className={`interactive-section-header${isCollapsed ? ' collapsed' : ''}`}>
        {/* Show collapse toggle when completed OR when in preview mode (for guide authors) */}
        {(isCompleted || isPreviewMode) && (
          <button
            className="interactive-section-toggle-button"
            onClick={toggleCollapse}
            type="button"
            title={isCollapsed ? 'Expand section' : 'Collapse section'}
            aria-label={isCollapsed ? 'Expand section' : 'Collapse section'}
          >
            <span className="interactive-section-toggle-icon">{isCollapsed ? '▶' : '▼'}</span>
          </button>
        )}
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

      {!isCollapsed && description && <div className="interactive-section-description">{description}</div>}

      {/* Section requirements status banner */}
      {!isCollapsed && requirements && !sectionRequirementsStatus.passed && (
        <div className="interactive-section-requirements-banner">
          <span className="interactive-section-requirements-icon">🔒</span>
          <span className="interactive-section-requirements-message">Requirements not yet met</span>
        </div>
      )}

      {!isCollapsed && <ol className="interactive-section-content">{enhancedChildren}</ol>}

      <div className={`interactive-section-actions${isCollapsed ? ' collapsed' : ''}`}>
        {isCollapsed ? (
          <Button
            onClick={handleResetSection}
            disabled={disabled || isRunning || isCompletedByObjectives}
            size="sm"
            variant="secondary"
            className="interactive-section-reset-button"
            data-testid={testIds.interactive.resetSectionButton(sectionId)}
            title="Reset section and clear all step completion"
          >
            Reset Section
          </Button>
        ) : isRunning ? (
          /* Running state - show progress bar and status */
          <div className="interactive-guided-executing">
            <div className="interactive-guided-step-indicator">
              <span className="interactive-guided-step-badge">
                Step {executingStepNumber || 1} of {stepComponents.length}
              </span>
            </div>
            <div className="interactive-guided-instruction">
              <span className="interactive-guided-instruction-icon">⚡</span>
              <span className="interactive-guided-instruction-text">Running step {executingStepNumber || 1}...</span>
            </div>
            <div className="interactive-guided-progress">
              <div
                className="interactive-guided-progress-fill"
                style={{ width: `${((executingStepNumber - 1) / stepComponents.length) * 100}%` }}
              />
              <div
                className="interactive-guided-progress-active"
                style={{
                  left: `${((executingStepNumber - 1) / stepComponents.length) * 100}%`,
                  width: `${(1 / stepComponents.length) * 100}%`,
                }}
              />
            </div>
            <Button
              onClick={handleSectionCancel}
              disabled={disabled}
              size="sm"
              variant="secondary"
              className="interactive-guided-cancel-btn"
              title="Cancel section execution"
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            onClick={stepsCompleted && !isCompletedByObjectives ? handleResetSection : handleDoSection}
            disabled={
              disabled || !sectionRequirementsStatus.passed || stepComponents.length === 0 || isCompletedByObjectives
            }
            size="md"
            variant={isCompleted ? 'secondary' : 'primary'}
            className="interactive-section-do-button"
            data-testid={
              stepsCompleted && !isCompletedByObjectives
                ? testIds.interactive.resetSectionButton(sectionId)
                : testIds.interactive.doSectionButton(sectionId)
            }
            title={(() => {
              const resumeInfo = getResumeInfo();
              if (isCompletedByObjectives) {
                return 'Already done!';
              }
              if (stepsCompleted && !isCompletedByObjectives) {
                return 'Reset section and clear all step completion to allow manual re-interaction';
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
                return 'Reset section';
              }
              if (resumeInfo.isResume) {
                return `▶ Resume (${resumeInfo.remainingSteps} steps)`;
              }
              return `▶ Do Section (${stepComponents.length} steps)`;
            })()}
          </Button>
        )}
      </div>
    </div>
  );
}
