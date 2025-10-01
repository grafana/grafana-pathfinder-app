import React, { useState, useCallback, forwardRef, useImperativeHandle, useEffect, useMemo } from 'react';
import { Button } from '@grafana/ui';

import { useStepChecker } from '../../../step-checker.hook';
import { reportAppInteraction, UserInteraction } from '../../../../lib/analytics';
import { GuidedHandler } from '../../../action-handlers/guided-handler';
import { InteractiveStateManager } from '../../../interactive-state-manager';
import { NavigationManager } from '../../../navigation-manager';
import { waitForReactUpdates } from '../../../requirements-checker.hook';

interface InternalAction {
  targetAction: 'hover' | 'button' | 'highlight';
  refTarget: string;
  targetValue?: string;
  requirements?: string;
  targetComment?: string; // Optional comment to display in tooltip during this step
}

interface InteractiveGuidedProps {
  internalActions: InternalAction[];

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
      stepTimeout = 30000, // 30 second default timeout per step
      resetTrigger,
    },
    ref
  ) => {
    // Local UI state
    const [isLocallyCompleted, setIsLocallyCompleted] = useState(false);
    const [isExecuting, setIsExecuting] = useState(false);
    const [currentStepIndex, setCurrentStepIndex] = useState(0);
    const [currentStepStatus, setCurrentStepStatus] = useState<'waiting' | 'timeout' | 'completed'>('waiting');
    const [executionError, setExecutionError] = useState<string | null>(null);

    // Create guided handler instance
    const guidedHandler = useMemo(() => {
      const stateManager = new InteractiveStateManager();
      const navigationManager = new NavigationManager();
      return new GuidedHandler(stateManager, navigationManager, waitForReactUpdates);
    }, []);

    // Helper function to get current document name for analytics
    const getDocumentInfo = useCallback(() => {
      try {
        const tabUrl = (window as any).__DocsPluginActiveTabUrl as string | undefined;
        const contentKey = (window as any).__DocsPluginContentKey as string | undefined;
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

    // Handle reset trigger from parent section
    useEffect(() => {
      if (resetTrigger && resetTrigger > 0) {
        setIsLocallyCompleted(false);
        setExecutionError(null);
        setCurrentStepIndex(0);
        setCurrentStepStatus('waiting');
      }
    }, [resetTrigger]);

    // Combined completion state
    const isCompleted = parentCompleted || isLocallyCompleted;

    // Use step checker hook for requirements and objectives
    const checker = useStepChecker({
      requirements,
      objectives,
      hints,
      stepId: stepId || `guided-${Date.now()}`,
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

      setIsExecuting(true);
      setExecutionError(null);
      setCurrentStepIndex(0);
      setCurrentStepStatus('waiting');

      const { NavigationManager } = await import('../../../navigation-manager');
      const navManager = new NavigationManager();
      navManager.clearAllHighlights();

      try {
        // Execute each internal action in sequence, waiting for user
        for (let i = 0; i < internalActions.length; i++) {
          const action = internalActions[i];
          setCurrentStepIndex(i);
          setCurrentStepStatus('waiting');

          // Execute guided step and wait for user completion
          const result = await guidedHandler.executeGuidedStep(action, i, internalActions.length, stepTimeout);

          if (result === 'completed') {
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
        
        setIsLocallyCompleted(true);

        if (onStepComplete && stepId) {
          onStepComplete(stepId);
        }

        if (onComplete) {
          onComplete();
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

    // Handle "Do it" button click
    const handleDoAction = useCallback(async () => {
      if (disabled || isExecuting || isCompletedWithObjectives || !checker.isEnabled) {
        return;
      }

      // Track analytics
      const docInfo = getDocumentInfo();
      reportAppInteraction(UserInteraction.DoItButtonClick, {
        ...docInfo,
        target_action: 'guided',
        ref_target: stepId || 'unknown',
        interaction_location: 'interactive_guided',
        internal_actions_count: internalActions.length,
      });

      await executeStep();
    }, [
      disabled,
      isExecuting,
      isCompletedWithObjectives,
      checker.isEnabled,
      executeStep,
      getDocumentInfo,
      stepId,
      internalActions.length,
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

    // Handle retry after timeout
    const handleRetry = useCallback(async () => {
      setExecutionError(null);
      setCurrentStepStatus('waiting');
      await executeStep();
    }, [executeStep]);

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
      >
        <div className="interactive-step-content">
          {title && <div className="interactive-step-title">{title}</div>}
          {children}
        </div>

        <div className="interactive-step-actions">
          <div className="interactive-step-action-buttons">
            {/* Show "Start" button when not completed */}
            {!isCompletedWithObjectives && checker.isEnabled && (
              <Button
                onClick={handleDoAction}
                disabled={disabled || isAnyActionRunning || !checker.isEnabled}
                size="sm"
                variant="primary"
                className="interactive-step-do-btn"
                title={getButtonTitle()}
              >
                {getButtonText()}
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

        {/* Show execution error (timeout or other issues) */}
        {executionError && !checker.isChecking && (
          <div className="interactive-step-execution-error">
            {executionError}
            <div className="interactive-step-error-buttons">
              <button className="interactive-error-retry-btn" onClick={handleRetry}>
                Retry
              </button>
              {skippable && (
                <button className="interactive-requirement-skip-btn" onClick={handleSkipStep}>
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
              Step {currentStepIndex + 1} of {internalActions.length}
              {currentStepStatus === 'waiting' && ' - Follow the highlighted instruction'}
              {currentStepStatus === 'completed' && ' - ✓ Moving to next step...'}
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
