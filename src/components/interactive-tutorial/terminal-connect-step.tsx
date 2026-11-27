/**
 * TerminalConnectStep Component
 *
 * Renders a "Try in terminal" button that opens and connects to the Coda terminal.
 * Use this as a guided entry point for users to start using the terminal feature.
 */

import React, { useState, useCallback, useEffect, forwardRef, useImperativeHandle, useRef } from 'react';
import { Button, Icon, useStyles2 } from '@grafana/ui';
import { testIds } from '../../constants/testIds';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';

import { useStepChecker } from '../../requirements-manager';
import { useTerminalContext } from '../../integrations/coda/TerminalContext';
import {
  codaUnavailableMessage,
  useCodaSessionEligibility,
  useReportSandboxUnavailable,
  useCodaTerminalGate,
} from '../../integrations/coda/useCodaAvailability.hook';
import { STEP_STATES, type StepStateValue } from './step-states';
import type { ProgressReason } from '../../global-state/progress-events';
import { markStepCompleted, resetStep, useStepCompletion } from '../../global-state/completion-store';
import { getTrackedStepRootAttributes } from './tracked-step-root-attributes';

export interface TerminalConnectStepProps {
  buttonText?: string;
  children?: React.ReactNode;
  onComplete?: () => void;
  disabled?: boolean;
  className?: string;
  /** VM template override (defaults to "vm-aws") */
  vmTemplate?: string;
  /** App name for sample-app template */
  vmApp?: string;
  /** Scenario name for alloy-scenario template */
  vmScenario?: string;

  stepId?: string;
  isEligibleForChecking?: boolean;
  isCurrentlyExecuting?: boolean;
  onStepComplete?: (stepId: string) => void;
  resetTrigger?: number;

  stepIndex?: number;
  totalSteps?: number;
  sectionId?: string;
  sectionTitle?: string;
}

let terminalConnectStepCounter = 0;

export function resetTerminalConnectStepCounter(): void {
  terminalConnectStepCounter = 0;
}

const getStyles = (theme: GrafanaTheme2) => ({
  disabled: css({
    opacity: 0.5,
    pointerEvents: 'none' as const,
  }),
  content: css({
    marginBottom: theme.spacing(1),
    '& p:last-child': {
      marginBottom: 0,
    },
  }),
  actions: css({
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'center',
  }),
  completedBadge: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    color: theme.colors.success.text,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  statusText: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  connectedText: css({
    color: theme.colors.success.text,
  }),
  unavailable: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  requirementMessage: css({
    padding: theme.spacing(1),
    marginBottom: theme.spacing(1),
    backgroundColor: theme.colors.warning.transparent,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.warning.border}`,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
});

const SANDBOX_SUBJECT = 'This step connects to a Coda sandbox VM';

export const TerminalConnectStep = forwardRef<
  { executeStep: () => Promise<boolean>; markSkipped?: () => void },
  TerminalConnectStepProps
>(
  (
    {
      buttonText = 'Try in terminal',
      children,
      onComplete,
      disabled = false,
      className,
      vmTemplate,
      vmApp,
      vmScenario,
      stepId,
      isEligibleForChecking = true,
      isCurrentlyExecuting = false,
      onStepComplete,
      resetTrigger,
      sectionId,
    },
    ref
  ) => {
    const styles = useStyles2(getStyles);
    const terminalCtx = useTerminalContext();
    const codaGate = useCodaTerminalGate();
    const codaEligibility = useCodaSessionEligibility(codaGate !== 'disabled');
    useReportSandboxUnavailable(codaGate, codaEligibility, !!terminalCtx?.isTerminalRegistered, 'terminal-connect');

    const generatedStepIdRef = useRef<string | undefined>(undefined);
    if (!generatedStepIdRef.current) {
      terminalConnectStepCounter += 1;
      generatedStepIdRef.current = `terminal-connect-step-${terminalConnectStepCounter}`;
    }
    const renderedStepId = stepId ?? generatedStepIdRef.current;

    const [isConnecting, setIsConnecting] = useState(false);

    const { completed: storedCompleted } = useStepCompletion(renderedStepId, sectionId);
    const isStandalone = !onStepComplete;
    const isCompleted = storedCompleted;

    const checker = useStepChecker({
      requirements: '',
      objectives: '',
      targetAction: 'noop',
      refTarget: '',
      stepId: renderedStepId,
      isEligibleForChecking,
      sectionId,
    });

    const completeStep = useCallback(
      (reason: ProgressReason) => {
        if (isCompleted) {
          return;
        }
        if (isStandalone) {
          markStepCompleted(renderedStepId, sectionId, reason);
        }
        if (onStepComplete && renderedStepId) {
          onStepComplete(renderedStepId);
        }
        onComplete?.();
      },
      [isCompleted, onStepComplete, onComplete, renderedStepId, sectionId, isStandalone]
    );
    const markComplete = useCallback(() => completeStep('manual'), [completeStep]);

    const handleConnect = useCallback(async () => {
      if (!terminalCtx) {
        return;
      }

      setIsConnecting(true);
      const vmOpts = vmTemplate ? { template: vmTemplate, app: vmApp, scenario: vmScenario } : undefined;
      await terminalCtx.openTerminal(vmOpts);
    }, [terminalCtx, vmTemplate, vmApp, vmScenario]);

    const persistReset = useCallback(() => {
      if (isStandalone) {
        resetStep(renderedStepId, sectionId);
      }
    }, [isStandalone, renderedStepId, sectionId]);

    // The section owns store resets so preceding completions survive a later step's redo.
    useEffect(() => {
      if (resetTrigger && resetTrigger > 0) {
        persistReset();
        setIsConnecting(false);
        if (checker.resetStep) {
          checker.resetStep({ skipStoreWrite: true });
        }
      }
    }, [resetTrigger, renderedStepId, sectionId]); // eslint-disable-line react-hooks/exhaustive-deps -- checker.resetStep and persistReset are stable but including checker rebuilds every render

    useEffect(() => {
      if (!isConnecting) {
        return;
      }

      if (terminalCtx?.status === 'connected') {
        setIsConnecting(false);
        markComplete();
      } else if (terminalCtx?.status === 'error' || terminalCtx?.status === 'disconnected') {
        setIsConnecting(false);
      }
    }, [isConnecting, terminalCtx?.status, markComplete]);

    useImperativeHandle(
      ref,
      () => ({
        executeStep: async () => {
          if (isCompleted) {
            return true;
          }
          if (terminalCtx?.status === 'connected') {
            markComplete();
            return true;
          }
          void handleConnect();
          return false;
        },
        markSkipped: () => {
          markComplete();
        },
      }),
      [isCompleted, terminalCtx, markComplete, handleConnect]
    );

    const isTerminalConnected = terminalCtx?.status === 'connected';
    const isTerminalConnecting = isConnecting || terminalCtx?.status === 'connecting';
    // Before the checker's first verdict, eligibility is the only gate.
    const gateOpen = checker.status === 'idle' ? isEligibleForChecking : checker.isEnabled;
    const isEnabled = gateOpen && !disabled && terminalCtx !== null;
    // A mounted provider may have no terminal panel registered to handle Connect.
    const sandboxUnavailable = codaUnavailableMessage(
      codaGate,
      codaEligibility,
      !!terminalCtx?.isTerminalRegistered,
      SANDBOX_SUBJECT
    );

    const connectionError =
      isEligibleForChecking && isEnabled && !checker.isChecking && terminalCtx?.status === 'error'
        ? terminalCtx.error || 'Terminal connection failed.'
        : null;

    let stepState: StepStateValue = STEP_STATES.IDLE;
    if (isCompleted) {
      stepState = STEP_STATES.COMPLETED;
    } else if (isTerminalConnecting || isCurrentlyExecuting) {
      stepState = STEP_STATES.EXECUTING;
    } else if (connectionError) {
      stepState = STEP_STATES.ERROR;
    } else if (checker.isChecking) {
      stepState = STEP_STATES.CHECKING;
    } else if (!isEnabled) {
      stepState = STEP_STATES.REQUIREMENTS_UNMET;
    }

    const containerClasses = [
      'interactive-step',
      isCompleted && 'completed',
      (isTerminalConnecting || isCurrentlyExecuting) && 'executing',
      !isEnabled && styles.disabled,
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div
        className={containerClasses}
        {...getTrackedStepRootAttributes('terminal-connect', renderedStepId)}
        data-test-step-state={stepState}
        data-test-terminal-status={terminalCtx?.status ?? 'disconnected'}
        data-test-terminal-vm-requested={!!(vmTemplate || vmApp || vmScenario)}
        data-test-terminal-unavailable={!!sandboxUnavailable && !isTerminalConnected}
        data-test-terminal-checking={codaGate === 'checking'}
        data-testid={testIds.interactive.terminalConnectStep(renderedStepId)}
      >
        {children && <div className={styles.content}>{children}</div>}

        {!isEnabled && !isCompleted && checker.explanation && (
          <div className={styles.requirementMessage} data-testid={testIds.interactive.requirementCheck(renderedStepId)}>
            {checker.explanation}
          </div>
        )}

        {isEnabled && !isCompleted && !isTerminalConnected && sandboxUnavailable && (
          <div className={styles.unavailable} data-testid={testIds.interactive.requirementCheck(renderedStepId)}>
            {sandboxUnavailable}
          </div>
        )}

        {isEnabled && !isCompleted && !(sandboxUnavailable && !isTerminalConnected) && (
          <>
            {isTerminalConnected ? (
              <>
                <div className={styles.actions}>
                  <span className={`${styles.statusText} ${styles.connectedText}`}>
                    <Icon name="check" size="sm" /> Connected
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={markComplete}
                    data-testid={testIds.interactive.terminalSkipButton(renderedStepId)}
                  >
                    Continue
                  </Button>
                </div>
              </>
            ) : (
              <div className={styles.actions}>
                <Button
                  size="sm"
                  variant="primary"
                  icon={isTerminalConnecting ? 'fa fa-spinner' : 'link'}
                  onClick={() => void handleConnect()}
                  disabled={isTerminalConnecting}
                  tooltip="Open terminal panel and connect"
                  data-testid={testIds.interactive.terminalConnectButton(renderedStepId)}
                >
                  {isTerminalConnecting ? 'Connecting...' : buttonText}
                </Button>
              </div>
            )}
          </>
        )}

        {connectionError && !isCompleted && (
          <div data-testid={testIds.interactive.errorMessage(renderedStepId)}>{connectionError}</div>
        )}

        {isCompleted && (
          <div className={styles.completedBadge}>
            <Icon name="check-circle" size="sm" />
            <span>Connected</span>
          </div>
        )}
      </div>
    );
  }
);

TerminalConnectStep.displayName = 'TerminalConnectStep';
