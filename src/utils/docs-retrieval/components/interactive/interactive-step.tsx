import React, { useState, useCallback, forwardRef, useImperativeHandle, useEffect } from 'react';
import { Button } from '@grafana/ui';

import { useInteractiveElements } from '../../../interactive.hook';
import { waitForReactUpdates } from '../../../requirements-checker.hook';
import { useStepChecker } from '../../../step-checker.hook';
import { getPostVerifyExplanation } from '../../../requirement-explanations';
import type { InteractiveStepProps } from './interactive-section';

export const InteractiveStep = forwardRef<{ executeStep: () => Promise<boolean> }, InteractiveStepProps>(
  (
    {
      targetAction,
      refTarget,
      targetValue,
      targetComment,
      postVerify,
      doIt = true, // Default to true - show "Do it" button unless explicitly disabled
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

    // Handle reset trigger from parent section
    useEffect(() => {
      if (resetTrigger && resetTrigger > 0) {
        console.log(`🔄 Resetting step local completion: ${stepId}`);
        setIsLocallyCompleted(false);
      }
    }, [resetTrigger, stepId]);

    // Combined completion state (parent takes precedence for coordination)
    const isCompleted = parentCompleted || isLocallyCompleted;

    // Get the interactive functions from the hook
    const { executeInteractiveAction, verifyStepResult } = useInteractiveElements();

    // Use the new step requirements hook with parent coordination
    const checker = useStepChecker({
      requirements,
      hints,
      stepId: stepId || `step-${Date.now()}`, // Fallback if no stepId provided
      isEligibleForChecking: isEligibleForChecking && !isCompleted,
    });

    // Combined completion state: objectives always win (clarification 1, 2)
    const isCompletedWithObjectives =
      parentCompleted || isLocallyCompleted || checker.completionReason === 'objectives';

    // Execution logic (shared between individual and sequence execution)
    const executeStep = useCallback(async (): Promise<boolean> => {
      if (!checker.isEnabled || isCompletedWithObjectives || disabled) {
        console.warn(`⚠️ Step execution blocked: ${stepId}`, {
          enabled: checker.isEnabled,
          completed: isCompletedWithObjectives,
          disabled,
        });
        return false;
      }

      try {
        console.log(`🚀 Executing step: ${stepId} (${targetAction}: ${refTarget})`);

        // Execute the action using existing interactive logic
        await executeInteractiveAction(targetAction, refTarget, targetValue, 'do', targetComment);

        // If author provided explicit post verification (data-verify), run it now
        if (postVerify && postVerify.trim() !== '') {
          console.warn(`🔍 Post-verify: ${postVerify}`);
          await waitForReactUpdates();
          const result = await verifyStepResult(
            postVerify,
            targetAction,
            refTarget || '',
            targetValue,
            stepId || 'post-verify'
          );
          if (!result.pass) {
            const friendly = getPostVerifyExplanation(postVerify, result.error?.map(e => e.error).filter(Boolean).join(', '));
            setPostVerifyError(friendly || 'Verification failed.');
            console.warn(`⛔ Post-verify failed for ${stepId}:`, friendly);
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

        console.log(`✅ Step completed: ${stepId}`);
        return true;
      } catch (error) {
        console.error(`❌ Step execution failed: ${stepId}`, error);
        setPostVerifyError(error instanceof Error ? error.message : 'Execution failed');
        return false;
      }
    }, [
      checker.isEnabled,
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
      }),
      [executeStep]
    );

    // Handle individual "Show me" action
    const handleShowAction = useCallback(async () => {
      if (disabled || isShowRunning || isCompletedWithObjectives || !checker.isEnabled) {
        return;
      }

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
      checker.isEnabled,
      executeInteractiveAction,
      onStepComplete,
      onComplete,
      stepId,
    ]);

    // Handle individual "Do it" action (delegates to executeStep)
    const handleDoAction = useCallback(async () => {
      if (disabled || isDoRunning || isCompletedWithObjectives || !checker.isEnabled) {
        return;
      }

      setIsDoRunning(true);
      try {
        await executeStep();
      } catch (error) {
        console.error('Interactive do action failed:', error);
      } finally {
        setIsDoRunning(false);
      }
    }, [disabled, isDoRunning, isCompletedWithObjectives, checker.isEnabled, executeStep]);

    // Handle individual step reset (redo functionality)
    const handleStepRedo = useCallback(async () => {
      if (disabled || isDoRunning || isShowRunning) {
        return;
      }

      console.log(`🔄 Resetting individual step: ${stepId}`);

      // Reset local completion state
      setIsLocallyCompleted(false);
      setPostVerifyError(null);

      // Trigger requirements recheck to reset the step checker state
      checker.checkStep();

      // Notify parent section to remove from completed steps
      if (onStepReset && stepId) {
        onStepReset(stepId);
      }
    }, [disabled, isDoRunning, isShowRunning, stepId, onStepReset, checker, verifyStepResult]);

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
          isCompletedWithObjectives ? ' completed' : ''
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
                  disabled || isAnyActionRunning || (!checker.isEnabled && checker.completionReason !== 'objectives')
                }
                size="sm"
                variant="secondary"
                className="interactive-step-show-btn"
                title={checker.isChecking ? 'Checking requirements...' : hints || `Show me: ${getActionDescription()}`}
              >
                {checker.isChecking
                  ? 'Checking...'
                  : isShowRunning
                    ? 'Showing...'
                    : !checker.isEnabled
                      ? 'Requirements not met'
                      : 'Show me'}
              </Button>
            )}

            {/* Only show "Do it" button when doIt prop is true */}
            {doIt && !isCompletedWithObjectives && (checker.isEnabled || checker.completionReason === 'objectives') && (
              <Button
                onClick={handleDoAction}
                disabled={
                  disabled || isAnyActionRunning || (!checker.isEnabled && checker.completionReason !== 'objectives')
                }
                size="sm"
                variant="primary"
                className="interactive-step-do-btn"
                title={checker.isChecking ? 'Checking requirements...' : hints || `Do it: ${getActionDescription()}`}
              >
                {checker.isChecking ? 'Checking...' : isDoRunning || isCurrentlyExecuting ? 'Executing...' : 'Do it'}
              </Button>
            )}
          </div>

          {isCompletedWithObjectives && (
            <div className="interactive-step-completion-group">
              <span className="interactive-step-completed-indicator">✓</span>
              <button
                className="interactive-step-redo-btn"
                onClick={handleStepRedo}
                disabled={disabled || isAnyActionRunning}
                title="Redo this step (execute again)"
              >
                <span className="interactive-step-redo-icon">↻</span>
                <span className="interactive-step-redo-text">Redo</span>
              </button>
            </div>
          )}
        </div>

        {/* Post-verify failure message */}
        {!isCompletedWithObjectives && !checker.isChecking && postVerifyError && (
          <div className="interactive-step-execution-error">
            {postVerifyError}
          </div>
        )}

        {/* Show explanation text when requirements aren't met, but objectives always win (clarification 2) */}
        {checker.completionReason !== 'objectives' &&
          !checker.isEnabled &&
          !isCompletedWithObjectives &&
          !checker.isChecking &&
          checker.explanation && (
            <div className="interactive-step-requirement-explanation">
              {checker.explanation}
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
            </div>
          )}
      </div>
    );
  }
);

// Add display name for debugging
InteractiveStep.displayName = 'InteractiveStep';
