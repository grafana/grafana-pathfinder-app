import React, { useState, useCallback, forwardRef, useImperativeHandle, useEffect } from 'react';
import { Button } from '@grafana/ui';

import { useInteractiveElements } from '../../../interactive.hook';
import { waitForReactUpdates } from '../../../requirements-checker.hook';
import { useStepChecker } from '../../../step-checker.hook';
import { getPostVerifyExplanation } from '../../../requirement-explanations';
import { reportAppInteraction, UserInteraction } from '../../../../lib/analytics';
import type { InteractiveStepProps } from './interactive-section';

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
      skippable = false, // Default to false - only skippable if explicitly set
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
    },
    ref
  ) => {
    // Local UI state
    const [isLocallyCompleted, setIsLocallyCompleted] = useState(false);
    const [isShowRunning, setIsShowRunning] = useState(false);
    const [isDoRunning, setIsDoRunning] = useState(false);
    const [postVerifyError, setPostVerifyError] = useState<string | null>(null);

    // Helper function to get current document name for analytics
    const getDocumentInfo = useCallback(() => {
      try {
        const tabUrl = (window as any).__DocsPluginActiveTabUrl as string | undefined;
        const contentKey = (window as any).__DocsPluginContentKey as string | undefined;

        // Use tabUrl first, then contentKey, then fallback to current location
        const sourceDocument = tabUrl || contentKey || window.location.pathname || 'unknown';

        return {
          source_document: sourceDocument,
          step_id: stepId || 'unknown',
        };
      } catch {
        return {
          source_document: 'unknown',
          step_id: stepId || 'unknown',
        };
      }
    }, [stepId]);

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
        // Execute the action using existing interactive logic
        await executeInteractiveAction(targetAction, refTarget, targetValue, 'do', targetComment);

        // Run post-verification if specified by author
        if (postVerify && postVerify.trim() !== '') {
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

        return true;
      } catch (error) {
        console.error(`❌ Step execution failed: ${stepId}`, error);
        setPostVerifyError(error instanceof Error ? error.message : 'Execution failed');
        return false;
      }
    }, [
      finalIsEnabled,
      isCompletedWithObjectives,
      disabled,
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

    // Handle individual "Show me" action
    const handleShowAction = useCallback(async () => {
      if (disabled || isShowRunning || isCompletedWithObjectives || !finalIsEnabled) {
        return;
      }

      // Track "Show me" button click analytics
      const docInfo = getDocumentInfo();
      reportAppInteraction(UserInteraction.ShowMeButtonClick, {
        ...docInfo,
        target_action: targetAction,
        ref_target: refTarget,
        ...(targetValue && { target_value: targetValue }),
        interaction_location: 'interactive_step',
      });

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
      getDocumentInfo,
    ]);

    // Handle individual "Do it" action (delegates to executeStep)
    const handleDoAction = useCallback(async () => {
      if (disabled || isDoRunning || isCompletedWithObjectives || !finalIsEnabled) {
        return;
      }

      // Track "Do it" button click analytics
      const docInfo = getDocumentInfo();
      reportAppInteraction(UserInteraction.DoItButtonClick, {
        ...docInfo,
        target_action: targetAction,
        ref_target: refTarget,
        ...(targetValue && { target_value: targetValue }),
        interaction_location: 'interactive_step',
      });

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
      getDocumentInfo,
      targetAction,
      refTarget,
      targetValue,
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
      >
        <div className="interactive-step-content">
          {title && <div className="interactive-step-title">{title}</div>}
          {description && <div className="interactive-step-description">{description}</div>}
          {children}
        </div>

        <div className="interactive-step-actions">
          <div className="interactive-step-action-buttons">
            {/* For highlight-only actions, hide "Show me" button when completed - only show when not completed */}
            {!isCompletedWithObjectives && (
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
                    : hints || `Show me: ${getActionDescription()}`
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
                      : 'Show me'}
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
