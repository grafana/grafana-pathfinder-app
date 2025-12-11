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
} from '../../../interactive-engine';
import { testIds } from '../../../components/testIds';
import { AssistantCustomizableProvider } from '../../../integrations/assistant-integration';

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
    const generatedStepIdRef = useRef<string>();
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

    // Manage targetValue as state to support assistant customization
    const [currentTargetValue, setCurrentTargetValue] = useState(targetValue);

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
    });

    // Combined completion state: objectives always win, skipped also counts as completed (clarification 1, 2)
    const isCompletedWithObjectives =
      parentCompleted ||
      isLocallyCompleted ||
      checker.completionReason === 'objectives' ||
      checker.completionReason === 'skipped';

    // Determine if step should show action buttons
    // Section steps require both eligibility AND requirements to be met
    const finalIsEnabled = isPartOfSection
      ? isEligibleForChecking && !isCompleted && checker.isEnabled && checker.completionReason !== 'objectives'
      : checker.isEnabled;

    // Determine when to show explanation text and what text to show
    const shouldShowExplanation = isPartOfSection
      ? !isEligibleForChecking || (isEligibleForChecking && requirements && !checker.isEnabled)
      : !checker.isEnabled;

    // Choose appropriate explanation text based on step state
    const explanationText = isPartOfSection
      ? !isEligibleForChecking
        ? 'Complete previous step'
        : checker.explanation
      : checker.explanation;

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
        await executeInteractiveAction(targetAction, refTarget, currentTargetValue, 'show', targetComment);

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
        await executeStep();
      } catch (error) {
        console.error('Interactive do action failed:', error);
      } finally {
        setIsDoRunning(false);
      }
    }, [
      disabled,
      isDoRunning,
      isCompletedWithObjectives,
      finalIsEnabled,
      executeStep,
      targetAction,
      refTarget,
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

    return (
      <div
        className={`interactive-step${className ? ` ${className}` : ''}${
          isCompletedWithObjectives ? (checker.completionReason === 'skipped' ? ' skipped' : ' completed') : ''
        }${isCurrentlyExecuting ? ' executing' : ''}`}
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
          <AssistantCustomizableProvider updateTargetValue={updateTargetValue}>
            {children}
          </AssistantCustomizableProvider>
        </div>

        <div className="interactive-step-actions">
          <div className="interactive-step-action-buttons">
            {/* Only show "Show me" button when showMe prop is true AND step is enabled */}
            {showMe && !isCompletedWithObjectives && finalIsEnabled && (
              <Button
                onClick={handleShowAction}
                disabled={disabled || isAnyActionRunning}
                size="sm"
                variant="secondary"
                className="interactive-step-show-btn"
                data-testid={testIds.interactive.showMeButton(renderedStepId)}
                title={
                  checker.isChecking
                    ? checker.isRetrying
                      ? `Checking requirements... (${checker.retryCount}/${checker.maxRetries})`
                      : 'Checking requirements...'
                    : hints || `${showMeText ? `${showMeText}:` : 'Show me:'} ${getActionDescription()}`
                }
              >
                {checker.isChecking
                  ? checker.isRetrying
                    ? `Checking... (${checker.retryCount}/${checker.maxRetries})`
                    : 'Checking...'
                  : isShowRunning
                    ? 'Showing...'
                    : showMeText || 'Show me'}
              </Button>
            )}

            {/* Only show "Do it" button when doIt prop is true */}
            {doIt && !isCompletedWithObjectives && (finalIsEnabled || checker.completionReason === 'objectives') && (
              <Button
                onClick={handleDoAction}
                disabled={
                  disabled || isAnyActionRunning || (!finalIsEnabled && checker.completionReason !== 'objectives')
                }
                size="sm"
                variant="primary"
                className="interactive-step-do-btn"
                data-testid={testIds.interactive.doItButton(renderedStepId)}
                title={
                  checker.isChecking
                    ? checker.isRetrying
                      ? `Checking requirements... (${checker.retryCount}/${checker.maxRetries})`
                      : 'Checking requirements...'
                    : hints || `Do it: ${getActionDescription()}`
                }
              >
                {checker.isChecking
                  ? checker.isRetrying
                    ? `Checking... (${checker.retryCount}/${checker.maxRetries})`
                    : 'Checking...'
                  : isDoRunning || isCurrentlyExecuting
                    ? 'Executing...'
                    : 'Do it'}
              </Button>
            )}

            {/* Show "Skip" button when step is skippable (always available, not just on error) */}
            {skippable && !isCompletedWithObjectives && (
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

          {isCompletedWithObjectives && (
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
