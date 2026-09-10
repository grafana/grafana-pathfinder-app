import type { ConditionInput } from '../../types/requirements.types';
import React, { useState, useCallback, forwardRef, useImperativeHandle, useEffect, useMemo, useRef } from 'react';
import { Button } from '@grafana/ui';
import { usePluginContext } from '@grafana/data';
import { getAppEvents } from '@grafana/runtime';

import { reportAppInteraction, UserInteraction, buildInteractiveStepProperties } from '../../lib/analytics';
import {
  GuidedHandler,
  InteractiveStateManager,
  NavigationManager,
  matchesStepAction,
  type DetectedActionEvent,
} from '../../interactive-engine';
import { waitForReactUpdates } from '../../lib/async-utils';
import { logger } from '../../lib/logging';
import { useGuideRequirements, useStepChecker, validateInteractiveRequirements } from '../../requirements-manager';
import { getGuidedStepTimeout, getInteractiveConfig } from '../../constants/interactive-config';
import { getConfigWithDefaults } from '../../constants';
import { findButtonByText, querySelectorAllEnhanced } from '../../lib/dom';
import type { GuidedAction, GuidedRequirementsCheck, GuidedSubstepResult } from '../../types/interactive-actions.types';
import { testIds } from '../../constants/testIds';
// Deep import (not the barrel): the barrel re-exports @grafana/assistant, which crashes under jsdom.
import { useAiFixEnabled } from '../../integrations/assistant-integration/use-ai-fix-enabled';
import { sanitizeDocumentationHTML } from '../../security';
import { STEP_STATES, type StepStateValue } from './step-states';
import { AiFixButton } from './ai-fix-button';
import { markStepCompleted, resetStep, useStepCompletion } from '../../global-state/completion-store';
import { useInteractiveMode } from '../../global-state/interactive-mode-context';
import { useControllerChannel } from '../../global-state/controller-channel';
import { isGrafanaDrivingHandoffNeeded, requestSidebarHandoffAndWait } from '../../global-state/panel-mode';
import { toCrossTabInternalAction } from '../../types/cross-tab.types';
import type { ProgressReason } from '../../global-state/progress-events';
import { getTrackedStepRootAttributes } from './tracked-step-root-attributes';
import { getContentKey } from '../../global-state/content-key';

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

interface InteractiveGuidedProps {
  internalActions: GuidedAction[];

  // State management (passed by parent section)
  stepId?: string;
  isEligibleForChecking?: boolean;
  isCurrentlyExecuting?: boolean;
  onStepComplete?: (stepId: string) => void;
  onStepReset?: (stepId: string) => void;

  // Content and styling
  title?: string;
  children?: React.ReactNode;
  className?: string;
  disabled?: boolean;
  hints?: string;
  requirements?: ConditionInput;
  objectives?: ConditionInput;
  onComplete?: () => void;
  skippable?: boolean;
  completeEarly?: boolean;

  // Step position tracking for analytics (added by section)
  stepIndex?: number;
  totalSteps?: number;
  sectionId?: string;
  sectionTitle?: string;

  // Guided-specific configuration
  stepTimeout?: number; // Timeout per step in milliseconds (default: 120000ms = 2min)
  resetTrigger?: number;

  /** Resolved step/milestone/course location for the full-screen -> sidebar handoff. See interactive-engine/interactive.hook.ts. */
  fullScreenFallbackLocation?: string;
}

interface GuidedUiStateInput {
  isCompleted: boolean;
  isCompletedByObjectives: boolean;
  isExecuting: boolean;
  hasError: boolean;
  wasCancelled: boolean;
  isChecking: boolean;
  isEnabled: boolean;
}

export function deriveGuidedUiState(input: GuidedUiStateInput): StepStateValue {
  if (input.isExecuting) {
    return STEP_STATES.EXECUTING;
  }
  if (input.isCompletedByObjectives) {
    return STEP_STATES.COMPLETED;
  }
  if (input.hasError) {
    return STEP_STATES.ERROR;
  }
  if (input.wasCancelled) {
    return STEP_STATES.CANCELLED;
  }
  if (input.isCompleted) {
    return STEP_STATES.COMPLETED;
  }
  if (input.isChecking) {
    return STEP_STATES.CHECKING;
  }
  return input.isEnabled ? STEP_STATES.IDLE : STEP_STATES.REQUIREMENTS_UNMET;
}

let anonymousGuidedCounter = 0;

/** Reset the anonymous guided counter (called by resetInteractiveCounters). */
export function resetGuidedCounter(): void {
  anonymousGuidedCounter = 0;
}

export const InteractiveGuided = forwardRef<{ executeStep: () => Promise<boolean> }, InteractiveGuidedProps>(
  (
    {
      internalActions,
      stepId,
      isEligibleForChecking = true,
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
      completeEarly = false,
      stepTimeout,
      resetTrigger,
      stepIndex,
      totalSteps,
      sectionId,
      sectionTitle,
      fullScreenFallbackLocation,
    },
    ref
  ) => {
    const [generatedStepId] = useState(() => {
      anonymousGuidedCounter += 1;
      return `guided-step-${anonymousGuidedCounter}`;
    });
    const renderedStepId = stepId ?? generatedStepId;
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

    const mode = useInteractiveMode();
    const controllerChannel = useControllerChannel();
    const { checkRequirements: checkGuidedRequirements, guideId, contentKey } = useGuideRequirements();
    const effectiveStepTimeout = getGuidedStepTimeout(stepTimeout);
    const [isExecuting, setIsExecuting] = useState(false);
    const controllerCancelledRef = useRef(false);
    const activeRunIdRef = useRef<string>('');
    const stepElementRef = useRef<HTMLDivElement>(null);
    const [substepResults, setSubstepResults] = useState<GuidedSubstepResult[]>([]);
    const allowCompletedRetryRef = useRef(false);
    const isMountedRef = useRef(true);
    useEffect(() => {
      isMountedRef.current = true;
      return () => {
        isMountedRef.current = false;
      };
    }, []);
    // React can defer the state update while the full-screen handoff awaits navigation.
    const isExecutingRef = useRef(false);
    const [currentStepIndex, setCurrentStepIndex] = useState(0);
    const [failedStepIndex, setFailedStepIndex] = useState(-1);
    const [currentStepStatus, setCurrentStepStatus] = useState<'waiting' | 'timeout' | 'completed'>('waiting');
    const [executionError, setExecutionError] = useState<string | null>(null);
    const [wasCancelled, setWasCancelled] = useState(false);
    const beginSubstepEvidence = useCallback((runId: string) => {
      activeRunIdRef.current = runId;
      const root = stepElementRef.current;
      let results: GuidedSubstepResult[] = [];
      const publish = (settled: GuidedSubstepResult[]) => {
        if (activeRunIdRef.current !== runId) {
          return;
        }
        const byIndex = new Map(results.map((result) => [result.index, result]));
        settled.forEach((result) => byIndex.set(result.index, result));
        results = [...byIndex.values()].sort((left, right) => left.index - right.index);
        // Completion callbacks can detach the root before React commits the state.
        root?.setAttribute('data-test-substep-results', JSON.stringify(results));
        if (isMountedRef.current) {
          setSubstepResults(results);
        }
      };
      publish([]);
      return publish;
    }, []);

    const checkSubstepRequirements = useCallback<GuidedRequirementsCheck>(
      (action) =>
        checkGuidedRequirements({
          requirements: action.requirements ?? [],
          targetAction: action.targetAction,
          refTarget: action.refTarget,
          targetValue: action.targetValue,
          stepId: renderedStepId,
          lazyRender: action.lazyRender,
          scrollContainer: action.scrollContainer,
          maxRetries: 0,
        }),
      [checkGuidedRequirements, renderedStepId]
    );

    const { completed: storedCompleted } = useStepCompletion(renderedStepId, sectionId);
    const isStandalone = !onStepComplete;
    const persistCompletion = useCallback(
      (reason: ProgressReason = 'manual') => {
        if (isStandalone) {
          markStepCompleted(renderedStepId, sectionId, reason);
        }
      },
      [isStandalone, renderedStepId, sectionId]
    );
    const persistReset = useCallback(() => {
      if (isStandalone) {
        resetStep(renderedStepId, sectionId);
      }
    }, [isStandalone, renderedStepId, sectionId]);

    const pluginContext = usePluginContext();
    const interactiveConfig = useMemo(() => {
      const config = getConfigWithDefaults(pluginContext?.meta?.jsonData || {});
      return getInteractiveConfig(config);
    }, [pluginContext?.meta?.jsonData]);

    const guidedHandler = useMemo(() => {
      const stateManager = new InteractiveStateManager();
      const navigationManager = new NavigationManager();
      return new GuidedHandler(stateManager, navigationManager, waitForReactUpdates);
    }, []);

    useEffect(() => {
      return () => {
        guidedHandler.cancel();
      };
    }, [guidedHandler]);

    useEffect(() => {
      if (resetTrigger && resetTrigger > 0) {
        guidedHandler.cancel();
        beginSubstepEvidence(crypto.randomUUID());
        isExecutingRef.current = false;
        persistReset();
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reset local UI state when the parent bumps resetTrigger, alongside the persistReset store write
        setExecutionError(null);
        setIsExecuting(false);
        setCurrentStepIndex(0);
        setCurrentStepStatus('waiting');
        setWasCancelled(false);
      }
    }, [resetTrigger, persistReset, guidedHandler, beginSubstepEvidence]);

    const isCompleted = storedCompleted;

    const firstActionRefTarget = internalActions.length > 0 ? internalActions[0]!.refTarget : undefined;
    const firstActionTargetAction = internalActions.length > 0 ? internalActions[0]!.targetAction : undefined;

    useEffect(() => {
      validateInteractiveRequirements(
        {
          requirements,
          refTarget: firstActionRefTarget,
          stepId: renderedStepId,
        },
        'InteractiveGuided'
      );
    }, [requirements, renderedStepId, firstActionRefTarget]);

    const checker = useStepChecker({
      requirements,
      objectives,
      hints,
      stepId: stepId || renderedStepId,
      isEligibleForChecking:
        isEligibleForChecking && (!isCompleted || isExecuting || Boolean(executionError) || wasCancelled),
      skippable,
      refTarget: firstActionRefTarget,
      targetAction: firstActionTargetAction,
      disabled,
      sectionId,
      onStepComplete,
      onComplete,
    });

    const aiFixEnabled = useAiFixEnabled();

    const isCompletedWithObjectives = storedCompleted || checker.completionReason === 'objectives';

    const executeStep = useCallback(async (): Promise<boolean> => {
      if (
        !checker.isEnabled ||
        (isCompletedWithObjectives && !allowCompletedRetryRef.current) ||
        isExecuting ||
        isExecutingRef.current
      ) {
        return false;
      }
      isExecutingRef.current = true;
      controllerCancelledRef.current = false;
      const runId = crypto.randomUUID();
      activeRunIdRef.current = runId;

      try {
        if (checker.completionReason === 'objectives') {
          persistCompletion();
          if (onStepComplete && stepId) {
            onStepComplete(stepId);
          }
          if (onComplete) {
            onComplete();
          }
          return true;
        }

        const publishSubsteps = beginSubstepEvidence(runId);
        guidedHandler.resetProgress();
        if (internalActions.some((action) => isGrafanaDrivingHandoffNeeded(action.targetAction))) {
          await requestSidebarHandoffAndWait({ targetPath: fullScreenFallbackLocation });
        }
        if (activeRunIdRef.current !== runId || controllerCancelledRef.current) {
          return false;
        }
        // A successful full-screen handoff can unmount this instance before execution.
        if (isMountedRef.current) {
          setIsExecuting(true);
          setExecutionError(null);
          setCurrentStepIndex(0);
          setFailedStepIndex(-1);
          setCurrentStepStatus('waiting');
          setWasCancelled(false);
        }
        // Commit execution before overlay creation so idle controls and the overlay never overlap.
        await waitForReactUpdates();

        let completionPersisted = false;
        const completeStep = () => {
          if (completionPersisted) {
            return;
          }
          persistCompletion();
          if (onStepComplete && stepId) {
            onStepComplete(stepId);
          }
          if (onComplete) {
            onComplete();
          }
          completionPersisted = true;
        };

        try {
          for (let i = 0; i < internalActions.length; i++) {
            if (activeRunIdRef.current !== runId || controllerCancelledRef.current) {
              return false;
            }
            const action = internalActions[i];
            if (isMountedRef.current) {
              setCurrentStepIndex(i);
              setCurrentStepStatus('waiting');
            }

            const completeBeforeActionEffect =
              completeEarly && i === internalActions.length - 1 ? completeStep : undefined;
            const result = await guidedHandler.executeGuidedStep(
              action!,
              i,
              internalActions.length,
              effectiveStepTimeout,
              completeBeforeActionEffect,
              {
                checkRequirements: checkSubstepRequirements,
                onSettled: (settled) => publishSubsteps([settled]),
              }
            );

            if (activeRunIdRef.current !== runId || controllerCancelledRef.current) {
              return false;
            }
            if (result === 'completed' || result === 'skipped') {
              if (completeEarly && i === internalActions.length - 1) {
                completeStep();
              }
              if (isMountedRef.current) {
                setCurrentStepStatus('completed');
              }
              await new Promise((resolve) => setTimeout(resolve, 500));
            } else if (result === 'timeout') {
              if (isMountedRef.current) {
                setCurrentStepStatus('timeout');
                setFailedStepIndex(i);
                setExecutionError(`Step ${i + 1} timed out. Click "Skip" to continue or "Retry" to try again.`);
              }
              return false;
            } else if (result === 'cancelled') {
              if (isMountedRef.current) {
                setWasCancelled(true);
              }
              return false;
            } else if (result === 'error') {
              if (isMountedRef.current) {
                setFailedStepIndex(i);
                setExecutionError(`Step ${i + 1} failed. Click "Retry" to try again.`);
              }
              return false;
            }
          }
          if (activeRunIdRef.current !== runId || controllerCancelledRef.current) {
            return false;
          }
          completeStep();
          return true;
        } catch (error) {
          logger.error(`Guided execution failed: ${stepId}`, { error });
          const errorMessage = error instanceof Error ? error.message : 'Guided execution failed';
          if (activeRunIdRef.current === runId && isMountedRef.current) {
            setExecutionError(errorMessage);
          }
          return false;
        }
      } finally {
        if (activeRunIdRef.current === runId) {
          isExecutingRef.current = false;
          if (isMountedRef.current) {
            setIsExecuting(false);
            setCurrentStepIndex(0);
          }
        }
      }
    }, [
      checker.isEnabled,
      isCompletedWithObjectives,
      isExecuting,
      completeEarly,
      stepId,
      internalActions,
      guidedHandler,
      effectiveStepTimeout,
      beginSubstepEvidence,
      checkSubstepRequirements,
      onStepComplete,
      onComplete,
      persistCompletion,
      checker.completionReason,
      fullScreenFallbackLocation,
    ]);

    useImperativeHandle(ref, () => {
      return {
        executeStep,
      };
    }, [executeStep]);

    useEffect(() => {
      if (
        !interactiveConfig.autoDetection.enabled ||
        !checker.isEnabled ||
        isCompletedWithObjectives ||
        !isExecuting ||
        disabled
      ) {
        return;
      }

      const handleActionDetected = async (event: Event) => {
        const customEvent = event as CustomEvent<DetectedActionEvent>;
        const detectedAction = customEvent.detail;

        const currentAction = internalActions[currentStepIndex];
        if (!currentAction) {
          return;
        }

        if (currentAction.targetAction === 'noop') {
          return;
        }

        const selector = currentAction.refTarget;
        if (!selector) {
          return;
        }

        // Resolve synchronously so a dynamic menu cannot change across an await.
        let targetElement: HTMLElement | null = null;
        try {
          const actionType = currentAction.targetAction;

          if (actionType === 'button') {
            const buttons = findButtonByText(selector);
            if (buttons.length > 0) {
              targetElement = buttons[0] || null;
            } else {
              const result = querySelectorAllEnhanced(selector);
              const btnElements = result.elements.filter(
                (el) => el.tagName === 'BUTTON' || el.getAttribute('role') === 'button'
              );
              if (btnElements.length > 0) {
                targetElement = btnElements[0] || null;
              }
            }
          } else if (actionType === 'highlight' || actionType === 'hover') {
            const result = querySelectorAllEnhanced(selector);
            if (result.elements.length > 0) {
              targetElement = result.elements[0] || null;
            }
          } else if (actionType === 'formfill') {
            const result = querySelectorAllEnhanced(selector);
            const formElements = result.elements.filter((el) => {
              const tag = el.tagName.toLowerCase();
              return tag === 'input' || tag === 'textarea' || tag === 'select';
            });
            if (formElements.length > 0) {
              targetElement = formElements[0] || null;
            }
          }
        } catch (error) {
          logger.warn('Failed to resolve target element for coordinate matching', { error });
        }

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
          return;
        }

        const stepCompletedEvent = new CustomEvent('guided-step-completed', {
          detail: {
            stepIndex: currentStepIndex,
            stepId,
          },
        });
        document.dispatchEvent(stepCompletedEvent);

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

    const handleDoAction = useCallback(async () => {
      if (
        disabled ||
        isExecuting ||
        isExecutingRef.current ||
        (isCompletedWithObjectives && !allowCompletedRetryRef.current) ||
        !checker.isEnabled
      ) {
        return;
      }

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

      if (mode === 'controller') {
        if (!controllerChannel) {
          getAppEvents().publish({
            type: 'alert-info',
            payload: ['No live tab connected', 'Open a live Grafana tab to run this step there.'],
          });
          return;
        }
        controllerCancelledRef.current = false;
        const runId = crypto.randomUUID();
        const publishSubsteps = beginSubstepEvidence(runId);
        isExecutingRef.current = true;
        setIsExecuting(true);
        setExecutionError(null);
        setFailedStepIndex(-1);
        setCurrentStepIndex(0);
        setCurrentStepStatus('waiting');
        setWasCancelled(false);
        const stopProgress = controllerChannel.onStepProgress(renderedStepId, runId, (index, _total, settled) => {
          if (activeRunIdRef.current !== runId || controllerCancelledRef.current) {
            return;
          }
          if (settled) {
            publishSubsteps(settled);
          }
          if (!isMountedRef.current) {
            return;
          }
          setCurrentStepIndex(index);
          setCurrentStepStatus('waiting');
          const failed = settled?.find((result) => result.status !== 'completed' && result.status !== 'skipped');
          if (failed) {
            setFailedStepIndex(failed.index);
          }
        });
        const completion = controllerChannel.awaitStepComplete(renderedStepId, runId);
        controllerChannel.post({
          kind: 'step-command',
          phase: 'do',
          stepId: renderedStepId,
          runId,
          action: {
            targetAction: 'guided',
            refTarget: '',
            internalActions: internalActions.map(toCrossTabInternalAction),
            stepTimeout: effectiveStepTimeout,
            guideId: guideId ?? '',
            contentKey: contentKey ?? getContentKey(),
          },
        });
        try {
          const finished = await completion;
          if (activeRunIdRef.current !== runId || controllerCancelledRef.current) {
            return;
          }
          if (finished) {
            persistCompletion();
            if (onStepComplete && stepId) {
              onStepComplete(stepId);
            }
            if (onComplete) {
              onComplete();
            }
          } else if (isMountedRef.current) {
            setExecutionError('The live tab did not finish this guided step. Retry the step.');
            getAppEvents().publish({
              type: 'alert-warning',
              payload: ['Step not completed', 'The live tab did not finish this step — please retry.'],
            });
          }
        } finally {
          stopProgress?.();
          if (activeRunIdRef.current === runId) {
            isExecutingRef.current = false;
            if (isMountedRef.current) {
              setIsExecuting(false);
            }
          }
        }
        return;
      }

      await executeStep();
    }, [
      disabled,
      isExecuting,
      isCompletedWithObjectives,
      checker.isEnabled,
      executeStep,
      internalActions,
      renderedStepId,
      analyticsStepMeta,
      mode,
      controllerChannel,
      beginSubstepEvidence,
      effectiveStepTimeout,
      guideId,
      contentKey,
      persistCompletion,
      onStepComplete,
      onComplete,
      stepId,
    ]);

    const handleStepRedo = useCallback(() => {
      if (disabled || isExecuting) {
        return;
      }

      persistReset();
      beginSubstepEvidence(crypto.randomUUID());
      setExecutionError(null);
      setCurrentStepIndex(0);
      setCurrentStepStatus('waiting');
      setWasCancelled(false);

      if (onStepReset && stepId) {
        onStepReset(stepId);
      }
    }, [disabled, isExecuting, stepId, onStepReset, persistReset, beginSubstepEvidence]);

    const markSkipped = checker.markSkipped;
    const handleSkipStep = useCallback(async () => {
      await markSkipped?.();
      setExecutionError(null);
      setFailedStepIndex(-1);
      setWasCancelled(false);
      persistCompletion('skipped');

      if (onStepComplete && stepId) {
        onStepComplete(stepId);
      }

      if (onComplete) {
        onComplete();
      }
    }, [stepId, onStepComplete, onComplete, persistCompletion, markSkipped]);

    const handleRetry = useCallback(async () => {
      persistReset();
      setExecutionError(null);
      setCurrentStepStatus('waiting');
      setWasCancelled(false);
      allowCompletedRetryRef.current = true;
      try {
        if (mode === 'controller') {
          await handleDoAction();
        } else {
          await executeStep();
        }
      } finally {
        allowCompletedRetryRef.current = false;
      }
    }, [executeStep, handleDoAction, mode, persistReset]);

    const handleCancel = useCallback(async () => {
      controllerCancelledRef.current = true;
      controllerChannel?.cancelStepComplete(renderedStepId, activeRunIdRef.current);
      guidedHandler.cancel();
      isExecutingRef.current = false;

      setIsExecuting(false);
      setExecutionError(null);
      setCurrentStepIndex(0);
      setCurrentStepStatus('waiting');
      setWasCancelled(true);
    }, [guidedHandler, controllerChannel, renderedStepId]);

    const isAnyActionRunning = isExecuting || isCurrentlyExecuting;

    const currentAction = internalActions[currentStepIndex];
    const currentActionComment = currentAction?.targetComment || 'Complete this step';

    const uiState = deriveGuidedUiState({
      isCompleted: isCompletedWithObjectives,
      isCompletedByObjectives: checker.completionReason === 'objectives',
      isExecuting,
      hasError: Boolean(executionError),
      wasCancelled,
      isChecking: checker.isChecking,
      isEnabled: checker.isEnabled,
    });

    return (
      <div
        ref={stepElementRef}
        className={`interactive-step interactive-guided${className ? ` ${className}` : ''}${uiState === 'completed' ? ' completed' : ''} interactive-guided--${uiState}`}
        {...getTrackedStepRootAttributes('guided', stepId || renderedStepId)}
        data-step-id={stepId || renderedStepId}
        data-state={uiState}
        data-testid={testIds.interactive.step(renderedStepId)}
        data-test-step-state={uiState}
        data-test-substep-index={isExecuting ? currentStepIndex : undefined}
        data-test-substep-total={internalActions.length}
        data-test-step-timeout={effectiveStepTimeout}
        data-test-substep-skippable={currentAction?.isSkippable === true}
        data-test-substep-results={JSON.stringify(substepResults)}
        data-test-requirements-state={
          checker.isChecking ? 'checking' : checker.isEnabled ? 'met' : checker.explanation ? 'unmet' : 'unknown'
        }
      >
        <div className="interactive-step-content">
          {title && <div className="interactive-step-title">{title}</div>}
          {children}
        </div>

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
                      persistCompletion('skipped');
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

        {(uiState === STEP_STATES.REQUIREMENTS_UNMET || (uiState === 'checking' && checker.explanation)) &&
          checker.explanation && (
            <div className={`interactive-guided-requirements${checker.isChecking ? ' rechecking' : ''}`}>
              <div className="interactive-guided-requirement-box">
                <span className="interactive-guided-requirement-icon">👣</span>
                <span id={`requirement-explanation-${renderedStepId}`} className="interactive-guided-requirement-text">
                  {checker.explanation}
                </span>
                {checker.isChecking && <span className="interactive-requirement-spinner">⟳</span>}
              </div>
              <button
                className="interactive-guided-fix-btn"
                data-testid={
                  checker.canFixRequirement
                    ? testIds.interactive.requirementFixButton(renderedStepId)
                    : testIds.interactive.requirementRetryButton(renderedStepId)
                }
                title={
                  checker.canFixRequirement
                    ? 'Apply the automatic fix for this requirement'
                    : 'Check whether this requirement is now met'
                }
                aria-describedby={`requirement-explanation-${renderedStepId}`}
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
              {isEligibleForChecking && aiFixEnabled && checker.requiresDomElement && !checker.canFixRequirement && (
                <AiFixButton
                  className="interactive-guided-ai-fix-btn"
                  testId={testIds.interactive.guidedAiFixButton(renderedStepId)}
                  detail={{
                    stepId: stepId ?? renderedStepId,
                    renderedStepId,
                    refTarget: firstActionRefTarget,
                    action: firstActionTargetAction,
                  }}
                />
              )}
            </div>
          )}

        {uiState === 'executing' && (
          <div className="interactive-guided-executing">
            <div className="interactive-guided-step-indicator">
              <span className="interactive-guided-step-badge">
                Step {currentStepIndex + 1} of {internalActions.length}
              </span>
              {currentStepStatus === 'completed' && <span className="interactive-guided-step-done">✓</span>}
            </div>

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

        {uiState === 'error' && (
          <div className="interactive-guided-error" data-testid={testIds.interactive.errorMessage(renderedStepId)}>
            <div className="interactive-guided-error-box">
              <span className="interactive-guided-error-icon">✕</span>
              <div className="interactive-guided-error-content">
                <span className="interactive-guided-error-title">Step {failedStepIndex + 1} didn&apos;t complete</span>
                <span className="interactive-guided-error-detail">
                  {executionError ||
                    (currentStepStatus === 'timeout' ? 'Timed out waiting for action' : 'Something went wrong')}
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
              {aiFixEnabled && failedStepIndex >= 0 && (
                <AiFixButton
                  className="interactive-guided-ai-fix-btn"
                  testId={testIds.interactive.guidedAiFixButton(`${renderedStepId}-runtime`)}
                  detail={{
                    stepId: stepId ?? renderedStepId,
                    renderedStepId,
                    refTarget: internalActions[failedStepIndex]?.refTarget,
                    action: internalActions[failedStepIndex]?.targetAction,
                    containerInfo: {
                      containerId: stepId ?? renderedStepId,
                      containerKind: 'guided',
                      subStepIndex: failedStepIndex,
                    },
                  }}
                />
              )}
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
            <Button
              size="sm"
              variant="secondary"
              onClick={handleStepRedo}
              disabled={disabled || isAnyActionRunning}
              data-testid={testIds.interactive.redoButton(renderedStepId)}
              title="Redo this guided tour"
            >
              ↻ Redo
            </Button>
          </div>
        )}
      </div>
    );
  }
);

InteractiveGuided.displayName = 'InteractiveGuided';
