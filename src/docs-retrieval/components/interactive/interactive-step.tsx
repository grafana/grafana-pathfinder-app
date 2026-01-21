import React, { useState, useCallback, forwardRef, useImperativeHandle, useEffect, useMemo, useRef } from 'react';
import { Button } from '@grafana/ui';

import {
  waitForReactUpdates,
  useStepChecker,
  getPostVerifyExplanation,
  checkPostconditions,
  validateInteractiveRequirements,
} from '../../../requirements-manager';
import { reportAppInteraction, UserInteraction, buildInteractiveStepProperties } from '../../../lib/analytics';
import type { InteractiveStepProps } from '../../../types/component-props.types';
import {
  type DetectedActionEvent,
  useInteractiveElements,
  useSingleActionDetection,
  useFormElementValidation,
  resolveTargetElement,
} from '../../../interactive-engine';
import { testIds } from '../../../components/testIds';
import { AssistantCustomizableProvider, useAssistantBlockValue } from '../../../integrations/assistant-integration';
import { CodeBlock } from '../docs/code-block';
import { scrollUntilElementFound, querySelectorAllEnhanced, resolveSelector, findButtonByText } from '../../../lib/dom';
import { isCssSelector } from '../../../lib/dom/selector-detector';

/**
 * Result type for lazy scroll execution wrapper
 */
interface LazyScrollResult {
  success: boolean;
  error?: string;
  elementFound: boolean;
}

/**
 * Wrapper that attempts lazy scroll discovery before executing an action.
 * If element exists, executes immediately. If not and lazyRender is enabled,
 * scrolls to find element first, then executes.
 *
 * @param refTarget - CSS selector for target element
 * @param lazyRender - Whether lazy scroll fallback is enabled
 * @param scrollContainer - CSS selector for scroll container
 * @param action - The action to execute once element is found
 * @returns Result indicating success/failure
 */
async function executeWithLazyScroll(
  refTarget: string,
  lazyRender: boolean,
  scrollContainer: string | undefined,
  action: () => Promise<void>,
  targetAction?: string
): Promise<LazyScrollResult> {
  // Navigate and noop actions don't target DOM elements - execute immediately without element checking
  if (targetAction === 'navigate' || targetAction === 'noop') {
    await action();
    return { success: true, elementFound: true };
  }

  // DOM-targeting actions: always check if element exists (provides user feedback if missing)
  // Resolve grafana: selectors
  const resolvedSelector = resolveSelector(refTarget);

  // Check if element exists
  // For button actions with text (not CSS selectors), use findButtonByText instead of querySelectorAllEnhanced
  let elementExists = false;

  if (targetAction === 'button' && !isCssSelector(refTarget)) {
    // Use text-based button matching (same as reftargetExistsCheck)
    const buttons = findButtonByText(refTarget);
    elementExists = buttons.length > 0;
  } else {
    // Use CSS selector matching for all other actions
    const existingResult = querySelectorAllEnhanced(resolvedSelector);
    elementExists = existingResult.elements.length > 0;
  }

  if (elementExists) {
    // Element found - execute action immediately
    await action();
    return { success: true, elementFound: true };
  }

  // Element not found - try lazy scroll discovery only if enabled
  if (lazyRender) {
    console.log(`[LazyScroll] Element not found, attempting scroll discovery: ${refTarget}`);
    const foundElement = await scrollUntilElementFound(refTarget, {
      scrollContainerSelector: scrollContainer,
    });

    if (foundElement) {
      // Element discovered after scroll - execute action
      await action();
      return { success: true, elementFound: true };
    }

    // Scroll completed but element still not found
    return {
      success: false,
      elementFound: false,
      error: 'Element not found after scrolling dashboard',
    };
  }

  // lazyRender not enabled and element not found - return clear error
  return {
    success: false,
    elementFound: false,
    error: `Element not found: ${refTarget}`,
  };
}

/**
 * Map datasource type to syntax highlighting language
 */
const mapDatasourceTypeToLanguage = (datasourceType: string | null): string => {
  if (!datasourceType) {
    return 'promql'; // Default fallback
  }

  const typeMapping: Record<string, string> = {
    prometheus: 'promql',
    loki: 'logql',
    tempo: 'traceql',
    pyroscope: 'text', // No specific language for Pyroscope
    // Add Amazon Managed variants
    'amazon-managed-prometheus': 'promql',
    'grafana-amazonprometheus-datasource': 'promql',
  };

  return typeMapping[datasourceType.toLowerCase()] || 'promql';
};

let anonymousStepCounter = 0;

export const InteractiveStep = forwardRef<
  { executeStep: () => Promise<boolean>; markSkipped?: () => void },
  InteractiveStepProps
>(
  (
    {
      targetAction,
      refTarget,
      targetValue,
      targetComment,
      postVerify,
      doIt = true, // Default to true - show "Do it" button unless explicitly disabled
      showMe = true, // Default to true - show "Show me" button unless explicitly disabled
      skippable = false, // Default to false - only skippable if explicitly set
      completeEarly = false, // Default to false - only mark early if explicitly set
      formHint, // Hint shown when form validation fails (for formfill with regex patterns)
      validateInput = false, // Default to false - only validate form input if explicitly enabled
      lazyRender = false, // Default to false - only enable progressive scroll discovery if explicitly set
      scrollContainer, // CSS selector for scroll container when lazyRender is enabled
      showMeText,
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
      onStepReset, // New callback for individual step reset

      // Step position tracking for analytics
      stepIndex,
      totalSteps,
      sectionId,
      sectionTitle,
    },
    ref
  ) => {
    const generatedStepIdRef = useRef<string | undefined>(undefined);
    if (!generatedStepIdRef.current) {
      anonymousStepCounter += 1;
      generatedStepIdRef.current = `standalone-step-${anonymousStepCounter}`;
    }
    const renderedStepId = stepId ?? generatedStepIdRef.current;
    const analyticsStepMeta = useMemo(
      () => ({
        stepId: stepId ?? renderedStepId,
        stepIndex,
        totalSteps,
        sectionId,
        sectionTitle,
      }),
      [stepId, renderedStepId, stepIndex, totalSteps, sectionId, sectionTitle]
    );

    // Local UI state
    const [isLocallyCompleted, setIsLocallyCompleted] = useState(false);
    const [isShowRunning, setIsShowRunning] = useState(false);
    const [isDoRunning, setIsDoRunning] = useState(false);
    const [postVerifyError, setPostVerifyError] = useState<string | null>(null);
    const [lazyScrollError, setLazyScrollError] = useState<string | null>(null);
    const [lastAttemptedAction, setLastAttemptedAction] = useState<'show' | 'do' | null>(null);

    // Check for customized value from parent AssistantBlockWrapper context
    const assistantBlockValue = useAssistantBlockValue();

    // Manage targetValue as state to support assistant customization
    // Use customized value from block wrapper context if available, otherwise use prop
    const [currentTargetValue, setCurrentTargetValue] = useState(assistantBlockValue?.customizedValue ?? targetValue);

    // Update currentTargetValue when assistant block value changes
    useEffect(() => {
      if (assistantBlockValue?.customizedValue !== null && assistantBlockValue?.customizedValue !== undefined) {
        setCurrentTargetValue(assistantBlockValue.customizedValue);
      } else if (assistantBlockValue?.customizedValue === null) {
        // Revert to original value when customization is cleared
        setCurrentTargetValue(targetValue);
      }
    }, [assistantBlockValue?.customizedValue, targetValue]);

    // Update targetValue callback for AssistantCustomizable children
    const updateTargetValue = useCallback((newValue: string) => {
      setCurrentTargetValue(newValue);
    }, []);

    // Combined completion state (parent takes precedence for coordination)
    const isCompleted = parentCompleted || isLocallyCompleted;

    // Runtime validation: check for impossible requirement configurations
    useEffect(() => {
      validateInteractiveRequirements(
        {
          requirements,
          refTarget,
          stepId: renderedStepId,
        },
        'InteractiveStep'
      );
    }, [requirements, refTarget, renderedStepId]);

    // Get the interactive functions from the hook
    const { executeInteractiveAction, verifyStepResult } = useInteractiveElements();

    // For section steps, use a simplified checker that respects section authority
    // For standalone steps, use the full global checker
    const isPartOfSection = renderedStepId.includes('section-') && renderedStepId.includes('-step-');

    const checker = useStepChecker({
      requirements,
      hints,
      targetAction,
      refTarget,
      stepId: stepId || renderedStepId, // Fallback if no stepId provided
      isEligibleForChecking: isPartOfSection ? isEligibleForChecking : isEligibleForChecking && !isCompleted,
      skippable,
      stepIndex, // Pass document-wide step index for sequence awareness
      lazyRender, // Enable progressive scroll discovery for virtualized containers
      scrollContainer, // CSS selector for scroll container
    });

    // Combined completion state: objectives always win, skipped also counts as completed (clarification 1, 2)
    const isCompletedWithObjectives =
      parentCompleted ||
      isLocallyCompleted ||
      checker.completionReason === 'objectives' ||
      checker.completionReason === 'skipped';

    // Determine if step should show action buttons
    // Section steps require both eligibility AND requirements to be met
    // When lazyRender is enabled, allow buttons even if element isn't found yet (lazy scroll fallback)
    const lazyScrollAvailable = lazyRender && checker.fixType === 'lazy-scroll';
    // FIX: Include lazyScrollAvailable in section step calculation to enable buttons
    // when element isn't visible yet but lazy scroll discovery is available
    const finalIsEnabled = isPartOfSection
      ? isEligibleForChecking &&
        !isCompleted &&
        (checker.isEnabled || lazyScrollAvailable) &&
        checker.completionReason !== 'objectives'
      : checker.isEnabled || lazyScrollAvailable;

    // Determine when to show explanation text and what text to show
    // Don't show blocking explanation when lazy scroll fallback is available
    // For lazyRender steps, hide explanation to let user click "Show me" button instead
    // For noop actions (informational steps), never block with "Complete previous step" - users should always be able to read the content
    const isNoopAction = targetAction === 'noop';

    // Auto-complete noop steps when they become eligible
    // Noop steps are informational only - they should auto-complete so they don't block subsequent steps
    // We deliberately don't check isCompleted here - noop steps should always notify the parent
    // when eligible, even if they were previously "completed". This handles the case where
    // a previous step is reset and re-completed.
    useEffect(() => {
      if (isNoopAction && isEligibleForChecking && !disabled) {
        // Notify parent section of completion (idempotent - section ignores if already complete)
        if (onStepComplete && stepId) {
          onStepComplete(stepId);
        }

        // Call the original onComplete callback if provided
        if (onComplete) {
          onComplete();
        }
      }
    }, [isNoopAction, isEligibleForChecking, disabled, stepId, onStepComplete, onComplete]);

    const shouldShowExplanation = isPartOfSection
      ? !isNoopAction &&
        (!isEligibleForChecking ||
          (isEligibleForChecking && requirements && !checker.isEnabled && !lazyScrollAvailable))
      : !checker.isEnabled && !lazyScrollAvailable;

    // Choose appropriate explanation text based on step state
    const explanationText = isPartOfSection
      ? !isEligibleForChecking
        ? 'Complete previous step'
        : checker.explanation
      : checker.explanation;

    // ============================================================================
    // FORM VALIDATION (for formfill actions with regex pattern support)
    // ============================================================================

    // Resolve the target element for monitoring
    const formTargetElement = useMemo(() => {
      if (targetAction !== 'formfill' || !refTarget) {
        return null;
      }
      return resolveTargetElement({ targetAction, refTarget, targetValue: currentTargetValue });
    }, [targetAction, refTarget, currentTargetValue]);

    // Handle form validation completion
    const handleFormValidationComplete = useCallback(() => {
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
    }, [stepId, onStepComplete, onComplete]);

    // Strip @@CLEAR@@ prefix from expected value for form validation
    // This prefix is a command to clear the form before filling, not part of the expected value
    const expectedValueForValidation = useMemo(() => {
      if (!currentTargetValue) {
        return currentTargetValue;
      }
      return currentTargetValue.replace(/^@@CLEAR@@\s*/, '');
    }, [currentTargetValue]);

    // Use form validation hook for formfill actions
    // Only enabled when validateInput is explicitly set to true
    const formValidation = useFormElementValidation(formTargetElement, {
      expectedValue: expectedValueForValidation,
      formHint,
      enabled:
        targetAction === 'formfill' &&
        validateInput === true &&
        finalIsEnabled &&
        !isCompletedWithObjectives &&
        !disabled,
      onValid: handleFormValidationComplete,
    });

    // Handle reset trigger from parent section
    useEffect(() => {
      if (resetTrigger && resetTrigger > 0) {
        // Reset local completion state
        setIsLocallyCompleted(false);
        setPostVerifyError(null);

        // Reset step checker state including skipped status
        if (checker.resetStep) {
          checker.resetStep();
        }
      }
    }, [resetTrigger, stepId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Execution logic (shared between individual and sequence execution)
    const executeStep = useCallback(async (): Promise<boolean> => {
      if (!finalIsEnabled || isCompletedWithObjectives || disabled) {
        return false;
      }

      try {
        // NEW: If completeEarly flag is set, mark as completed BEFORE action execution
        if (completeEarly) {
          setIsLocallyCompleted(true);
          if (onStepComplete && stepId) {
            onStepComplete(stepId);
          }
          if (onComplete) {
            onComplete();
          }

          // Small delay to ensure localStorage write completes
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        // Execute the action using existing interactive logic
        await executeInteractiveAction(targetAction, refTarget, currentTargetValue, 'do', targetComment);

        // Wait for DOM to settle after action (especially important for navigation, form fills, etc.)
        await waitForReactUpdates();

        // Additional settling time for actions that trigger animations or async state updates
        await new Promise((resolve) => setTimeout(resolve, 300));

        // Run post-verification if specified by author
        if (postVerify && postVerify.trim() !== '') {
          // Additional wait before verification to ensure all side effects have completed
          await waitForReactUpdates();

          const result = await verifyStepResult(
            postVerify,
            targetAction,
            refTarget || '',
            currentTargetValue,
            stepId || renderedStepId
          );
          if (!result.pass) {
            const friendly = getPostVerifyExplanation(
              postVerify,
              result.error
                ?.map((e) => e.error)
                .filter(Boolean)
                .join(', ')
            );
            setPostVerifyError(friendly || 'Verification failed.');

            return false;
          }
        }

        // NEW: If NOT completeEarly, mark complete after action (normal flow)
        if (!completeEarly) {
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
        }

        return true;
      } catch (error) {
        console.error(`Step execution failed: ${stepId}`, error);
        setPostVerifyError(error instanceof Error ? error.message : 'Execution failed');
        return false;
      }
    }, [
      finalIsEnabled,
      isCompletedWithObjectives,
      disabled,
      completeEarly,
      stepId,
      targetAction,
      refTarget,
      currentTargetValue,
      targetComment,
      postVerify,
      verifyStepResult,
      executeInteractiveAction,
      onStepComplete,
      onComplete,
      renderedStepId,
    ]);

    // Expose execute method for parent (sequence execution)
    useImperativeHandle(
      ref,
      () => ({
        executeStep,
        markSkipped: skippable && checker.markSkipped ? checker.markSkipped : undefined,
      }),
      [executeStep, skippable, checker.markSkipped]
    );

    // Auto-detection: Use shared hook for detecting user actions
    // Handler for auto-detected action match
    const handleAutoDetectedMatch = useCallback(
      async (detectedAction: DetectedActionEvent) => {
        // Run post-verification if specified (same as "Do it" button)
        if (postVerify && postVerify.trim() !== '') {
          try {
            const result = await checkPostconditions({
              requirements: postVerify,
              targetAction,
              refTarget,
              targetValue: currentTargetValue,
              stepId: stepId || renderedStepId,
            });

            if (!result.pass) {
              // Verification failed - don't auto-complete
              // Track failure in analytics
              reportAppInteraction(
                UserInteraction.StepAutoCompleteFailed,
                buildInteractiveStepProperties(
                  {
                    target_action: targetAction,
                    ref_target: refTarget,
                    interaction_location: 'interactive_step_auto',
                    failure_reason: 'post_verification_failed',
                  },
                  analyticsStepMeta
                )
              );
              return;
            }
          } catch (error) {
            // Verification error - don't auto-complete
            // Track failure in analytics
            reportAppInteraction(
              UserInteraction.StepAutoCompleteFailed,
              buildInteractiveStepProperties(
                {
                  target_action: targetAction,
                  ref_target: refTarget,
                  interaction_location: 'interactive_step_auto',
                  failure_reason: 'post_verification_error',
                },
                analyticsStepMeta
              )
            );
            return;
          }
        }

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

        // Track auto-completion in analytics
        reportAppInteraction(
          UserInteraction.StepAutoCompleted,
          buildInteractiveStepProperties(
            {
              target_action: targetAction,
              ref_target: refTarget,
              ...(currentTargetValue && { target_value: currentTargetValue }),
              interaction_location: 'interactive_step_auto',
              completion_method: 'auto_detected',
            },
            analyticsStepMeta
          )
        );
      },
      [
        postVerify,
        targetAction,
        refTarget,
        currentTargetValue,
        stepId,
        renderedStepId,
        onStepComplete,
        onComplete,
        analyticsStepMeta,
      ]
    );

    // Use the shared auto-detection hook
    useSingleActionDetection({
      targetAction,
      refTarget,
      targetValue: currentTargetValue,
      isEnabled: finalIsEnabled,
      isCompleted: isCompletedWithObjectives,
      isExecuting: isCurrentlyExecuting,
      disabled,
      onMatch: handleAutoDetectedMatch,
    });

    // Handle individual "Show me" action
    const handleShowAction = useCallback(async () => {
      if (disabled || isShowRunning || isCompletedWithObjectives || !finalIsEnabled) {
        return;
      }

      // Clear any previous lazy scroll error and track this action for retry
      setLazyScrollError(null);
      setLastAttemptedAction('show');

      // Track "Show me" button click analytics
      reportAppInteraction(
        UserInteraction.ShowMeButtonClick,
        buildInteractiveStepProperties(
          {
            target_action: targetAction,
            ref_target: refTarget,
            ...(currentTargetValue && { target_value: currentTargetValue }),
            interaction_location: 'interactive_step',
          },
          analyticsStepMeta
        )
      );

      setIsShowRunning(true);
      try {
        // Use lazy scroll wrapper to ensure element is found before executing
        const result = await executeWithLazyScroll(
          refTarget,
          lazyRender,
          scrollContainer,
          async () => {
            await executeInteractiveAction(targetAction, refTarget, currentTargetValue, 'show', targetComment);
          },
          targetAction
        );

        if (!result.success) {
          // Lazy scroll failed to find element
          setLazyScrollError(result.error || 'Element not found');
          return;
        }

        // If doIt is false, mark as completed after showing (like the old highlight-only behavior)
        if (!doIt) {
          setIsLocallyCompleted(true);

          // Notify parent if we have the callback (section coordination)
          if (onStepComplete && stepId) {
            onStepComplete(stepId);
          }

          // Call the original onComplete callback if provided
          if (onComplete) {
            onComplete();
          }
        }
      } catch (error) {
        console.error('Interactive show action failed:', error);
        setLazyScrollError(error instanceof Error ? error.message : 'Action failed');
      } finally {
        setIsShowRunning(false);
      }
    }, [
      targetAction,
      refTarget,
      currentTargetValue,
      targetComment,
      doIt,
      disabled,
      isShowRunning,
      isCompletedWithObjectives,
      finalIsEnabled,
      lazyRender,
      scrollContainer,
      executeInteractiveAction,
      onStepComplete,
      onComplete,
      stepId,
      analyticsStepMeta,
    ]);

    // Handle individual "Do it" action (delegates to executeStep)
    const handleDoAction = useCallback(async () => {
      if (disabled || isDoRunning || isCompletedWithObjectives || !finalIsEnabled) {
        return;
      }

      // Clear any previous lazy scroll error and track this action for retry
      setLazyScrollError(null);
      setLastAttemptedAction('do');

      // Track "Do it" button click analytics
      reportAppInteraction(
        UserInteraction.DoItButtonClick,
        buildInteractiveStepProperties(
          {
            target_action: targetAction,
            ref_target: refTarget,
            ...(currentTargetValue && { target_value: currentTargetValue }),
            interaction_location: 'interactive_step',
          },
          analyticsStepMeta
        )
      );

      setIsDoRunning(true);
      try {
        // Use lazy scroll wrapper to ensure element is found before executing
        const result = await executeWithLazyScroll(
          refTarget,
          lazyRender,
          scrollContainer,
          async () => {
            await executeStep();
          },
          targetAction
        );

        if (!result.success) {
          // Lazy scroll failed to find element
          setLazyScrollError(result.error || 'Element not found');
        }
      } catch (error) {
        console.error('Interactive do action failed:', error);
        setLazyScrollError(error instanceof Error ? error.message : 'Action failed');
      } finally {
        setIsDoRunning(false);
      }
    }, [
      disabled,
      isDoRunning,
      isCompletedWithObjectives,
      finalIsEnabled,
      lazyRender,
      scrollContainer,
      refTarget,
      executeStep,
      targetAction,
      currentTargetValue,
      analyticsStepMeta,
    ]);

    // Handle individual step reset (redo functionality)
    const handleStepRedo = useCallback(async () => {
      if (disabled || isDoRunning || isShowRunning) {
        return;
      }

      // Reset local completion state
      setIsLocallyCompleted(false);
      setPostVerifyError(null);

      // Reset skipped state if the checker has a reset function
      if (checker.resetStep) {
        checker.resetStep();
      }

      // Notify parent section to remove from completed steps
      // The section is the authoritative source - it will update its state
      // and the eligibility will be recalculated on the next render
      if (onStepReset && stepId) {
        onStepReset(stepId);
      }
      // No need for complex timing logic - the section's getStepEligibility
      // will use the updated completedSteps state on the next render
    }, [disabled, isDoRunning, isShowRunning, stepId, onStepReset]); // eslint-disable-line react-hooks/exhaustive-deps
    // Intentionally excluding to prevent circular dependencies:
    // - setIsLocallyCompleted, setPostVerifyError: stable React setters
    // - checker.resetStep: including 'checker' would cause infinite re-creation since checker depends on component state

    // Handle retry for lazy scroll failures
    const handleLazyScrollRetry = useCallback(() => {
      setLazyScrollError(null);
      // Re-attempt the last action
      if (lastAttemptedAction === 'show') {
        handleShowAction();
      } else if (lastAttemptedAction === 'do') {
        handleDoAction();
      }
    }, [lastAttemptedAction, handleShowAction, handleDoAction]);

    const getActionDescription = () => {
      switch (targetAction) {
        case 'button':
          return `Click "${refTarget}"`;
        case 'highlight':
          return `Highlight element`;
        case 'formfill':
          return `Fill form with "${currentTargetValue || 'value'}"`;
        case 'navigate':
          return `Navigate to ${refTarget}`;
        case 'hover':
          return `Hover over element`;
        case 'sequence':
          return `Run sequence`;
        case 'noop':
          return `Instructional step`;
        default:
          return targetAction;
      }
    };

    const isAnyActionRunning = isShowRunning || isDoRunning || isCurrentlyExecuting;

    // Don't apply completed/skipped styles to noop actions - they're informational only
    const completedClass =
      isCompletedWithObjectives && !isNoopAction
        ? checker.completionReason === 'skipped'
          ? ' skipped'
          : ' completed'
        : '';

    return (
      <div
        className={`interactive-step${className ? ` ${className}` : ''}${completedClass}${isCurrentlyExecuting ? ' executing' : ''}`}
        data-targetaction={targetAction}
        data-reftarget={refTarget}
        data-targetvalue={currentTargetValue}
        data-targetcomment={targetComment}
        data-step-id={stepId || renderedStepId}
        data-testid={testIds.interactive.step(renderedStepId)}
      >
        <div className="interactive-step-content">
          {title && <div className="interactive-step-title">{title}</div>}
          {description && <div className="interactive-step-description">{description}</div>}
          {/* When assistant has customized the value, show the customized query instead of original children */}
          {assistantBlockValue?.customizedValue ? (
            <div className="interactive-step-customized-content">
              <CodeBlock
                code={assistantBlockValue.customizedValue.replace(/^@@CLEAR@@\s*/, '')}
                language={mapDatasourceTypeToLanguage(assistantBlockValue.datasourceType)}
                showCopy={true}
              />
            </div>
          ) : (
            <AssistantCustomizableProvider updateTargetValue={updateTargetValue}>
              {children}
            </AssistantCustomizableProvider>
          )}
        </div>

        <div className="interactive-step-actions">
          <div className="interactive-step-action-buttons">
            {/* Only show "Show me" button when showMe prop is true AND step is enabled AND not a navigate/noop action */}
            {/* Navigate actions don't have a sensible "show me" behavior - it's "go there" or nothing */}
            {/* Noop actions are informational only - no buttons needed */}
            {showMe && !isNoopAction && targetAction !== 'navigate' && !isCompletedWithObjectives && finalIsEnabled && (
              <Button
                onClick={handleShowAction}
                disabled={disabled || isAnyActionRunning || (checker.isChecking && !lazyScrollAvailable)}
                size="sm"
                variant="secondary"
                className="interactive-step-show-btn"
                data-testid={testIds.interactive.showMeButton(renderedStepId)}
                title={hints || `${showMeText ? `${showMeText}:` : 'Show me:'} ${getActionDescription()}`}
              >
                {isShowRunning ? 'Showing...' : showMeText || 'Show me'}
              </Button>
            )}

            {/* Only show "Do it" button when doIt prop is true AND not a noop action */}
            {/* Noop actions are informational only - no buttons needed */}
            {doIt &&
              !isNoopAction &&
              !isCompletedWithObjectives &&
              (finalIsEnabled || checker.completionReason === 'objectives') && (
                <Button
                  onClick={handleDoAction}
                  disabled={
                    disabled ||
                    isAnyActionRunning ||
                    (checker.isChecking && !lazyScrollAvailable) ||
                    (!finalIsEnabled && checker.completionReason !== 'objectives')
                  }
                  size="sm"
                  variant="primary"
                  className="interactive-step-do-btn"
                  data-testid={testIds.interactive.doItButton(renderedStepId)}
                  title={
                    hints ||
                    (targetAction === 'navigate'
                      ? `Go there: ${getActionDescription()}`
                      : `Do it: ${getActionDescription()}`)
                  }
                >
                  {isDoRunning || isCurrentlyExecuting
                    ? targetAction === 'navigate'
                      ? 'Going...'
                      : 'Executing...'
                    : targetAction === 'navigate'
                      ? 'Go there'
                      : 'Do it'}
                </Button>
              )}

            {/* Show "Skip" button when step is skippable (always available, not just on error) */}
            {/* Noop actions don't need skip - they're just informational */}
            {skippable && !isNoopAction && !isCompletedWithObjectives && (
              <Button
                onClick={async () => {
                  if (checker.markSkipped) {
                    await checker.markSkipped();

                    // Notify parent section of step completion (skipped counts as completed)
                    if (onStepComplete && stepId) {
                      onStepComplete(stepId);
                    }

                    if (onComplete) {
                      onComplete();
                    }
                  }
                }}
                disabled={disabled || isAnyActionRunning}
                size="sm"
                variant="secondary"
                className="interactive-step-skip-btn"
                data-testid={testIds.interactive.skipButton(renderedStepId)}
                title="Skip this step without executing"
              >
                Skip
              </Button>
            )}
          </div>

          {/* Hide completed badge and redo button for noop actions - they're informational only */}
          {isCompletedWithObjectives && !isNoopAction && (
            <div className="interactive-guided-completed">
              <div className="interactive-guided-completed-badge">
                <span
                  className={`interactive-guided-completed-icon${checker.completionReason === 'skipped' ? ' skipped' : ''}`}
                  data-testid={testIds.interactive.stepCompleted(renderedStepId)}
                >
                  {checker.completionReason === 'skipped' ? '↷' : '✓'}
                </span>
                <span className="interactive-guided-completed-text">
                  {checker.completionReason === 'skipped' ? 'Skipped' : 'Completed'}
                </span>
              </div>
              <button
                className="interactive-guided-redo-btn"
                onClick={handleStepRedo}
                disabled={disabled || isAnyActionRunning}
                data-testid={testIds.interactive.redoButton(renderedStepId)}
                title={
                  checker.completionReason === 'skipped'
                    ? 'Redo this step (try again)'
                    : 'Redo this step (execute again)'
                }
              >
                ↻ Redo
              </button>
            </div>
          )}
        </div>

        {/* Post-verify failure message */}
        {!isCompletedWithObjectives && !checker.isChecking && postVerifyError && (
          <div
            className="interactive-step-execution-error"
            data-testid={testIds.interactive.errorMessage(renderedStepId)}
          >
            {postVerifyError}
          </div>
        )}

        {/* Lazy scroll failure message with retry */}
        {!isCompletedWithObjectives && lazyScrollError && (
          <div className="interactive-step-lazy-error" data-testid={`lazy-scroll-error-${renderedStepId}`}>
            <span className="interactive-lazy-error-text">{lazyScrollError}</span>
            <button
              className="interactive-lazy-retry-btn"
              onClick={handleLazyScrollRetry}
              disabled={isShowRunning || isDoRunning}
            >
              Retry
            </button>
          </div>
        )}

        {/* Form validation feedback for formfill actions */}
        {targetAction === 'formfill' && !isCompletedWithObjectives && finalIsEnabled && (
          <>
            {/* Checking indicator - shown while debouncing/validating */}
            {formValidation.isChecking && (
              <div
                className="interactive-step-form-checking"
                data-testid={testIds.interactive.formChecking(renderedStepId)}
              >
                <span className="interactive-form-spinner">⟳</span>
                <span className="interactive-form-checking-text">Checking contents...</span>
              </div>
            )}

            {/* Validation warning - shown when regex pattern doesn't match */}
            {formValidation.isInvalid && formValidation.hint && (
              <div
                className="interactive-step-form-hint-warning"
                data-testid={testIds.interactive.formHintWarning(renderedStepId)}
              >
                <span className="interactive-form-warning-icon">⚠</span>
                <span className="interactive-form-hint-text">{formValidation.hint}</span>
              </div>
            )}
          </>
        )}

        {/* Show explanation text when requirements aren't met, but objectives always win (clarification 2) */}
        {checker.completionReason !== 'objectives' &&
          checker.completionReason !== 'skipped' &&
          shouldShowExplanation &&
          !isCompletedWithObjectives &&
          explanationText && (
            <div
              className={`interactive-step-requirement-explanation${checker.isChecking ? ' rechecking' : ''}`}
              data-testid={testIds.interactive.requirementCheck(renderedStepId)}
            >
              {explanationText}
              {checker.isChecking && <span className="interactive-requirement-spinner">⟳</span>}
              <div className="interactive-step-requirement-buttons">
                {/* Retry button for eligible steps or fixable requirements */}
                {(isEligibleForChecking || checker.canFixRequirement) && (
                  <button
                    className="interactive-requirement-retry-btn"
                    data-testid={
                      checker.canFixRequirement
                        ? testIds.interactive.requirementFixButton(renderedStepId)
                        : testIds.interactive.requirementRetryButton(renderedStepId)
                    }
                    onClick={async () => {
                      if (checker.canFixRequirement && checker.fixRequirement) {
                        await checker.fixRequirement();
                      } else {
                        checker.checkStep();
                      }
                    }}
                  >
                    {checker.canFixRequirement ? 'Fix this' : 'Retry'}
                  </button>
                )}

                {/* Skip button only for eligible steps with failed requirements */}
                {isEligibleForChecking && checker.canSkip && checker.markSkipped && !checker.isEnabled && (
                  <button
                    className="interactive-requirement-skip-btn"
                    data-testid={testIds.interactive.requirementSkipButton(renderedStepId)}
                    onClick={async () => {
                      if (checker.markSkipped) {
                        await checker.markSkipped();

                        // Notify parent section of step completion (skipped counts as completed)
                        if (onStepComplete && stepId) {
                          onStepComplete(stepId);
                        }

                        if (onComplete) {
                          onComplete();
                        }
                      }
                    }}
                  >
                    Skip
                  </button>
                )}
              </div>
            </div>
          )}
      </div>
    );
  }
);

// Add display name for debugging
InteractiveStep.displayName = 'InteractiveStep';
