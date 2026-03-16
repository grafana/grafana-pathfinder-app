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

import { useTerminalContext } from '../../integrations/coda/TerminalContext';
import { STEP_STATES, type StepStateValue } from './step-states';
import { useStandalonePersistence } from './use-standalone-persistence';

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

  stepId?: string;
  isEligibleForChecking?: boolean;
  isCompleted?: boolean;
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
});

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
      stepId,
      isEligibleForChecking = true,
      isCompleted: parentCompleted = false,
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

    const generatedStepIdRef = useRef<string | undefined>(undefined);
    if (!generatedStepIdRef.current) {
      // eslint-disable-next-line react-hooks/globals -- counter pattern used across all step components
      terminalConnectStepCounter += 1;
      generatedStepIdRef.current = `terminal-connect-step-${terminalConnectStepCounter}`;
    }
    const renderedStepId = stepId ?? generatedStepIdRef.current;

    const [isLocallyCompleted, setIsLocallyCompleted] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);

    useStandalonePersistence(renderedStepId, isLocallyCompleted, setIsLocallyCompleted, onStepComplete, totalSteps);

    const isCompleted = parentCompleted || isLocallyCompleted;

    const markComplete = useCallback(() => {
      if (!isCompleted) {
        setIsLocallyCompleted(true);
        if (onStepComplete && renderedStepId) {
          onStepComplete(renderedStepId);
        }
        onComplete?.();
      }
    }, [isCompleted, onStepComplete, onComplete, renderedStepId]);

    const handleConnect = useCallback(() => {
      if (!terminalCtx) {
        return;
      }

      setIsConnecting(true);
      const vmOpts = vmTemplate ? { template: vmTemplate, app: vmApp } : undefined;
      terminalCtx.openTerminal(vmOpts);
    }, [terminalCtx, vmTemplate, vmApp]);

    // React to terminal status changes while waiting for connection
    useEffect(() => {
      if (!isConnecting) {
        return;
      }

      if (terminalCtx?.status === 'connected') {
        setIsConnecting(false);
        markComplete();
      } else if (terminalCtx?.status === 'error') {
        setIsConnecting(false);
      }
    }, [isConnecting, terminalCtx?.status, markComplete]);

    // Safety timeout: give up waiting after 10 seconds
    useEffect(() => {
      if (!isConnecting) {
        return;
      }

      const timeout = setTimeout(() => {
        setIsConnecting(false);
      }, 10_000);

      return () => clearTimeout(timeout);
    }, [isConnecting]);

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
          handleConnect();
          return false;
        },
        markSkipped: () => {
          markComplete();
        },
      }),
      [isCompleted, terminalCtx, markComplete, handleConnect]
    );

    const isTerminalConnected = terminalCtx?.status === 'connected';
    const isEnabled = !disabled && terminalCtx !== null;

    let stepState: StepStateValue = STEP_STATES.IDLE;
    if (isCompleted) {
      stepState = STEP_STATES.COMPLETED;
    } else if (isConnecting || isCurrentlyExecuting) {
      stepState = STEP_STATES.EXECUTING;
    } else if (!isEnabled) {
      stepState = STEP_STATES.REQUIREMENTS_UNMET;
    }

    const containerClasses = [
      'interactive-step',
      isCompleted && 'completed',
      (isConnecting || isCurrentlyExecuting) && 'executing',
      !isEnabled && styles.disabled,
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div
        className={containerClasses}
        data-test-step-state={stepState}
        data-testid={testIds.interactive.terminalConnectStep(renderedStepId)}
      >
        {children && <div className={styles.content}>{children}</div>}

        {isEnabled && !isCompleted && (
          <div className={styles.actions}>
            {isTerminalConnected ? (
              <>
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
              </>
            ) : (
              <Button
                size="sm"
                variant="primary"
                icon={isConnecting ? 'fa fa-spinner' : 'link'}
                onClick={handleConnect}
                disabled={isConnecting}
                tooltip="Open terminal panel and connect"
              >
                {isConnecting ? 'Connecting...' : buttonText}
              </Button>
            )}
          </div>
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
