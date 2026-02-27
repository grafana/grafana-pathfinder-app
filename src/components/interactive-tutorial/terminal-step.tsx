/**
 * TerminalStep Component
 *
 * Renders a terminal command block with "Copy" and "Exec" buttons.
 * Participates in section step counting and sequential execution
 * the same way InteractiveStep does.
 */

import React, { useState, useCallback, forwardRef, useImperativeHandle, useRef, useMemo } from 'react';
import { Button, Icon, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';

import { useStepChecker, validateInteractiveRequirements } from '../../requirements-manager';
import { useTerminalContext } from '../../integrations/coda/TerminalContext';
import { STEP_STATES, type StepStateValue } from './step-states';
import { useStandalonePersistence } from './use-standalone-persistence';

export interface TerminalStepProps {
  command: string;
  requirements?: string;
  objectives?: string;
  skippable?: boolean;
  hints?: string;
  children?: React.ReactNode;
  onComplete?: () => void;
  disabled?: boolean;
  className?: string;

  // Unified state management props (passed by parent section)
  stepId?: string;
  isEligibleForChecking?: boolean;
  isCompleted?: boolean;
  isCurrentlyExecuting?: boolean;
  onStepComplete?: (stepId: string) => void;
  resetTrigger?: number;
  onStepReset?: () => void;

  // Step position tracking
  stepIndex?: number;
  totalSteps?: number;
  sectionId?: string;
  sectionTitle?: string;
}

let terminalStepCounter = 0;

export function resetTerminalStepCounter(): void {
  terminalStepCounter = 0;
}

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    padding: theme.spacing(1.5),
    borderLeft: `3px solid ${theme.colors.info.border}`,
    marginBottom: theme.spacing(1),
    borderRadius: theme.shape.radius.default,
    backgroundColor: theme.colors.background.secondary,
  }),
  completed: css({
    borderLeftColor: theme.colors.success.border,
    opacity: 0.8,
  }),
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
  commandBlock: css({
    fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
    fontSize: theme.typography.bodySmall.fontSize,
    backgroundColor: theme.colors.background.canvas,
    color: theme.colors.text.primary,
    padding: theme.spacing(1),
    borderRadius: theme.shape.radius.default,
    marginBottom: theme.spacing(1),
    overflowX: 'auto' as const,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-all' as const,
    border: `1px solid ${theme.colors.border.weak}`,
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
  stepHeader: css({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing(0.5),
  }),
  stepLabel: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    fontWeight: theme.typography.fontWeightMedium,
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
  copyFeedback: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.success.text,
  }),
});

export const TerminalStep = forwardRef<
  { executeStep: () => Promise<boolean>; markSkipped?: () => void },
  TerminalStepProps
>(
  (
    {
      command,
      requirements,
      objectives,
      skippable = false,
      hints,
      children,
      onComplete,
      disabled = false,
      className,
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
      terminalStepCounter += 1;
      generatedStepIdRef.current = `terminal-step-${terminalStepCounter}`;
    }
    const renderedStepId = stepId ?? generatedStepIdRef.current;

    const [isLocallyCompleted, setIsLocallyCompleted] = useState(false);
    const [copyFeedback, setCopyFeedback] = useState(false);
    const [isExecRunning, setIsExecRunning] = useState(false);

    useStandalonePersistence(renderedStepId, isLocallyCompleted, setIsLocallyCompleted, onStepComplete, totalSteps);

    const isCompleted = parentCompleted || isLocallyCompleted;

    // Validate requirements configuration
    useMemo(() => {
      validateInteractiveRequirements({ requirements, stepId: renderedStepId }, 'TerminalStep');
    }, [requirements, renderedStepId]);

    const checker = useStepChecker({
      requirements: requirements || '',
      objectives: objectives || '',
      targetAction: 'noop',
      refTarget: '',
      stepId: renderedStepId,
      isEligibleForChecking,
      skippable,
    });

    const markComplete = useCallback(() => {
      if (!isCompleted) {
        setIsLocallyCompleted(true);
        if (onStepComplete && renderedStepId) {
          onStepComplete(renderedStepId);
        }
        onComplete?.();
      }
    }, [isCompleted, onStepComplete, onComplete, renderedStepId]);

    const handleCopy = useCallback(async () => {
      try {
        await navigator.clipboard.writeText(command);
        setCopyFeedback(true);
        markComplete();
        setTimeout(() => setCopyFeedback(false), 2000);
      } catch (err) {
        console.error('[TerminalStep] Copy failed:', err);
      }
    }, [command, markComplete]);

    const handleExec = useCallback(async () => {
      if (!terminalCtx || terminalCtx.status !== 'connected') {
        terminalCtx?.openTerminal();
        return;
      }
      setIsExecRunning(true);
      try {
        await terminalCtx.sendCommand(command);
        markComplete();
      } catch (err) {
        console.error('[TerminalStep] Exec failed:', err);
      } finally {
        setIsExecRunning(false);
      }
    }, [command, terminalCtx, markComplete]);

    const handleConnect = useCallback(() => {
      terminalCtx?.openTerminal();
    }, [terminalCtx]);

    // Imperative API for section "Do Section" automation
    useImperativeHandle(
      ref,
      () => ({
        executeStep: async () => {
          if (isCompleted) {
            return true;
          }
          if (terminalCtx?.status === 'connected') {
            await terminalCtx.sendCommand(command);
            markComplete();
            return true;
          }
          return false;
        },
        markSkipped: () => {
          markComplete();
        },
      }),
      [isCompleted, command, terminalCtx, markComplete]
    );

    const isEnabled = checker.isEnabled && !disabled;
    const isTerminalConnected = terminalCtx?.status === 'connected';

    // Determine visual state
    let stepState: StepStateValue = STEP_STATES.IDLE;
    if (isCompleted) {
      stepState = STEP_STATES.COMPLETED;
    } else if (isExecRunning || isCurrentlyExecuting) {
      stepState = STEP_STATES.EXECUTING;
    } else if (checker.isChecking) {
      stepState = STEP_STATES.CHECKING;
    } else if (!isEnabled) {
      stepState = STEP_STATES.REQUIREMENTS_UNMET;
    }

    const containerClasses = [
      styles.container,
      isCompleted && styles.completed,
      !isEnabled && styles.disabled,
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div
        className={containerClasses}
        data-test-step-state={stepState}
        data-testid={`terminal-step-${renderedStepId}`}
      >
        {/* Step header */}
        {stepIndex !== undefined && totalSteps !== undefined && (
          <div className={styles.stepHeader}>
            <span className={styles.stepLabel}>
              Step {stepIndex + 1} of {totalSteps}
            </span>
          </div>
        )}

        {/* Description content */}
        {children && <div className={styles.content}>{children}</div>}

        {/* Command display */}
        <div className={styles.commandBlock}>
          <code>{command}</code>
        </div>

        {/* Requirement unmet message */}
        {!isEnabled && !isCompleted && checker.explanation && (
          <div className={styles.requirementMessage}>
            {checker.explanation}
            {skippable && (
              <Button size="sm" variant="secondary" fill="text" onClick={markComplete}>
                Skip
              </Button>
            )}
          </div>
        )}

        {/* Actions */}
        {isEnabled && !isCompleted && (
          <div className={styles.actions}>
            <Button size="sm" variant="secondary" icon="copy" onClick={handleCopy} tooltip="Copy command to clipboard">
              Copy
            </Button>

            {isTerminalConnected ? (
              <Button
                size="sm"
                variant="primary"
                icon="play"
                onClick={handleExec}
                disabled={isExecRunning}
                tooltip="Execute command in terminal"
              >
                {isExecRunning ? 'Running...' : 'Exec'}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                icon="link"
                onClick={handleConnect}
                tooltip="Connect to terminal to execute commands"
              >
                Connect terminal
              </Button>
            )}

            {copyFeedback && <span className={styles.copyFeedback}>Copied!</span>}
          </div>
        )}

        {/* Completed badge */}
        {isCompleted && (
          <div className={styles.completedBadge}>
            <Icon name="check-circle" size="sm" />
            <span>Done</span>
          </div>
        )}
      </div>
    );
  }
);

TerminalStep.displayName = 'TerminalStep';
