import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Button } from '@grafana/ui';
import { usePluginContext } from '@grafana/data';

import { useInteractiveElements, ActionMonitor } from '../../../interactive-engine';
import { useStepChecker } from '../../../requirements-manager';
import { InteractiveStep } from './interactive-step';
import { InteractiveMultiStep } from './interactive-multi-step';
import { InteractiveGuided } from './interactive-guided';
import { InteractiveQuiz } from './interactive-quiz';
import { reportAppInteraction, UserInteraction, getSourceDocument } from '../../../lib/analytics';
import { interactiveStepStorage, sectionCollapseStorage } from '../../../lib/user-storage';
import { INTERACTIVE_CONFIG, getInteractiveConfig } from '../../../constants/interactive-config';
import { getConfigWithDefaults } from '../../../constants';
import type { InteractiveStepProps, InteractiveSectionProps, StepInfo } from '../../../types/component-props.types';
import { testIds } from '../../../components/testIds';

// Simple counter for sequential section IDs
let interactiveSectionCounter = 0;

// Global registry to track all steps across all sections in the document
const globalStepRegistry: Map<string, number> = new Map(); // sectionId -> number of steps
let totalDocumentSteps = 0;
let documentStepOffsets: Map<string, number> = new Map(); // sectionId -> starting offset

// Function to reset counters (can be called when new content loads)
export function resetInteractiveCounters() {
  interactiveSectionCounter = 0;
  globalStepRegistry.clear();
  totalDocumentSteps = 0;
  documentStepOffsets.clear();
}

// Register a section's steps in the global registry (idempotent)
function registerSectionSteps(sectionId: string, stepCount: number): { offset: number; total: number } {
  // Update this section's step count
  globalStepRegistry.set(sectionId, stepCount);

  // Recalculate total and offsets from scratch to ensure consistency
  // This handles re-registration (re-renders) and multiple sections correctly
  // Use Map's insertion order (document order) instead of sorting alphabetically
  let runningTotal = 0;

  for (const [secId, count] of globalStepRegistry.entries()) {
    documentStepOffsets.set(secId, runningTotal);
    runningTotal += count;
  }

  totalDocumentSteps = runningTotal;

  // Return this section's offset and the new total
  const offset = documentStepOffsets.get(sectionId) || 0;
  return { offset, total: totalDocumentSteps };
}

// Get document-wide position for a step within a section
function getDocumentStepPosition(
  sectionId: string,
  sectionStepIndex: number
): { stepIndex: number; totalSteps: number } {
  const offset = documentStepOffsets.get(sectionId) || 0;
  return {
    stepIndex: offset + sectionStepIndex,
    totalSteps: totalDocumentSteps,
  };
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
  const [executingStepNumber, setExecutingStepNumber] = useState(0); // Track which step is being executed (1-indexed for display)
  const [resetTrigger, setResetTrigger] = useState(0); // Trigger to reset child steps
  const [isCollapsed, setIsCollapsed] = useState(false); // Collapse state for completed sections

  // Track if user has manually scrolled to avoid fighting with auto-scroll
  const userScrolledRef = useRef(false);
  // Track if we're currently doing a programmatic scroll (to ignore it in listener)
  const isProgrammaticScrollRef = useRef(false);

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

  // Persist completed steps using new user storage system
  const persistCompletedSteps = useCallback(
    (ids: Set<string>) => {
      const contentKey = getContentKey();
      interactiveStepStorage.setCompleted(contentKey, sectionId, ids);
    },
    [getContentKey, sectionId]
  );

  // Toggle collapse state and persist to storage
  const toggleCollapse = useCallback(() => {
    const newCollapseState = !isCollapsed;
    setIsCollapsed(newCollapseState);
    const contentKey = getContentKey();
    sectionCollapseStorage.set(contentKey, sectionId, newCollapseState);
  }, [isCollapsed, getContentKey, sectionId]);

  // Restore collapse state from storage on mount
  useEffect(() => {
    const restoreCollapseState = async () => {
      const contentKey = getContentKey();
      const savedCollapseState = await sectionCollapseStorage.get(contentKey, sectionId);
      setIsCollapsed(savedCollapseState);
    };
    restoreCollapseState();
  }, [getContentKey, sectionId]);

  // Use ref for cancellation to avoid closure issues
  const isCancelledRef = useRef(false);

  // Track if we've already auto-collapsed to prevent re-collapsing on manual expand
  const hasAutoCollapsedRef = useRef(false);

  // Track user scroll to disable auto-scroll for the rest of section execution
  useEffect(() => {
    if (!isRunning) {
      return;
    }

    // Target the docs panel scrollable container directly (inner-docs-content)
    const scrollContainer = document.getElementById('inner-docs-content');

    console.warn('[Section] Setting up scroll listener, container found:', !!scrollContainer);

    if (!scrollContainer) {
      console.warn('[Section] No scroll container found!');
      return;
    }

    const handleScroll = () => {
      console.warn(
        '[Section] Scroll event fired, isProgrammatic:',
        isProgrammaticScrollRef.current,
        'userScrolled:',
        userScrolledRef.current
      );
      // Ignore programmatic scrolls (our own auto-scroll)
      if (isProgrammaticScrollRef.current) {
        console.warn('[Section] Ignoring programmatic scroll');
        return;
      }
      console.warn('[Section] USER SCROLLED - disabling auto-scroll');
      userScrolledRef.current = true; // Permanently disable for this section run
    };

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll);
    };
  }, [isRunning]);

  // Auto-scroll to current executing step
  const scrollToStep = useCallback((stepId: string) => {
    console.warn('[Section] scrollToStep called for:', stepId, 'userScrolled:', userScrolledRef.current);
    if (userScrolledRef.current) {
      console.warn('[Section] Skipping scroll - user has scrolled');
      return; // User has scrolled, don't fight them
    }

    // Find the step element by data-step-id
    const stepElement = document.querySelector(`[data-step-id="${stepId}"]`);
    console.warn('[Section] Step element found:', !!stepElement);
    if (stepElement) {
      // isProgrammaticScrollRef is already true during section execution
      // so we don't need to set/reset it here
      stepElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, []);

  // Store refs to multistep components for section-level execution
  const multiStepRefs = useRef<Map<string, { executeStep: () => Promise<boolean> }>>(new Map());

  // Store refs to regular step components for skip functionality
  const stepRefs = useRef<Map<string, { executeStep: () => Promise<boolean>; markSkipped?: () => void }>>(new Map());

  // Get the interactive functions from the hook
  const {
    executeInteractiveAction,
    startSectionBlocking,
    stopSectionBlocking,
    verifyStepResult,
    checkRequirementsFromData,
  } = useInteractiveElements();

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
    // Track step index separately from child index to handle non-step children
    let stepIndex = 0;

    React.Children.forEach(children, (child) => {
      if (React.isValidElement(child) && (child as any).type === InteractiveStep) {
        const props = child.props as InteractiveStepProps;
        const stepId = `${sectionId}-step-${stepIndex + 1}`;

        steps.push({
          stepId,
          element: child as React.ReactElement<InteractiveStepProps>,
          index: stepIndex,
          targetAction: props.targetAction,
          refTarget: props.refTarget,
          targetValue: props.targetValue,
          targetComment: props.targetComment,
          requirements: props.requirements,
          postVerify: props.postVerify,
          skippable: props.skippable,
          showMe: props.showMe,
          isMultiStep: false,
          isGuided: false,
        });
        stepIndex++;
      } else if (React.isValidElement(child) && (child as any).type === InteractiveMultiStep) {
        const props = child.props as any; // InteractiveMultiStepProps
        const stepId = `${sectionId}-multistep-${stepIndex + 1}`;

        steps.push({
          stepId,
          element: child as React.ReactElement<any>,
          index: stepIndex,
          targetAction: undefined, // Multi-step handles internally
          refTarget: undefined,
          targetValue: undefined,
          requirements: props.requirements,
          skippable: props.skippable,
          isMultiStep: true,
          isGuided: false,
        });
        stepIndex++;
      } else if (React.isValidElement(child) && (child as any).type === InteractiveGuided) {
        const props = child.props as any; // InteractiveGuidedProps
        const stepId = `${sectionId}-guided-${stepIndex + 1}`;

        steps.push({
          stepId,
          element: child as React.ReactElement<any>,
          index: stepIndex,
          targetAction: undefined, // Guided handles internally
          refTarget: undefined,
          targetValue: undefined,
          requirements: props.requirements,
          skippable: props.skippable,
          isMultiStep: false,
          isGuided: true, // Mark as guided step
        });
        stepIndex++;
      } else if (React.isValidElement(child) && (child as any).type === InteractiveQuiz) {
        const props = child.props as any; // InteractiveQuizProps
        const stepId = `${sectionId}-quiz-${stepIndex + 1}`;

        steps.push({
          stepId,
          element: child as React.ReactElement<any>,
          index: stepIndex,
          targetAction: undefined, // Quiz handles internally
          refTarget: undefined,
          targetValue: undefined,
          requirements: props.requirements,
          skippable: props.skippable,
          isMultiStep: false,
          isGuided: false,
          isQuiz: true, // Mark as quiz step
        });
        stepIndex++;
      }
    });

    return steps;
  }, [children, sectionId]);

  // Load persisted completed steps on mount/section change (declared after stepComponents)
  useEffect(() => {
    const contentKey = getContentKey();

    interactiveStepStorage.getCompleted(contentKey, sectionId).then((restored) => {
      if (restored.size > 0) {
        // Only keep steps that exist in current content
        const validIds = new Set(stepComponents.map((s) => s.stepId));
        const filtered = Array.from(restored).filter((id) => validIds.has(id));
        if (filtered.length > 0) {
          const restoredSet = new Set(filtered);
          setCompletedSteps(restoredSet);
          // Move index to next uncompleted
          const nextIdx = stepComponents.findIndex((s) => !restoredSet.has(s.stepId));
          setCurrentStepIndex(nextIdx === -1 ? stepComponents.length : nextIdx);
        }
      }
    });
  }, [getContentKey, sectionId, stepComponents]);

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

  // Auto-collapse section when it becomes complete (but only once, don't override manual expansion)
  useEffect(() => {
    if (isCompleted && !hasAutoCollapsedRef.current) {
      hasAutoCollapsedRef.current = true;
      setIsCollapsed(true);
      const contentKey = getContentKey();
      sectionCollapseStorage.set(contentKey, sectionId, true);
    } else if (!isCompleted) {
      // Reset the flag when section becomes incomplete (e.g., after reset)
      hasAutoCollapsedRef.current = false;
    }
  }, [isCompleted, getContentKey, sectionId]);

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

  // Trigger reactive checks when section completion status changes
  useEffect(() => {
    if (isCompleted && stepComponents.length > 0) {
      // Notify dependent steps that this section is complete
      const completionEvent = new CustomEvent('section-completed', {
        detail: { sectionId },
      });
      document.dispatchEvent(completionEvent);

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
      return stepComponents.slice(0, index).every((prevStep) => completedSteps.has(prevStep.stepId));
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

        // Check if all steps are completed
        const allStepsCompleted = newCompletedSteps.size >= stepComponents.length;
        if (allStepsCompleted) {
          onComplete?.();
        }
      } else {
        setCurrentlyExecutingStep(null);
      }
    },
    [completedSteps, stepComponents, onComplete, persistCompletedSteps]
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

    // Track "Do Section" button click analytics
    const docInfo = getSourceDocument(sectionId);
    reportAppInteraction(UserInteraction.DoSectionButtonClick, {
      ...docInfo,
      content_type: 'interactive_guide',
      section_title: title,
      total_steps: stepComponents.length,
      interaction_location: 'interactive_section',
    });

    setIsRunning(true);
    setExecutingStepNumber(0); // Reset step counter
    userScrolledRef.current = false; // Reset user scroll tracking
    // Keep isProgrammaticScroll TRUE for entire section execution
    // This prevents step execution (button clicks, etc.) from triggering the cancel
    isProgrammaticScrollRef.current = true;
    console.warn(
      '[Section] Starting section run, reset userScrolled=false, isProgrammatic=TRUE (will stay true during execution)'
    );

    // Force-disable action monitor during section execution to prevent auto-completion conflicts
    // Using forceDisable() to bypass reference counting during automated execution
    const actionMonitor = ActionMonitor.getInstance();
    actionMonitor.forceDisable();

    // Clear any existing highlights before starting section execution
    const { NavigationManager } = await import('../../../interactive-engine');
    const navigationManager = new NavigationManager();
    navigationManager.clearAllHighlights();

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
      console.warn('[Section] Section finished, isProgrammaticScroll = false');
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
  }, [disabled, isRunning, getContentKey, stepComponents, sectionId]);

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
      (window as any).__DocsPluginTotalSteps = totalDocumentSteps;

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
    // Track step index separately from child index to handle non-step children
    let stepIndex = 0;

    return React.Children.map(children, (child) => {
      if (React.isValidElement(child) && (child as any).type === InteractiveStep) {
        const stepInfo = stepComponents[stepIndex];
        if (!stepInfo) {
          return child;
        }

        const isEligibleForChecking = stepEligibility[stepIndex];
        const isCompleted = completedSteps.has(stepInfo.stepId);
        const isCurrentlyExecuting = currentlyExecutingStep === stepInfo.stepId;

        // Get document-wide step position
        const { stepIndex: documentStepIndex, totalSteps: documentTotalSteps } = getDocumentStepPosition(
          sectionId,
          stepIndex
        );

        // Increment step index for next step child
        stepIndex++;

        // Enhanced step props with section coordination

        return React.cloneElement(child as React.ReactElement<InteractiveStepProps>, {
          ...child.props,
          stepId: stepInfo.stepId,
          isEligibleForChecking,
          isCompleted,
          isCurrentlyExecuting,
          onStepComplete: handleStepComplete,
          stepIndex: documentStepIndex, // 0-indexed position in ENTIRE DOCUMENT
          totalSteps: documentTotalSteps, // Total steps in ENTIRE DOCUMENT
          sectionId: sectionId, // Section identifier for analytics
          sectionTitle: title, // Section title for analytics
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
        const stepInfo = stepComponents[stepIndex];
        if (!stepInfo) {
          return child;
        }

        const isEligibleForChecking = stepEligibility[stepIndex];
        const isCompleted = completedSteps.has(stepInfo.stepId);
        const isCurrentlyExecuting = currentlyExecutingStep === stepInfo.stepId;

        // Get document-wide step position
        const { stepIndex: documentStepIndex, totalSteps: documentTotalSteps } = getDocumentStepPosition(
          sectionId,
          stepIndex
        );

        // Increment step index for next step child
        stepIndex++;

        return React.cloneElement(child as React.ReactElement<any>, {
          ...(child.props as any),
          stepId: stepInfo.stepId,
          isEligibleForChecking,
          isCompleted,
          isCurrentlyExecuting,
          onStepComplete: handleStepComplete,
          onStepReset: handleStepReset, // Add step reset callback
          stepIndex: documentStepIndex,
          totalSteps: documentTotalSteps,
          sectionId: sectionId,
          sectionTitle: title,
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
      } else if (React.isValidElement(child) && (child as any).type === InteractiveGuided) {
        const stepInfo = stepComponents[stepIndex];
        if (!stepInfo) {
          return child;
        }

        const isEligibleForChecking = stepEligibility[stepIndex];
        const isCompleted = completedSteps.has(stepInfo.stepId);
        const isCurrentlyExecuting = currentlyExecutingStep === stepInfo.stepId;

        // Get document-wide step position
        const { stepIndex: documentStepIndex, totalSteps: documentTotalSteps } = getDocumentStepPosition(
          sectionId,
          stepIndex
        );

        // Increment step index for next step child
        stepIndex++;

        return React.cloneElement(child as React.ReactElement<any>, {
          ...(child.props as any),
          stepId: stepInfo.stepId,
          isEligibleForChecking,
          isCompleted,
          isCurrentlyExecuting,
          onStepComplete: handleStepComplete,
          onStepReset: handleStepReset,
          stepIndex: documentStepIndex,
          totalSteps: documentTotalSteps,
          sectionId: sectionId,
          sectionTitle: title,
          disabled: disabled || (isRunning && !isCurrentlyExecuting), // Don't disable during section run
          resetTrigger,
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
      } else if (React.isValidElement(child) && (child as any).type === InteractiveQuiz) {
        const stepInfo = stepComponents[stepIndex];
        if (!stepInfo) {
          return child;
        }

        const isEligibleForChecking = stepEligibility[stepIndex];
        const isCompleted = completedSteps.has(stepInfo.stepId);

        // Increment step index for next step child
        stepIndex++;

        return React.cloneElement(child as React.ReactElement<any>, {
          ...(child.props as any),
          stepId: stepInfo.stepId,
          isEligibleForChecking,
          isCompleted,
          onStepComplete: handleStepComplete,
          disabled: disabled,
          resetTrigger,
          key: stepInfo.stepId,
        });
      }
      return child;
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
  ]);

  return (
    <div
      id={sectionId}
      className={`interactive-section${className ? ` ${className}` : ''}${isCompleted ? ' completed' : ''}${
        isCollapsed ? ' collapsed' : ''
      }`}
      data-testid={testIds.interactive.section(sectionId)}
    >
      <div className={`interactive-section-header${isCollapsed ? ' collapsed' : ''}`}>
        {isCompleted && (
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
            disabled={disabled || stepComponents.length === 0 || isCompletedByObjectives}
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
