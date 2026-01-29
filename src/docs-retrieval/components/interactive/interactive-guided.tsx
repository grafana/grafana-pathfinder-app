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
import { sanitizeDocumentationHTML } from '../../../security';

/**
 * SafeHTML - Renders sanitized HTML as React components
 * Parses simple HTML (strong, em, code, etc.) into React elements without dangerouslySetInnerHTML
 * SECURITY: HTML is sanitized before parsing
 */
function SafeHTML({ html, className }: { html: string; className?: string }) {
  const sanitized = sanitizeDocumentationHTML(html);

  // Parse the sanitized HTML into React elements
  const elements = useMemo(() => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(sanitized, 'text/html');

    function nodeToReact(node: Node, key: number): React.ReactNode {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent;
      }

      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element;
        const tagName = element.tagName.toLowerCase();

        // Only allow safe inline elements
        const allowedTags = ['strong', 'b', 'em', 'i', 'code', 'span', 'br', 'a'];
        if (!allowedTags.includes(tagName)) {
          // For disallowed tags, just render children
          return Array.from(node.childNodes).map((child, i) => nodeToReact(child, i));
        }

        const children = Array.from(node.childNodes).map((child, i) => nodeToReact(child, i));

        // Build props safely
        const props: Record<string, unknown> = { key };

        if (tagName === 'a') {
          const href = element.getAttribute('href');
          if (href) {
            props.href = href;
            props.target = '_blank';
            props.rel = 'noopener noreferrer';
          }
        }

        return React.createElement(tagName, props, ...children);
      }

      return null;
    }

    return Array.from(doc.body.childNodes).map((node, i) => nodeToReact(node, i));
  }, [sanitized]);

  return <span className={className}>{elements}</span>;
}

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
  stepTimeout?: number; // Timeout per step in milliseconds (default: 120000ms = 2min)
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
      stepTimeout = 120000, // 2 minute default timeout per step
      resetTrigger,
      stepIndex,
      totalSteps,
      sectionId,
      sectionTitle,
    },
    ref
  ) => {
    const generatedStepIdRef = useRef<string | undefined>(undefined);
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

    // Cleanup on unmount: cancel any running guided interaction and clear highlights
    useEffect(() => {
      return () => {
        guidedHandler.cancel();
        const navManager = new NavigationManager();
        navManager.clearAllHighlights();
      };
    }, [guidedHandler]);

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

    // For exists-reftarget requirement, use the first internal action's target
    // This ensures the requirement checker knows which element to look for
    const firstActionRefTarget = internalActions.length > 0 ? internalActions[0].refTarget : undefined;
    const firstActionTargetAction = internalActions.length > 0 ? internalActions[0].targetAction : undefined;

    // Runtime validation: check for impossible requirement configurations
    useEffect(() => {
      validateInteractiveRequirements(
        {
          requirements,
          refTarget: firstActionRefTarget, // Use first internal action's refTarget for validation
          stepId: renderedStepId,
        },
        'InteractiveGuided'
      );
    }, [requirements, renderedStepId, firstActionRefTarget]);

    // Use step checker hook for requirements and objectives
    const checker = useStepChecker({
      requirements,
      objectives,
      hints,
      stepId: stepId || renderedStepId,
      isEligibleForChecking: isEligibleForChecking && !isCompleted,
      skippable,
      refTarget: firstActionRefTarget,
      targetAction: firstActionTargetAction,
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

      // Progress persists between sessions - reset only via explicit "Restart section" button

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
            // Clear highlights when timeout occurs so user can interact with page
            navManager.clearAllHighlights();
            setCurrentStepStatus('timeout');
            setExecutionError(`Step ${i + 1} timed out. Click "Skip" to continue or "Retry" to try again.`);
            return false;
          } else if (result === 'cancelled') {
            // Clear highlights when cancelled
            navManager.clearAllHighlights();
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

        // Skip auto-detection for noop actions - they don't have a target element
        if (currentAction.targetAction === 'noop') {
          return;
        }

        // Non-noop actions require refTarget
        const selector = currentAction.refTarget;
        if (!selector) {
          return;
        }

        // Try to find target element for coordinate-based matching
        // Using synchronous resolution to avoid timing issues with dynamic menus/dropdowns
        let targetElement: HTMLElement | null = null;
        try {
          const actionType = currentAction.targetAction;

          if (actionType === 'button') {
            // Use button-specific finder for text matching
            const buttons = findButtonByText(selector);
            targetElement = buttons[0] || null;
          } else if (actionType === 'highlight' || actionType === 'hover') {
            // Use enhanced selector for other action types
            const result = querySelectorAllEnhanced(selector);
            targetElement = result.elements[0] || null;
          } else if (actionType === 'formfill') {
            // Find form elements for formfill actions
            const result = querySelectorAllEnhanced(selector);
            const formElements = result.elements.filter((el) => {
              const tag = el.tagName.toLowerCase();
              return tag === 'input' || tag === 'textarea' || tag === 'select';
            });
            targetElement = formElements[0] || null;
          }
        } catch (error) {
          // Element resolution failed, fall back to selector-based matching
          console.warn('Failed to resolve target element for coordinate matching:', error);
        }

        // Check if action matches (with coordinate support)
        const matches = matchesStepAction(
          detectedAction,
          {
            targetAction: currentAction.targetAction as 'button' | 'highlight' | 'hover' | 'formfill',
            refTarget: selector,
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
              internal_step_number: currentStepIndex + 1,
              internal_actions_count: internalActions.length,
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

    // Get current action info for display
    const currentAction = internalActions[currentStepIndex];
    const currentActionComment = currentAction?.targetComment || 'Complete this step';

    // Determine the current UI state for cleaner rendering
    const uiState = (() => {
      if (isCompletedWithObjectives) {
        return 'completed';
      }
      if (executionError) {
        return 'error';
      }
      if (wasCancelled) {
        return 'cancelled';
      }
      if (isExecuting) {
        return 'executing';
      }
      if (checker.isChecking) {
        return 'checking';
      }
      if (!checker.isEnabled) {
        return 'requirements-not-met';
      }
      return 'idle';
    })();

    return (
      <div
        className={`interactive-step interactive-guided${className ? ` ${className}` : ''}${uiState === 'completed' ? ' completed' : ''} interactive-guided--${uiState}`}
        data-step-id={stepId || renderedStepId}
        data-state={uiState}
        data-testid={testIds.interactive.step(renderedStepId)}
      >
        {/* Title and description - always shown */}
        <div className="interactive-step-content">
          {title && <div className="interactive-step-title">{title}</div>}
          {children}
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            STATE: IDLE - Ready to start
        ═══════════════════════════════════════════════════════════════════ */}
        {uiState === 'idle' && (
          <div className="interactive-guided-idle">
            <div className="interactive-guided-actions">
              <Button
                onClick={handleDoAction}
                disabled={disabled || isAnyActionRunning}
                size="sm"
                variant="primary"
                className="interactive-guided-start-btn"
                data-testid={testIds.interactive.doItButton(renderedStepId)}
                title={
                  hints || `Guide you through ${internalActions.length} step${internalActions.length > 1 ? 's' : ''}`
                }
              >
                ▶ Start guided interaction
              </Button>
              {skippable && (
                <Button
                  onClick={async () => {
                    if (checker.markSkipped) {
                      await checker.markSkipped();
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
                  className="interactive-guided-skip-btn"
                  data-testid={testIds.interactive.skipButton(renderedStepId)}
                >
                  Skip
                </Button>
              )}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            STATE: CHECKING - Verifying requirements (only show if no explanation to recheck)
        ═══════════════════════════════════════════════════════════════════ */}
        {uiState === 'checking' && !checker.explanation && (
          <div className="interactive-guided-checking">
            <div className="interactive-guided-status">
              <span className="interactive-guided-spinner" />
              <span className="interactive-guided-status-text">
                {checker.isRetrying
                  ? `Checking requirements (${checker.retryCount}/${checker.maxRetries})...`
                  : 'Checking requirements...'}
              </span>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            STATE: REQUIREMENTS NOT MET (also show during rechecking)
        ═══════════════════════════════════════════════════════════════════ */}
        {(uiState === 'requirements-not-met' || (uiState === 'checking' && checker.explanation)) &&
          checker.explanation && (
            <div className={`interactive-guided-requirements${checker.isChecking ? ' rechecking' : ''}`}>
              <div className="interactive-guided-requirement-box">
                <span className="interactive-guided-requirement-icon">👣</span>
                <span className="interactive-guided-requirement-text">{checker.explanation}</span>
                {checker.isChecking && <span className="interactive-requirement-spinner">⟳</span>}
              </div>
              <button
                className="interactive-guided-fix-btn"
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
                {checker.canFixRequirement ? 'Fix this' : 'Check again'}
              </button>
            </div>
          )}

        {/* ═══════════════════════════════════════════════════════════════════
            STATE: EXECUTING - Waiting for user action
        ═══════════════════════════════════════════════════════════════════ */}
        {uiState === 'executing' && (
          <div className="interactive-guided-executing">
            {/* Step indicator */}
            <div className="interactive-guided-step-indicator">
              <span className="interactive-guided-step-badge">
                Step {currentStepIndex + 1} of {internalActions.length}
              </span>
              {currentStepStatus === 'completed' && <span className="interactive-guided-step-done">✓</span>}
            </div>

            {/* Current instruction */}
            <div className="interactive-guided-instruction">
              {currentStepStatus === 'waiting' && (
                <>
                  <span className="interactive-guided-instruction-icon">👆</span>
                  <SafeHTML html={currentActionComment} className="interactive-guided-instruction-text" />
                </>
              )}
              {currentStepStatus === 'completed' && (
                <>
                  <span className="interactive-guided-instruction-icon">✓</span>
                  <span className="interactive-guided-instruction-text">Step completed! Moving on...</span>
                </>
              )}
            </div>

            {/* Progress bar */}
            <div className="interactive-guided-progress">
              <div
                className="interactive-guided-progress-fill"
                style={{ width: `${(currentStepIndex / internalActions.length) * 100}%` }}
              />
              <div
                className="interactive-guided-progress-active"
                style={{
                  left: `${(currentStepIndex / internalActions.length) * 100}%`,
                  width: `${(1 / internalActions.length) * 100}%`,
                }}
              />
            </div>

            {/* Cancel button */}
            <Button
              onClick={handleCancel}
              disabled={disabled}
              size="sm"
              variant="secondary"
              className="interactive-guided-cancel-btn"
              title="Cancel guided tour"
            >
              Cancel tour
            </Button>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            STATE: ERROR - Timeout or execution failure
        ═══════════════════════════════════════════════════════════════════ */}
        {uiState === 'error' && (
          <div className="interactive-guided-error" data-testid={testIds.interactive.errorMessage(renderedStepId)}>
            <div className="interactive-guided-error-box">
              <span className="interactive-guided-error-icon">✕</span>
              <div className="interactive-guided-error-content">
                <span className="interactive-guided-error-title">Step {currentStepIndex + 1} didn&apos;t complete</span>
                <span className="interactive-guided-error-detail">
                  {currentStepStatus === 'timeout' ? 'Timed out waiting for action' : 'Something went wrong'}
                </span>
              </div>
            </div>
            <div className="interactive-guided-error-actions">
              <Button
                onClick={handleRetry}
                size="sm"
                variant="primary"
                className="interactive-guided-retry-btn"
                data-testid={testIds.interactive.requirementRetryButton(renderedStepId)}
              >
                ↻ Try again
              </Button>
              {skippable && (
                <Button
                  onClick={handleSkipStep}
                  size="sm"
                  variant="secondary"
                  className="interactive-guided-skip-btn"
                  data-testid={testIds.interactive.requirementSkipButton(renderedStepId)}
                >
                  Skip this step
                </Button>
              )}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            STATE: CANCELLED - User cancelled the tour
        ═══════════════════════════════════════════════════════════════════ */}
        {uiState === 'cancelled' && (
          <div className="interactive-guided-cancelled" data-testid={testIds.interactive.errorMessage(renderedStepId)}>
            <div className="interactive-guided-cancelled-box">
              <span className="interactive-guided-cancelled-text">Tour cancelled</span>
            </div>
            <div className="interactive-guided-cancelled-actions">
              <Button
                onClick={handleRetry}
                size="sm"
                variant="primary"
                className="interactive-guided-restart-btn"
                data-testid={testIds.interactive.requirementRetryButton(renderedStepId)}
              >
                ↻ Restart tour
              </Button>
              {skippable && (
                <Button
                  onClick={handleSkipStep}
                  size="sm"
                  variant="secondary"
                  className="interactive-guided-skip-btn"
                  data-testid={testIds.interactive.requirementSkipButton(renderedStepId)}
                >
                  Skip entirely
                </Button>
              )}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            STATE: COMPLETED
        ═══════════════════════════════════════════════════════════════════ */}
        {uiState === 'completed' && (
          <div className="interactive-guided-completed">
            <div className="interactive-guided-completed-badge">
              <span
                className="interactive-guided-completed-icon"
                data-testid={testIds.interactive.stepCompleted(renderedStepId)}
              >
                ✓
              </span>
              <span className="interactive-guided-completed-text">Completed</span>
            </div>
            <button
              className="interactive-guided-redo-btn"
              onClick={handleStepRedo}
              disabled={disabled || isAnyActionRunning}
              data-testid={testIds.interactive.redoButton(renderedStepId)}
              title="Redo this guided tour"
            >
              ↻ Redo
            </button>
          </div>
        )}
      </div>
    );
  }
);

// Add display name for debugging
InteractiveGuided.displayName = 'InteractiveGuided';
