import React, { useState, useCallback, forwardRef, useImperativeHandle, useEffect, useMemo } from 'react';
import { Button } from '@grafana/ui';
import { usePluginContext } from '@grafana/data';

import { useInteractiveElements } from '../../../interactive.hook';
import { useStepChecker } from '../../../step-checker.hook';
import { reportAppInteraction, UserInteraction, buildInteractiveStepProperties } from '../../../../lib/analytics';
import { INTERACTIVE_CONFIG, getInteractiveConfig } from '../../../../constants/interactive-config';
import { matchesStepAction, type DetectedActionEvent } from '../../../action-matcher';
import { getConfigWithDefaults } from '../../../../constants';
import { findButtonByText } from '../../../dom-utils';
import { querySelectorAllEnhanced } from '../../../enhanced-selector';

interface InternalAction {
  targetAction: string;
  refTarget?: string;
  targetValue?: string;
  requirements?: string;
}

interface InteractiveMultiStepProps {
  internalActions: InternalAction[];

  // State management (passed by parent section)
  stepId?: string;
  isEligibleForChecking?: boolean;
  isCompleted?: boolean;
  isCurrentlyExecuting?: boolean;
  onStepComplete?: (stepId: string) => void;
  onStepReset?: (stepId: string) => void; // Signal to parent that step should be reset

  // Content and styling
  title?: string; // Add title prop like InteractiveStep
  children?: React.ReactNode;
  className?: string;
  disabled?: boolean;
  hints?: string;
  requirements?: string; // Overall requirements for the multi-step
  objectives?: string; // Overall objectives for the multi-step
  onComplete?: () => void;
  skippable?: boolean; // Whether this multi-step can be skipped if requirements fail

  // Step position tracking for analytics (added by section)
  stepIndex?: number;
  totalSteps?: number;
  sectionId?: string;
  sectionTitle?: string;

  // Timing configuration
  stepDelay?: number; // Delay between steps in milliseconds (default: 1800ms)
  resetTrigger?: number; // Signal from parent to reset local completion state
}

/**
 * Just-in-time requirements checker for individual actions within a multi-step
 * Uses the interactive hook's checkRequirementsFromData to handle both pure and DOM-dependent checks
 */
async function checkActionRequirements(
  action: InternalAction,
  actionIndex: number,
  checkRequirementsFromData: (data: any) => Promise<any>
): Promise<{ pass: boolean; explanation?: string }> {
  if (!action.requirements) {
    return { pass: true };
  }

  try {
    // Create data structure compatible with checkRequirementsFromData
    const actionData = {
      requirements: action.requirements,
      targetaction: action.targetAction,
      reftarget: action.refTarget || '',
      targetvalue: action.targetValue,
      textContent: `multistep-action-${actionIndex + 1}`,
      tagName: 'span',
    };

    // Check requirements with timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error('Requirements check timeout')),
        INTERACTIVE_CONFIG.delays.requirements.checkTimeout
      );
    });

    const result = await Promise.race([checkRequirementsFromData(actionData), timeoutPromise]);

    if (result.pass) {
      return { pass: true };
    } else {
      // Generate user-friendly explanation
      const errorMessage = result.error?.map((e: any) => e.error || e.requirement).join(', ');
      const explanation = `Step ${actionIndex + 1} requirements not met: ${errorMessage}`;

      return {
        pass: false,
        explanation: explanation,
      };
    }
  } catch (error) {
    console.error(`Requirements check failed for action ${actionIndex + 1}:`, error);
    return {
      pass: false,
      explanation: `Step ${actionIndex + 1} requirements check failed: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    };
  }
}

export const InteractiveMultiStep = forwardRef<{ executeStep: () => Promise<boolean> }, InteractiveMultiStepProps>(
  (
    {
      internalActions,
      stepId,
      isEligibleForChecking = true,
      isCompleted: parentCompleted = false,
      isCurrentlyExecuting = false,
      onStepComplete,
      onStepReset, // New callback for individual step reset
      title, // Add title prop
      children,
      className,
      disabled = false,
      hints,
      requirements,
      objectives,
      onComplete,
      skippable = false, // Whether this multi-step can be skipped
      stepDelay = INTERACTIVE_CONFIG.delays.multiStep.defaultStepDelay, // Default delay between steps
      resetTrigger,
      stepIndex,
      totalSteps,
      sectionId,
      sectionTitle,
    },
    ref
  ) => {
    // Local UI state (similar to InteractiveStep)
    const [isLocallyCompleted, setIsLocallyCompleted] = useState(false);
    const [isExecuting, setIsExecuting] = useState(false);
    const [currentActionIndex, setCurrentActionIndex] = useState(-1);
    const [executionError, setExecutionError] = useState<string | null>(null);

    // Track which internal actions have been auto-completed by user
    const [autoCompletedActions, setAutoCompletedActions] = useState<Set<number>>(new Set());

    // Get plugin configuration for auto-detection settings
    const pluginContext = usePluginContext();
    const interactiveConfig = useMemo(() => {
      const config = getConfigWithDefaults(pluginContext?.meta?.jsonData || {});
      return getInteractiveConfig(config);
    }, [pluginContext?.meta?.jsonData]);

    // Use ref for cancellation to avoid closure issues
    const isCancelledRef = React.useRef(false);

    // Handle reset trigger from parent section
    useEffect(() => {
      if (resetTrigger && resetTrigger > 0) {
        setIsLocallyCompleted(false);
        setExecutionError(null); // Also clear any execution errors
        setAutoCompletedActions(new Set()); // Clear auto-completed actions
        isCancelledRef.current = false; // Reset cancellation state
      }
    }, [resetTrigger, stepId]);

    // Combined completion state (parent takes precedence for coordination)
    const isCompleted = parentCompleted || isLocallyCompleted;

    // Get the interactive functions from the hook
    const {
      executeInteractiveAction,
      checkRequirementsFromData,
      startSectionBlocking,
      stopSectionBlocking,
      isSectionBlocking,
    } = useInteractiveElements();

    // Use step checker hook for overall multi-step requirements and objectives
    const checker = useStepChecker({
      requirements,
      objectives,
      hints,
      stepId: stepId || `multistep-${Date.now()}`,
      isEligibleForChecking: isEligibleForChecking && !isCompleted,
    });

    // Combined completion state: objectives always win (clarification 1, 2, 18)
    const isCompletedWithObjectives =
      parentCompleted || isLocallyCompleted || checker.completionReason === 'objectives';

    // Create cancellation handler
    const handleMultiStepCancel = useCallback(() => {
      isCancelledRef.current = true; // Set ref for immediate access
      // The running loop will detect this and break
    }, []);

    // Main execution logic (similar to InteractiveSection's sequence execution)
    const executeStep = useCallback(async (): Promise<boolean> => {
      // When called via ref (section execution), ignore disabled prop to avoid race conditions
      // Only check if not enabled, completed, or already executing
      if (!checker.isEnabled || isCompletedWithObjectives || isExecuting) {
        return false;
      }

      // Check objectives before executing internal actions (clarification 18)
      if (checker.completionReason === 'objectives') {
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
      }

      setIsExecuting(true);
      setExecutionError(null);

      isCancelledRef.current = false; // Reset ref as well

      // Clear any existing highlights before starting multi-step execution
      const { NavigationManager } = await import('../../../navigation-manager');
      const navigationManager = new NavigationManager();
      navigationManager.clearAllHighlights();

      // Check if we're already in a section blocking state (nested in a section)
      const isNestedInSection = isSectionBlocking();
      const multiStepId = stepId || `multistep-${Date.now()}`;

      // Only start blocking if we're not already in a blocking state (avoid double-blocking)
      if (!isNestedInSection) {
        // Create dummy data for blocking overlay
        const dummyData = {
          reftarget: `multistep-${multiStepId}`,
          targetaction: 'multistep',
          targetvalue: undefined,
          requirements: undefined,
          tagName: 'div',
          textContent: title || 'Interactive Multi-Step',
          timestamp: Date.now(),
        };
        startSectionBlocking(multiStepId, dummyData, handleMultiStepCancel);
      }

      try {
        // Execute each internal action in sequence
        for (let i = 0; i < internalActions.length; i++) {
          const action = internalActions[i];

          // Check for cancellation before each action
          if (isCancelledRef.current) {
            break;
          }
          setCurrentActionIndex(i);

          // Just-in-time requirements checking for this specific action
          if (action.requirements) {
            const requirementsResult = await checkActionRequirements(action, i, checkRequirementsFromData);
            if (!requirementsResult.pass) {
              console.error(
                `Multi-step ${stepId}: Internal action ${i + 1} requirements failed`,
                requirementsResult.explanation
              );
              setExecutionError(requirementsResult.explanation || 'Action requirements not met');
              return false;
            }
          }

          // Execute the action (show first, then do)
          try {
            // Show mode (highlight what will be acted upon)
            await executeInteractiveAction(action.targetAction, action.refTarget || '', action.targetValue, 'show');

            // Delay between show and do with cancellation check
            for (let j = 0; j < INTERACTIVE_CONFIG.delays.multiStep.showToDoIterations; j++) {
              if (isCancelledRef.current) {
                break;
              }
              await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.multiStep.baseInterval));
            }
            if (isCancelledRef.current) {
              continue;
            } // Skip to cancellation check at loop start

            // Do mode (actually perform the action)
            await executeInteractiveAction(action.targetAction, action.refTarget || '', action.targetValue, 'do');

            // Wait for DOM to settle after action
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            await new Promise((resolve) => setTimeout(resolve, 200));

            // Add delay between steps with cancellation check (but not after the last step)
            if (i < internalActions.length - 1 && stepDelay > 0) {
              const delaySteps = Math.ceil(stepDelay / INTERACTIVE_CONFIG.delays.multiStep.baseInterval); // Convert delay to base interval steps
              for (let j = 0; j < delaySteps; j++) {
                if (isCancelledRef.current) {
                  break;
                }
                await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.multiStep.baseInterval));
              }
            }
          } catch (actionError) {
            console.error(`Multi-step ${stepId}: Internal action ${i + 1} execution failed`, actionError);
            const errorMessage = actionError instanceof Error ? actionError.message : 'Action execution failed';
            setExecutionError(`Step ${i + 1} failed: ${errorMessage}`);
            return false;
          }
        }

        // Check if execution was cancelled
        if (isCancelledRef.current) {
          return false;
        }

        // All internal actions completed successfully
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
        console.error(`Multi-step execution failed: ${stepId}`, error);
        const errorMessage = error instanceof Error ? error.message : 'Multi-step execution failed';
        setExecutionError(errorMessage);
        return false;
      } finally {
        // Stop blocking overlay if we started it (not nested in section)
        if (!isNestedInSection) {
          stopSectionBlocking(multiStepId);
        }

        setIsExecuting(false);
        setCurrentActionIndex(-1);
      }
    }, [
      checker.isEnabled,
      isCompletedWithObjectives,
      isExecuting,
      stepId,
      internalActions,
      executeInteractiveAction,
      checkRequirementsFromData,
      onStepComplete,
      onComplete,
      checker.completionReason,
      stepDelay,
      startSectionBlocking,
      stopSectionBlocking,
      isSectionBlocking,
      handleMultiStepCancel,
      title,
    ]);

    // Expose execute method for parent (sequence execution)
    useImperativeHandle(
      ref,
      () => ({
        executeStep,
      }),
      [executeStep]
    );

    // Auto-detection: Listen for user actions and track completion of internal actions
    useEffect(() => {
      // Only enable auto-detection if:
      // 1. Feature is enabled in config
      // 2. Step is eligible and enabled
      // 3. Step is not already completed
      // 4. Step is not currently executing (avoid race conditions)
      if (
        !interactiveConfig.autoDetection.enabled ||
        !checker.isEnabled ||
        isCompletedWithObjectives ||
        isCurrentlyExecuting ||
        disabled
      ) {
        return;
      }

      const handleActionDetected = async (event: Event) => {
        const customEvent = event as CustomEvent<DetectedActionEvent>;
        const detectedAction = customEvent.detail;

        // Check which internal action (if any) matches the detected action
        let matchedActionIndex = -1;
        for (let i = 0; i < internalActions.length; i++) {
          const action = internalActions[i];

          // Try to find target element for coordinate-based matching
          // Using synchronous resolution to avoid timing issues with dynamic menus/dropdowns
          let targetElement: HTMLElement | null = null;
          try {
            const actionType = action.targetAction;
            const selector = action.refTarget || '';

            if (actionType === 'button') {
              // Use button-specific finder for text matching
              const buttons = findButtonByText(selector);
              targetElement = buttons[0] || null;
            } else if (actionType === 'highlight' || actionType === 'hover') {
              // Use enhanced selector for other action types
              const result = querySelectorAllEnhanced(selector);
              targetElement = result.elements[0] || null;
            }
            // Note: formfill and navigate don't use coordinate matching
          } catch (error) {
            // Element resolution failed, fall back to selector-based matching
            console.warn('Failed to resolve target element for coordinate matching:', error);
          }

          // Check if action matches (with coordinate support)
          const matches = matchesStepAction(
            detectedAction,
            {
              targetAction: action.targetAction as any,
              refTarget: action.refTarget || '',
              targetValue: action.targetValue,
            },
            targetElement
          );

          if (matches) {
            matchedActionIndex = i;
            break;
          }
        }

        if (matchedActionIndex === -1) {
          return; // No match found
        }

        // Check if this action was already completed
        if (autoCompletedActions.has(matchedActionIndex)) {
          return; // Already counted
        }

        // Mark this action as completed
        setAutoCompletedActions((prev) => {
          const newSet = new Set(prev);
          newSet.add(matchedActionIndex);
          return newSet;
        });

        // Check if all actions are now completed
        const newCompletedCount = autoCompletedActions.size + 1;
        if (newCompletedCount >= internalActions.length) {
          // Mark entire multi-step as completed
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
                target_action: 'multistep',
                ref_target: stepId || 'unknown',
                interaction_location: 'interactive_multi_step_auto',
                completion_method: 'auto_detected',
                internal_actions_count: internalActions.length,
              },
              { stepId, stepIndex, totalSteps, sectionId, sectionTitle }
            )
          );
        }
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
      isCurrentlyExecuting,
      disabled,
      internalActions,
      autoCompletedActions,
      stepId,
      onStepComplete,
      onComplete,
      stepIndex,
      totalSteps,
      sectionId,
      sectionTitle,
    ]);

    // Handle "Do it" button click
    const handleDoAction = useCallback(async () => {
      if (disabled || isExecuting || isCompletedWithObjectives || !checker.isEnabled) {
        return;
      }

      // Track "Do it" button click analytics for multi-step
      reportAppInteraction(
        UserInteraction.DoItButtonClick,
        buildInteractiveStepProperties(
          {
            target_action: 'multistep',
            ref_target: stepId || 'unknown',
            interaction_location: 'interactive_multi_step',
            internal_actions_count: internalActions.length,
          },
          { stepId, stepIndex, totalSteps, sectionId, sectionTitle }
        )
      );

      await executeStep();
    }, [
      disabled,
      isExecuting,
      isCompletedWithObjectives,
      checker.isEnabled,
      executeStep,
      stepId,
      internalActions.length,
      stepIndex,
      totalSteps,
      sectionId,
      sectionTitle,
    ]);

    // Handle individual step reset (redo functionality)
    const handleStepRedo = useCallback(async () => {
      if (disabled || isExecuting) {
        return;
      }

      // Reset local completion state
      setIsLocallyCompleted(false);

      // Clear any execution errors
      setExecutionError(null);

      // Reset cancellation state
      isCancelledRef.current = false;

      // Notify parent section to remove from completed steps
      // The section is the authoritative source - it will update its state
      // and the eligibility will be recalculated on the next render
      if (onStepReset && stepId) {
        onStepReset(stepId);
      }

      // No need for complex timing logic - the section's getStepEligibility
      // will use the updated completedSteps state on the next render
    }, [disabled, isExecuting, stepId, onStepReset]); // eslint-disable-line react-hooks/exhaustive-deps
    // Intentionally excluding to prevent circular dependencies:
    // - setIsLocallyCompleted, setExecutionError: stable React setters
    // - isCancelledRef: ref changes don't trigger re-creation, including would cause unnecessary updates

    const isAnyActionRunning = isExecuting || isCurrentlyExecuting;

    // Generate button text based on current state
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
        return currentActionIndex >= 0
          ? `Executing ${currentActionIndex + 1}/${internalActions.length}...`
          : 'Executing...';
      }
      if (executionError) {
        return executionError;
      }
      if (!checker.isEnabled && !isCompletedWithObjectives) {
        return 'Requirements not met';
      }
      return 'Do it';
    };

    // Generate button title/tooltip based on current state
    const getButtonTitle = () => {
      if (checker.completionReason === 'objectives') {
        return 'Already done!';
      }
      if (checker.isChecking) {
        return checker.isRetrying
          ? `Checking requirements... (${checker.retryCount}/${checker.maxRetries})`
          : 'Checking requirements...';
      }
      if (isCompletedWithObjectives) {
        return 'Multi-step completed';
      }
      if (isExecuting) {
        return 'Multi-step execution in progress...';
      }
      if (executionError) {
        return `Execution failed: ${executionError}`;
      }
      if (!checker.isEnabled && !isCompletedWithObjectives) {
        return 'Requirements not met for multi-step execution';
      }
      return hints || `Execute ${internalActions.length} steps in sequence with section-like timing`;
    };

    return (
      <div
        className={`interactive-step${className ? ` ${className}` : ''}${
          isCompletedWithObjectives ? ' completed' : ''
        }${isCurrentlyExecuting ? ' executing' : ''}`}
      >
        <div className="interactive-step-content">
          {title && <div className="interactive-step-title">{title}</div>}
          {children}
        </div>

        <div className="interactive-step-actions">
          <div className="interactive-step-action-buttons">
            {/* Only show "Do it" when not completed */}
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

            {/* Show "Skip" button when multi-step is skippable (always available, not just on error) */}
            {skippable && !isCompletedWithObjectives && (
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
                title="Skip this multi-step without executing"
              >
                Skip
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
                title="Redo this multi-step (execute again)"
              >
                <span className="interactive-step-redo-icon">↻</span>
                <span className="interactive-step-redo-text">Redo</span>
              </button>
            </div>
          )}
        </div>

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

        {/* Show execution error when available */}
        {executionError && !checker.isChecking && (
          <div className="interactive-step-execution-error">
            {executionError}
            <button
              className="interactive-error-retry-btn"
              onClick={async () => {
                setExecutionError(null);
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
InteractiveMultiStep.displayName = 'InteractiveMultiStep';
