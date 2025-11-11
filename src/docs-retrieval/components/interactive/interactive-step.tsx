import React, { useState, useCallback, forwardRef, useImperativeHandle, useEffect, useMemo } from 'react';
import { Button } from '@grafana/ui';
import { usePluginContext } from '@grafana/data';

import {
  waitForReactUpdates,
  useStepChecker,
  getPostVerifyExplanation,
  checkPostconditions,
} from '../../../requirements-manager';
import { reportAppInteraction, UserInteraction, buildInteractiveStepProperties } from '../../../lib/analytics';
import type { InteractiveStepProps } from './interactive-section';
import { matchesStepAction, type DetectedActionEvent, useInteractiveElements } from '../../../interactive-engine';
import { getInteractiveConfig } from '../../../constants/interactive-config';
import { getConfigWithDefaults } from '../../../constants';
import { findButtonByText, querySelectorAllEnhanced } from '../../../lib/dom';

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
    // Local UI state
    const [isLocallyCompleted, setIsLocallyCompleted] = useState(false);
    const [isShowRunning, setIsShowRunning] = useState(false);
    const [isDoRunning, setIsDoRunning] = useState(false);
    const [postVerifyError, setPostVerifyError] = useState<string | null>(null);

    // Get plugin configuration for auto-detection settings
    const pluginContext = usePluginContext();
    const interactiveConfig = useMemo(() => {
      const config = getConfigWithDefaults(pluginContext?.meta?.jsonData || {});
      return getInteractiveConfig(config);
    }, [pluginContext?.meta?.jsonData]);

    // Combined completion state (parent takes precedence for coordination)
    const isCompleted = parentCompleted || isLocallyCompleted;

    // Get the interactive functions from the hook
    const { executeInteractiveAction, verifyStepResult } = useInteractiveElements();

    // For section steps, use a simplified checker that respects section authority
    // For standalone steps, use the full global checker
    const isPartOfSection = stepId?.includes('section-') && stepId?.includes('-step-');

    const checker = useStepChecker({
      requirements,
      hints,
      targetAction,
      refTarget,
      stepId: stepId || `step-${Date.now()}`, // Fallback if no stepId provided
      isEligibleForChecking: isPartOfSection ? isEligibleForChecking : isEligibleForChecking && !isCompleted,
      skippable,
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
        ? 'Complete the previous steps in order before this one becomes available.'
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
        await executeInteractiveAction(targetAction, refTarget, targetValue, 'do', targetComment);

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
            targetValue,
            stepId || 'post-verify'
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
      targetValue,
      targetComment,
      postVerify,
      verifyStepResult,
      executeInteractiveAction,
      onStepComplete,
      onComplete,
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

    // Auto-detection: Listen for user actions and complete step automatically
    useEffect(() => {
      // Only enable auto-detection if:
      // 1. Feature is enabled in config
      // 2. Step is eligible and enabled
      // 3. Step is not already completed
      // 4. Step is not currently executing (avoid race conditions with "Do Section")
      if (
        !interactiveConfig.autoDetection.enabled ||
        !finalIsEnabled ||
        isCompletedWithObjectives ||
        isCurrentlyExecuting ||
        disabled
      ) {
        return;
      }

      const handleActionDetected = async (event: Event) => {
        const customEvent = event as CustomEvent<DetectedActionEvent>;
        const detectedAction = customEvent.detail;

        // Try to find target element for coordinate-based matching
        // Using synchronous resolution to avoid timing issues with dynamic menus/dropdowns
        let targetElement: HTMLElement | null = null;
        try {
          if (targetAction === 'button') {
            // Use button-specific finder for text matching
            const buttons = findButtonByText(refTarget);
            targetElement = buttons[0] || null;
          } else if (targetAction === 'highlight' || targetAction === 'hover') {
            // Use enhanced selector for other action types
            const result = querySelectorAllEnhanced(refTarget);
            targetElement = result.elements[0] || null;
          }
          // Note: formfill and navigate don't use coordinate matching
        } catch (error) {
          // Element resolution failed, fall back to selector-based matching
          console.warn('Failed to resolve target element for coordinate matching:', error);
        }

        // Check if detected action matches this step's configuration
        // Now with coordinate-based matching support
        const matches = matchesStepAction(
          detectedAction,
          {
            targetAction,
            refTarget,
            targetValue,
          },
          targetElement
        );

        if (!matches) {
          return; // Not a match for this step
        }

        // Wait a bit for DOM to settle after the action
        await new Promise((resolve) => setTimeout(resolve, interactiveConfig.autoDetection.verificationDelay));

        // Run post-verification if specified (same as "Do it" button)
        if (postVerify && postVerify.trim() !== '') {
          try {
            const result = await checkPostconditions({
              requirements: postVerify,
              targetAction,
              refTarget,
              targetValue,
              stepId: stepId || 'auto-verify',
            });

            if (!result.pass) {
              // Verification failed - don't auto-complete
              return;
            }
          } catch (error) {
            // Verification error - don't auto-complete
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
              ...(targetValue && { target_value: targetValue }),
              interaction_location: 'interactive_step_auto',
              completion_method: 'auto_detected',
            },
            { stepId, stepIndex, totalSteps, sectionId, sectionTitle }
          )
        );
      };

      // Subscribe to user-action-detected events
      document.addEventListener('user-action-detected', handleActionDetected);

      return () => {
        document.removeEventListener('user-action-detected', handleActionDetected);
      };
    }, [
      interactiveConfig.autoDetection.enabled,
      interactiveConfig.autoDetection.verificationDelay,
      finalIsEnabled,
      isCompletedWithObjectives,
      isCurrentlyExecuting,
      disabled,
      targetAction,
      refTarget,
      targetValue,
      postVerify,
      stepId,
      onStepComplete,
      onComplete,
      stepIndex,
      totalSteps,
      sectionId,
      sectionTitle,
    ]);

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
            ...(targetValue && { target_value: targetValue }),
            interaction_location: 'interactive_step',
          },
          { stepId, stepIndex, totalSteps, sectionId, sectionTitle }
        )
      );

      setIsShowRunning(true);
      try {
        await executeInteractiveAction(targetAction, refTarget, targetValue, 'show', targetComment);

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
      targetValue,
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
      stepIndex,
      totalSteps,
      sectionId,
      sectionTitle,
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
            ...(targetValue && { target_value: targetValue }),
            interaction_location: 'interactive_step',
          },
          { stepId, stepIndex, totalSteps, sectionId, sectionTitle }
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
      stepId,
      targetAction,
      refTarget,
      targetValue,
      stepIndex,
      totalSteps,
      sectionId,
      sectionTitle,
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
          return `Fill form with "${targetValue || 'value'}"`;
        case 'navigate':
          return `Navigate to ${refTarget}`;
        case 'hover':
          return `Hover over element`;
        case 'sequence':
          return `Run sequence`;
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
        data-targetvalue={targetValue}
        data-targetcomment={targetComment}
        data-step-id={stepId}
      >
        <div className="interactive-step-content">
          {title && <div className="interactive-step-title">{title}</div>}
          {description && <div className="interactive-step-description">{description}</div>}
          {children}
        </div>

        <div className="interactive-step-actions">
          <div className="interactive-step-action-buttons">
            {/* Only show "Show me" button when showMe prop is true */}
            {showMe && !isCompletedWithObjectives && (
              <Button
                onClick={handleShowAction}
                disabled={
                  disabled || isAnyActionRunning || (!finalIsEnabled && checker.completionReason !== 'objectives')
                }
                size="sm"
                variant="secondary"
                className="interactive-step-show-btn"
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
                    : !finalIsEnabled
                      ? 'Requirements not met'
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
                title="Skip this step without executing"
              >
                Skip
              </Button>
            )}
          </div>

          {isCompletedWithObjectives && (
            <div className="interactive-step-completion-group">
              <span
                className={`interactive-step-completed-indicator ${checker.completionReason === 'skipped' ? 'skipped' : ''}`}
              >
                {checker.completionReason === 'skipped' ? '↷' : '✓'}
              </span>
              <button
                className="interactive-step-redo-btn"
                onClick={handleStepRedo}
                disabled={disabled || isAnyActionRunning}
                title={
                  checker.completionReason === 'skipped'
                    ? 'Redo this step (try again)'
                    : 'Redo this step (execute again)'
                }
              >
                <span className="interactive-step-redo-icon">↻</span>
                <span className="interactive-step-redo-text">Redo</span>
              </button>
            </div>
          )}
        </div>

        {/* Post-verify failure message */}
        {!isCompletedWithObjectives && !checker.isChecking && postVerifyError && (
          <div className="interactive-step-execution-error">{postVerifyError}</div>
        )}

        {/* Show explanation text when requirements aren't met, but objectives always win (clarification 2) */}
        {checker.completionReason !== 'objectives' &&
          checker.completionReason !== 'skipped' &&
          shouldShowExplanation &&
          !isCompletedWithObjectives &&
          !checker.isChecking &&
          explanationText && (
            <div className="interactive-step-requirement-explanation">
              {explanationText}
              <div className="interactive-step-requirement-buttons">
                {/* Retry button for eligible steps or fixable requirements */}
                {(isEligibleForChecking || checker.canFixRequirement) && (
                  <button
                    className="interactive-requirement-retry-btn"
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
