import React, { useState, useCallback, forwardRef, useImperativeHandle, useEffect, useMemo, useRef } from 'react';
import { Button } from '@grafana/ui';
import { usePluginContext } from '@grafana/data';

import { reportAppInteraction, UserInteraction, buildInteractiveStepProperties } from '../../../lib/analytics';
import {
  GuidedHandler,
  InteractiveStateManager,
  NavigationManager,
  matchesStepAction,
  type DetectedActionEvent,
} from '../../../interactive-engine';
import { waitForReactUpdates, useStepChecker, validateInteractiveRequirements } from '../../../requirements-manager';
import { getInteractiveConfig } from '../../../constants/interactive-config';
import { getConfigWithDefaults } from '../../../constants';
import { findButtonByText, querySelectorAllEnhanced } from '../../../lib/dom';
import { GuidedAction } from '../../../types/interactive-actions.types';
import { testIds } from '../../../components/testIds';

let anonymousGuidedCounter = 0;

interface InteractiveGuidedProps {
  internalActions: GuidedAction[];

  // State management (passed by parent section)
  stepId?: string;
  isEligibleForChecking?: boolean;
  isCompleted?: boolean;
  isCurrentlyExecuting?: boolean;
  onStepComplete?: (stepId: string) => void;
  onStepReset?: (stepId: string) => void;

  // Content and styling
  title?: string;
  children?: React.ReactNode;
  className?: string;
  disabled?: boolean;
  hints?: string;
  requirements?: string;
  objectives?: string;
  onComplete?: () => void;
  skippable?: boolean;
  completeEarly?: boolean; // Whether to mark complete before action execution (for navigation steps)

  // Step position tracking for analytics (added by section)
  stepIndex?: number;
  totalSteps?: number;
  sectionId?: string;
  sectionTitle?: string;

  // Guided-specific configuration
  stepTimeout?: number; // Timeout per step in milliseconds (default: 30000ms = 30s)
  resetTrigger?: number;
}

export const InteractiveGuided = forwardRef<{ executeStep: () => Promise<boolean> }, InteractiveGuidedProps>(
  (
    {
      internalActions,
      stepId,
      isEligibleForChecking = true,
      isCompleted: parentCompleted = false,
      isCurrentlyExecuting = false,
      onStepComplete,
      onStepReset,
      title,
      children,
      className,
      disabled = false,
      hints,
      requirements,
      objectives,
      onComplete,
      skippable = false,
      completeEarly = false, // Default to false - only mark early if explicitly set
      stepTimeout = 30000, // 30 second default timeout per step
      resetTrigger,
      stepIndex,
      totalSteps,
      sectionId,
      sectionTitle,
    },
    ref
  ) => {
    const generatedStepIdRef = useRef<string>();
    if (!generatedStepIdRef.current) {
      anonymousGuidedCounter += 1;
      generatedStepIdRef.current = `guided-step-${anonymousGuidedCounter}`;
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
    const [isExecuting, setIsExecuting] = useState(false);
    const [currentStepIndex, setCurrentStepIndex] = useState(0);
    const [currentStepStatus, setCurrentStepStatus] = useState<'waiting' | 'timeout' | 'completed'>('waiting');
    const [executionError, setExecutionError] = useState<string | null>(null);
    const [wasCancelled, setWasCancelled] = useState(false);

    // Get plugin configuration for auto-detection settings
    const pluginContext = usePluginContext();
    const interactiveConfig = useMemo(() => {
      const config = getConfigWithDefaults(pluginContext?.meta?.jsonData || {});
      return getInteractiveConfig(config);
    }, [pluginContext?.meta?.jsonData]);

    // Create guided handler instance
    const guidedHandler = useMemo(() => {
      const stateManager = new InteractiveStateManager();
      const navigationManager = new NavigationManager();
      return new GuidedHandler(stateManager, navigationManager, waitForReactUpdates);
    }, []);

    // Handle reset trigger from parent section
    useEffect(() => {
      if (resetTrigger && resetTrigger > 0) {
        setIsLocallyCompleted(false);
        setExecutionError(null);
        setCurrentStepIndex(0);
        setCurrentStepStatus('waiting');
        setWasCancelled(false);
      }
    }, [resetTrigger]);

    // Combined completion state
    const isCompleted = parentCompleted || isLocallyCompleted;

    // Runtime validation: check for impossible requirement configurations
    useEffect(() => {
      validateInteractiveRequirements(
        {
          requirements,
          refTarget: undefined, // Guided containers have no refTarget (internal actions do)
          stepId: renderedStepId,
        },
        'InteractiveGuided'
      );
    }, [requirements, renderedStepId]);

    // Use step checker hook for requirements and objectives
    const checker = useStepChecker({
      requirements,
      objectives,
      hints,
      stepId: stepId || renderedStepId,
      isEligibleForChecking: isEligibleForChecking && !isCompleted,
      skippable,
    });

    // Combined completion state: objectives always win
    const isCompletedWithObjectives =
      parentCompleted || isLocallyCompleted || checker.completionReason === 'objectives';

    // Main execution logic
    const executeStep = useCallback(async (): Promise<boolean> => {
      if (!checker.isEnabled || isCompletedWithObjectives || isExecuting) {
        return false;
      }

      // Check objectives before executing
      if (checker.completionReason === 'objectives') {
        setIsLocallyCompleted(true);
        if (onStepComplete && stepId) {
          onStepComplete(stepId);
        }
        if (onComplete) {
          onComplete();
        }
        return true;
      }

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

      setIsExecuting(true);
      setExecutionError(null);
      setCurrentStepIndex(0);
      setCurrentStepStatus('waiting');
      setWasCancelled(false);

      const { NavigationManager } = await import('../../../interactive-engine');
      const navManager = new NavigationManager();
      navManager.clearAllHighlights();

      // Reset progress tracking before starting
      guidedHandler.resetProgress();

      try {
        // Execute each internal action in sequence, waiting for user
        for (let i = 0; i < internalActions.length; i++) {
          const action = internalActions[i];
          setCurrentStepIndex(i);
          setCurrentStepStatus('waiting');

          // Execute guided step and wait for user completion
          const result = await guidedHandler.executeGuidedStep(action, i, internalActions.length, stepTimeout);

          if (result === 'completed' || result === 'skipped') {
            setCurrentStepStatus('completed');
            // Brief visual feedback before moving to next step
            await new Promise((resolve) => setTimeout(resolve, 500));
          } else if (result === 'timeout') {
            setCurrentStepStatus('timeout');
            setExecutionError(`Step ${i + 1} timed out. Click "Skip" to continue or "Retry" to try again.`);
            return false;
          } else if (result === 'cancelled') {
            return false;
          }
        }

        // All steps completed - clear the final highlight
        navManager.clearAllHighlights();

        // NEW: If NOT completeEarly, mark complete after actions (normal flow)
        if (!completeEarly) {
          setIsLocallyCompleted(true);

          if (onStepComplete && stepId) {
            onStepComplete(stepId);
          }

          if (onComplete) {
            onComplete();
          }
        }

        return true;
      } catch (error) {
        console.error(`Guided execution failed: ${stepId}`, error);
        const errorMessage = error instanceof Error ? error.message : 'Guided execution failed';
        setExecutionError(errorMessage);
        return false;
      } finally {
        setIsExecuting(false);
        setCurrentStepIndex(0);
      }
    }, [
      checker.isEnabled,
      isCompletedWithObjectives,
      isExecuting,
      completeEarly,
      stepId,
      internalActions,
      guidedHandler,
      stepTimeout,
      onStepComplete,
      onComplete,
      checker.completionReason,
    ]);

    // Expose execute method for parent (section execution)
    useImperativeHandle(ref, () => {
      return {
        executeStep,
      };
    }, [executeStep]);

    // Auto-detection: Listen for user actions and auto-advance through guided steps
    useEffect(() => {
      // Only enable auto-detection if:
      // 1. Feature is enabled in config
      // 2. Step is eligible and enabled
      // 3. Step is not already completed
      // 4. Step is currently executing (guided mode - waiting for user)
      if (
        !interactiveConfig.autoDetection.enabled ||
        !checker.isEnabled ||
        isCompletedWithObjectives ||
        !isExecuting || // Only listen while executing (in guided mode)
        disabled
      ) {
        return;
      }

      const handleActionDetected = async (event: Event) => {
        const customEvent = event as CustomEvent<DetectedActionEvent>;
        const detectedAction = customEvent.detail;

        // Check if the detected action matches the current step
        const currentAction = internalActions[currentStepIndex];
        if (!currentAction) {
          return;
        }

        // Try to find target element for coordinate-based matching
        // Using synchronous resolution to avoid timing issues with dynamic menus/dropdowns
        let targetElement: HTMLElement | null = null;
        try {
          const actionType = currentAction.targetAction;
          const selector = currentAction.refTarget;

          if (actionType === 'button') {
            // Use button-specific finder for text matching
            const buttons = findButtonByText(selector);
            targetElement = buttons[0] || null;
          } else if (actionType === 'highlight' || actionType === 'hover') {
            // Use enhanced selector for other action types
            const result = querySelectorAllEnhanced(selector);
            targetElement = result.elements[0] || null;
          }
        } catch (error) {
          // Element resolution failed, fall back to selector-based matching
          console.warn('Failed to resolve target element for coordinate matching:', error);
        }

        // Check if action matches (with coordinate support)
        const matches = matchesStepAction(
          detectedAction,
          {
            targetAction: currentAction.targetAction as any,
            refTarget: currentAction.refTarget,
            targetValue: currentAction.targetValue,
          },
          targetElement
        );

        if (!matches) {
          return; // Not a match for current step
        }

        // Notify the guided handler that user completed the step
        // The handler is listening for this event to proceed
        const stepCompletedEvent = new CustomEvent('guided-step-completed', {
          detail: {
            stepIndex: currentStepIndex,
            stepId,
          },
        });
        document.dispatchEvent(stepCompletedEvent);

        // Track auto-completion in analytics
        reportAppInteraction(
          UserInteraction.StepAutoCompleted,
          buildInteractiveStepProperties(
            {
              target_action: 'guided',
              ref_target: renderedStepId,
              interaction_location: 'interactive_guided_auto',
              completion_method: 'auto_detected',
              step_number: currentStepIndex + 1,
              total_steps: internalActions.length,
            },
            analyticsStepMeta
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
      checker.isEnabled,
      isCompletedWithObjectives,
      isExecuting,
      disabled,
      currentStepIndex,
      internalActions,
      stepId,
      renderedStepId,
      analyticsStepMeta,
    ]);

    // Handle "Do it" button click
    const handleDoAction = useCallback(async () => {
      if (disabled || isExecuting || isCompletedWithObjectives || !checker.isEnabled) {
        return;
      }

      // Track analytics
      reportAppInteraction(
        UserInteraction.DoItButtonClick,
        buildInteractiveStepProperties(
          {
            target_action: 'guided',
            ref_target: renderedStepId,
            interaction_location: 'interactive_guided',
            internal_actions_count: internalActions.length,
          },
          analyticsStepMeta
        )
      );

      await executeStep();
    }, [
      disabled,
      isExecuting,
      isCompletedWithObjectives,
      checker.isEnabled,
      executeStep,
      internalActions.length,
      renderedStepId,
      analyticsStepMeta,
    ]);

    // Handle step reset (redo functionality)
    const handleStepRedo = useCallback(() => {
      if (disabled || isExecuting) {
        return;
      }

      setIsLocallyCompleted(false);
      setExecutionError(null);
      setCurrentStepIndex(0);
      setCurrentStepStatus('waiting');
      setWasCancelled(false);

      if (onStepReset && stepId) {
        onStepReset(stepId);
      }
    }, [disabled, isExecuting, stepId, onStepReset]);

    // Handle skip current step on timeout
    const handleSkipStep = useCallback(async () => {
      // Mark this step as completed and move on
      setIsLocallyCompleted(true);

      if (onStepComplete && stepId) {
        onStepComplete(stepId);
      }

      if (onComplete) {
        onComplete();
      }
    }, [stepId, onStepComplete, onComplete]);

    // Handle retry after timeout or cancellation
    const handleRetry = useCallback(async () => {
      setExecutionError(null);
      setCurrentStepStatus('waiting');
      setWasCancelled(false);
      await executeStep();
    }, [executeStep]);

    // Handle cancel during guided execution
    const handleCancel = useCallback(async () => {
      // Cancel the current guided step
      guidedHandler.cancel();

      // Clear highlights
      const { NavigationManager } = await import('../../../interactive-engine');
      const navManager = new NavigationManager();
      navManager.clearAllHighlights();

      // Reset to initial state - simply revert to "Start guided interaction" button
      setIsExecuting(false);
      setExecutionError(null);
      setCurrentStepIndex(0);
      setCurrentStepStatus('waiting');
      setWasCancelled(false); // Don't show error state - just return to start
    }, [guidedHandler]);

    const isAnyActionRunning = isExecuting || isCurrentlyExecuting;

    // Generate button text
    const getButtonText = () => {
      if (checker.completionReason === 'objectives') {
        return 'Already done!';
      }
      if (checker.isChecking) {
        return checker.isRetrying ? `Checking... (${checker.retryCount}/${checker.maxRetries})` : 'Checking...';
      }
      if (isCompletedWithObjectives) {
        return '✓ Completed';
      }
      if (isExecuting) {
        if (currentStepStatus === 'timeout') {
          return 'Timed out';
        }
        return `Waiting for step ${currentStepIndex + 1}/${internalActions.length}...`;
      }
      if (executionError) {
        return 'Error';
      }
      if (!checker.isEnabled && !isCompletedWithObjectives) {
        return 'Requirements not met';
      }
      return 'Start guided interaction';
    };

    // Generate button title/tooltip
    const getButtonTitle = () => {
      if (checker.completionReason === 'objectives') {
        return 'Already done!';
      }
      if (isExecuting) {
        return `Follow the highlighted instructions. Step ${currentStepIndex + 1} of ${internalActions.length}.`;
      }
      if (!checker.isEnabled) {
        return 'Requirements not met for guided interaction';
      }
      return hints || `Guide you through ${internalActions.length} manual steps`;
    };

    return (
      <div
        className={`interactive-step interactive-guided${className ? ` ${className}` : ''}${
          isCompletedWithObjectives ? ' completed' : ''
        }${isCurrentlyExecuting ? ' executing' : ''}`}
        data-step-id={stepId || renderedStepId}
        data-testid={testIds.interactive.step(renderedStepId)}
      >
        <div className="interactive-step-content">
          {title && <div className="interactive-step-title">{title}</div>}
          {children}
        </div>

        <div className="interactive-step-actions">
          <div className="interactive-step-action-buttons">
            {/* Show "Start" button when not completed */}
            {!isCompletedWithObjectives && checker.isEnabled && !isExecuting && (
              <Button
                onClick={handleDoAction}
                disabled={disabled || isAnyActionRunning || !checker.isEnabled}
                size="sm"
                variant="primary"
                className="interactive-step-do-btn"
                data-testid={testIds.interactive.doItButton(renderedStepId)}
                title={getButtonTitle()}
              >
                {getButtonText()}
              </Button>
            )}

            {/* Show "Cancel" button during execution */}
            {isExecuting && !executionError && (
              <Button
                onClick={handleCancel}
                disabled={disabled}
                size="sm"
                variant="secondary"
                className="interactive-step-cancel-btn"
                title="Cancel guided interaction"
              >
                Cancel
              </Button>
            )}

            {/* Show "Skip" button when guided step is skippable and not executing (always available, not just on error) */}
            {skippable && !isCompletedWithObjectives && !isExecuting && (
              <Button
                onClick={async () => {
                  if (checker.markSkipped) {
                    await checker.markSkipped();

                    // Mark as completed and notify parent
                    setIsLocallyCompleted(true);

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
                title="Skip this guided interaction without executing"
              >
                Skip
              </Button>
            )}
          </div>

          {isCompletedWithObjectives && (
            <div className="interactive-step-completion-group">
              <span
                className="interactive-step-completed-indicator"
                data-testid={testIds.interactive.stepCompleted(renderedStepId)}
              >
                ✓
              </span>
              <button
                className="interactive-step-redo-btn"
                onClick={handleStepRedo}
                disabled={disabled || isAnyActionRunning}
                data-testid={testIds.interactive.redoButton(renderedStepId)}
                title="Redo this guided interaction"
              >
                <span className="interactive-step-redo-icon">↻</span>
                <span className="interactive-step-redo-text">Redo</span>
              </button>
            </div>
          )}
        </div>

        {/* Show explanation when requirements aren't met */}
        {checker.completionReason !== 'objectives' &&
          !checker.isEnabled &&
          !isCompletedWithObjectives &&
          !checker.isChecking &&
          checker.explanation && (
            <div
              className="interactive-step-requirement-explanation"
              data-testid={testIds.interactive.requirementCheck(renderedStepId)}
            >
              {checker.explanation}
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
            </div>
          )}

        {/* Show execution error (timeout or other issues) */}
        {executionError && !checker.isChecking && (
          <div
            className="interactive-step-execution-error"
            data-testid={testIds.interactive.errorMessage(renderedStepId)}
          >
            {executionError}
            <div className="interactive-step-error-buttons">
              <button
                className="interactive-error-retry-btn"
                data-testid={testIds.interactive.requirementRetryButton(renderedStepId)}
                onClick={handleRetry}
              >
                Retry
              </button>
              {skippable && (
                <button
                  className="interactive-requirement-skip-btn"
                  data-testid={testIds.interactive.requirementSkipButton(renderedStepId)}
                  onClick={handleSkipStep}
                >
                  Skip
                </button>
              )}
            </div>
          </div>
        )}

        {/* Show options after cancellation */}
        {wasCancelled && !checker.isChecking && !executionError && (
          <div
            className="interactive-step-execution-error"
            data-testid={testIds.interactive.errorMessage(renderedStepId)}
          >
            Guided interaction was cancelled.
            <div className="interactive-step-error-buttons">
              <button
                className="interactive-error-retry-btn"
                data-testid={testIds.interactive.requirementRetryButton(renderedStepId)}
                onClick={handleRetry}
              >
                Retry
              </button>
              {skippable && (
                <button
                  className="interactive-requirement-skip-btn"
                  data-testid={testIds.interactive.requirementSkipButton(renderedStepId)}
                  onClick={handleSkipStep}
                >
                  Skip
                </button>
              )}
            </div>
          </div>
        )}

        {/* Show progress indicator when executing */}
        {isExecuting && !executionError && (
          <div className="interactive-guided-progress">
            <div className="interactive-guided-progress-text">
              {currentStepStatus === 'waiting' && 'Follow the highlighted instruction'}
              {currentStepStatus === 'completed' && '✓ Moving to next step...'}
            </div>
            <div className="interactive-guided-progress-bar">
              <div
                className="interactive-guided-progress-fill"
                style={{ width: `${((currentStepIndex + 1) / internalActions.length) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>
    );
  }
);

// Add display name for debugging
InteractiveGuided.displayName = 'InteractiveGuided';
