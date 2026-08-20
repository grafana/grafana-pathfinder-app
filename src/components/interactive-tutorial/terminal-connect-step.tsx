/**
 * TerminalConnectStep Component
 *
 * Renders a "Try in terminal" button that opens and connects to the Coda terminal.
 * Use this as a guided entry point for users to start using the terminal feature.
 *
 * With `gcx`, the step also installs a Grafana credential into the VM so the
 * `gcx` CLI baked into every sandbox image can talk to this Grafana as the
 * learner. Minting that credential happens in the browser with the user's own
 * session — the Coda backend cannot mint one, by design — and needs
 * `serviceaccounts:create`, which is an Admin permission by default while
 * sandbox sessions are open to Editors. So the pasted-token path is not a
 * fallback for edge cases: it is the path most learners take.
 */

import React, { useState, useCallback, useEffect, forwardRef, useImperativeHandle, useRef } from 'react';
import { Button, Icon, useStyles2 } from '@grafana/ui';
import { testIds } from '../../constants/testIds';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';

import { useTerminalContext } from '../../integrations/coda/TerminalContext';
import { GcxReadyLine, GcxSetupPanel } from '../../integrations/coda/GcxSetupPanel';
import { useGcxCredential } from '../../integrations/coda/useGcxCredential.hook';
import {
  codaUnavailableMessage,
  useCodaSessionEligibility,
  useReportSandboxUnavailable,
  useCodaTerminalGate,
} from '../../integrations/coda/useCodaAvailability.hook';
import { STEP_STATES, type StepStateValue } from './step-states';
import { markStepCompleted, useStepCompletion } from '../../global-state/completion-store';

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
  /** Also install a Grafana credential so `gcx` can be used in the VM */
  gcx?: boolean;

  stepId?: string;
  isEligibleForChecking?: boolean;
  isCurrentlyExecuting?: boolean;
  onStepComplete?: (stepId: string) => void;
  resetTrigger?: number;
  onStepReset?: () => void;

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
      gcx = false,
      stepId,
      isEligibleForChecking = true,
      isCurrentlyExecuting = false,
      onStepComplete,
      resetTrigger,
      onStepReset,
      stepIndex,
      totalSteps,
      sectionId,
      sectionTitle,
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

    const markComplete = useCallback(() => {
      if (isCompleted) {
        return;
      }
      if (isStandalone) {
        markStepCompleted(renderedStepId, sectionId, 'manual');
      }
      if (onStepComplete && renderedStepId) {
        onStepComplete(renderedStepId);
      }
      onComplete?.();
    }, [isCompleted, onStepComplete, onComplete, renderedStepId, sectionId, isStandalone]);

    // `markComplete` is the step's own semantics, injected rather than baked
    // into the shared flow — the toolbar button has nothing to complete.
    const gcxCredential = useGcxCredential(markComplete);

    const handleConnect = useCallback(async () => {
      if (!terminalCtx) {
        return;
      }

      setIsConnecting(true);
      const vmOpts = vmTemplate ? { template: vmTemplate, app: vmApp, scenario: vmScenario } : undefined;
      const sessionId = await terminalCtx.openTerminal(vmOpts);

      if (!gcx) {
        return;
      }
      if (!sessionId) {
        // Nothing to install into, and nothing to say here: the terminal owns
        // the connection error, and the step falls back to offering Connect
        // again. A gcx error set now would render nowhere, because the panel
        // below is only reachable once the terminal is connected.
        return;
      }
      // The id `openTerminal` resolved, not the rendered one: when the requested
      // VM differs from the live one this tears the old session down, and the
      // render still carries the session being deleted.
      await gcxCredential.run(sessionId);
    }, [terminalCtx, vmTemplate, vmApp, vmScenario, gcx, gcxCredential]);

    /** Provision against the live session, for a terminal connected elsewhere. */
    const handleGcxOnly = useCallback(
      (token?: string) => gcxCredential.run(terminalCtx?.sessionId ?? null, token),
      [terminalCtx?.sessionId, gcxCredential]
    );

    // React to terminal status changes while waiting for connection.
    // Handles: success (connected), failure (error), and cancellation (disconnected).
    useEffect(() => {
      if (!isConnecting) {
        return;
      }

      if (terminalCtx?.status === 'connected') {
        setIsConnecting(false);
        // With gcx the step is not done until the credential is in: the hook
        // completes it. Completing here would tick the step off while the
        // commands it exists to enable would still fail unauthenticated.
        if (!gcx) {
          markComplete();
        }
      } else if (terminalCtx?.status === 'error' || terminalCtx?.status === 'disconnected') {
        setIsConnecting(false);
      }
    }, [isConnecting, terminalCtx?.status, markComplete, gcx]);

    const isGcxPending = gcx && gcxCredential.isPending;

    useImperativeHandle(
      ref,
      () => ({
        executeStep: async () => {
          if (isCompleted) {
            return true;
          }
          if (terminalCtx?.status === 'connected' && !isGcxPending) {
            markComplete();
            return true;
          }
          void handleConnect();
          // Reporting success here would forge a completion: the credential
          // needs a click, and may need a pasted token.
          return false;
        },
        markSkipped: () => {
          markComplete();
        },
      }),
      [isCompleted, terminalCtx, markComplete, handleConnect, isGcxPending]
    );

    const isTerminalConnected = terminalCtx?.status === 'connected';
    const isTerminalConnecting = isConnecting || terminalCtx?.status === 'connecting';
    const isEnabled = !disabled && terminalCtx !== null;
    // The provider mounts even when the panel that owns `connect` is gated
    // away, so without this the button is enabled and does nothing.
    const sandboxUnavailable = codaUnavailableMessage(
      codaGate,
      codaEligibility,
      !!terminalCtx?.isTerminalRegistered,
      SANDBOX_SUBJECT
    );

    let stepState: StepStateValue = STEP_STATES.IDLE;
    if (isCompleted) {
      stepState = STEP_STATES.COMPLETED;
    } else if (isTerminalConnecting || isCurrentlyExecuting || gcxCredential.state === 'provisioning') {
      stepState = STEP_STATES.EXECUTING;
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

    const gcxPanel = (
      <GcxSetupPanel
        state={gcxCredential.state}
        error={gcxCredential.error}
        canMint={gcxCredential.canMint}
        onMint={() => void handleGcxOnly()}
        onInstall={(token) => void handleGcxOnly(token)}
        onSkip={markComplete}
        testIds={{
          mint: testIds.interactive.gcxMintButton(renderedStepId),
          tokenInput: testIds.interactive.gcxTokenInput(renderedStepId),
          install: testIds.interactive.gcxInstallButton(renderedStepId),
          error: testIds.interactive.gcxError(renderedStepId),
          skip: testIds.interactive.gcxSkipButton(renderedStepId),
        }}
      />
    );

    return (
      <div
        className={containerClasses}
        data-test-step-state={stepState}
        data-testid={testIds.interactive.terminalConnectStep(renderedStepId)}
      >
        {children && <div className={styles.content}>{children}</div>}

        {gcxCredential.credential && (
          <GcxReadyLine credential={gcxCredential.credential} testId={testIds.interactive.gcxReady(renderedStepId)} />
        )}

        {isEnabled && !isCompleted && !isTerminalConnected && sandboxUnavailable && (
          <div className={styles.unavailable}>{sandboxUnavailable}</div>
        )}

        {isEnabled && !isCompleted && !(sandboxUnavailable && !isTerminalConnected) && (
          <>
            {isTerminalConnected ? (
              <>
                <div className={styles.actions}>
                  <span className={`${styles.statusText} ${styles.connectedText}`}>
                    <Icon name="check" size="sm" /> Connected
                  </span>
                  {!isGcxPending && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={markComplete}
                      data-testid={testIds.interactive.terminalSkipButton(renderedStepId)}
                    >
                      Continue
                    </Button>
                  )}
                </div>
                {isGcxPending && gcxPanel}
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
                >
                  {isTerminalConnecting ? 'Connecting...' : buttonText}
                </Button>
              </div>
            )}
          </>
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
