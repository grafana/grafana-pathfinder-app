/**
 * CodeBlockStep Component
 *
 * Renders a code block with "Show me" and "Insert" buttons for Monaco editors.
 * Show me highlights the target Monaco editor; Insert clears the editor and inserts the code.
 * Participates in section step counting and sequential execution the same way InteractiveStep does.
 */

import React, { useState, useCallback, forwardRef, useImperativeHandle, useRef, useMemo } from 'react';
import { Button, Icon, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';

import { useStepChecker, validateInteractiveRequirements } from '../../requirements-manager';
import { clearAndInsertCode, useInteractiveElements } from '../../interactive-engine';
import { STEP_STATES, type StepStateValue } from './step-states';
import { useStandalonePersistence } from './use-standalone-persistence';
import { CodeBlock } from '../../docs-retrieval';
import { testIds } from '../../constants/testIds';

export interface CodeBlockStepProps {
  code: string;
  language?: string;
  refTarget: string;
  requirements?: string;
  objectives?: string;
  skippable?: boolean;
  hints?: string;
  children?: React.ReactNode;
  onComplete?: () => void;
  disabled?: boolean;
  className?: string;

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

let codeBlockStepCounter = 0;

export function resetCodeBlockStepCounter(): void {
  codeBlockStepCounter = 0;
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
  codeBlockWrapper: css({
    marginBottom: theme.spacing(1),
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
  feedback: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.success.text,
  }),
  errorMessage: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.error.text,
    marginTop: theme.spacing(0.5),
  }),
});

export const CodeBlockStep = forwardRef<
  { executeStep: () => Promise<boolean>; markSkipped?: () => void },
  CodeBlockStepProps
>(
  (
    {
      code,
      language = 'javascript',
      refTarget,
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

    const generatedStepIdRef = useRef<string | undefined>(undefined);
    if (!generatedStepIdRef.current) {
      codeBlockStepCounter += 1;
      generatedStepIdRef.current = `code-block-step-${codeBlockStepCounter}`;
    }
    const renderedStepId = stepId ?? generatedStepIdRef.current;

    const [isLocallyCompleted, setIsLocallyCompleted] = useState(false);
    const [isShowRunning, setIsShowRunning] = useState(false);
    const [isInsertRunning, setIsInsertRunning] = useState(false);
    const [insertError, setInsertError] = useState<string | null>(null);

    // Get executeInteractiveAction for "Show me" highlighting
    const { executeInteractiveAction } = useInteractiveElements();

    useStandalonePersistence(renderedStepId, isLocallyCompleted, setIsLocallyCompleted, onStepComplete, totalSteps);

    const isCompleted = parentCompleted || isLocallyCompleted;

    useMemo(() => {
      validateInteractiveRequirements({ requirements, stepId: renderedStepId }, 'CodeBlockStep');
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

    const handleShowMe = useCallback(async () => {
      if (isShowRunning) {
        return;
      }
      setIsShowRunning(true);
      try {
        // Highlight the target Monaco editor using the interactive engine
        await executeInteractiveAction('highlight', refTarget, undefined, 'show');
      } catch (err) {
        console.error('[CodeBlockStep] Show me failed:', err);
      } finally {
        setIsShowRunning(false);
      }
    }, [refTarget, isShowRunning, executeInteractiveAction]);

    const handleInsert = useCallback(async () => {
      setIsInsertRunning(true);
      setInsertError(null);
      try {
        const result = await clearAndInsertCode(refTarget, code);
        if (result.success) {
          markComplete();
        } else {
          setInsertError(result.error || 'Failed to insert code');
        }
      } catch (err) {
        console.error('[CodeBlockStep] Insert failed:', err);
        setInsertError(err instanceof Error ? err.message : 'Insert failed');
      } finally {
        setIsInsertRunning(false);
      }
    }, [code, refTarget, markComplete]);

    useImperativeHandle(
      ref,
      () => ({
        executeStep: async () => {
          if (isCompleted) {
            return true;
          }
          const result = await clearAndInsertCode(refTarget, code);
          if (result.success) {
            markComplete();
            return true;
          }
          return false;
        },
        markSkipped: () => {
          markComplete();
        },
      }),
      [isCompleted, code, refTarget, markComplete]
    );

    const isEnabled = checker.isEnabled && !disabled;

    let stepState: StepStateValue = STEP_STATES.IDLE;
    if (isCompleted) {
      stepState = STEP_STATES.COMPLETED;
    } else if (isInsertRunning || isShowRunning || isCurrentlyExecuting) {
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
        data-testid={testIds.codeBlock.step(renderedStepId)}
      >
        {stepIndex !== undefined && totalSteps !== undefined && (
          <div className={styles.stepHeader}>
            <span className={styles.stepLabel}>
              Step {stepIndex + 1} of {totalSteps}
            </span>
          </div>
        )}

        {children && <div className={styles.content}>{children}</div>}

        <div className={styles.codeBlockWrapper}>
          <CodeBlock code={code} language={language} showCopy={false} />
        </div>

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

        {isEnabled && !isCompleted && (
          <div className={styles.actions}>
            <Button
              size="sm"
              variant="secondary"
              icon="eye"
              onClick={handleShowMe}
              disabled={isShowRunning}
              tooltip="Highlight the target code editor"
              data-testid={testIds.codeBlock.showMeButton(renderedStepId)}
            >
              {isShowRunning ? 'Showing...' : 'Show me'}
            </Button>

            <Button
              size="sm"
              variant="primary"
              icon="arrow-right"
              onClick={handleInsert}
              disabled={isInsertRunning}
              tooltip="Clear editor and insert code"
              data-testid={testIds.codeBlock.insertButton(renderedStepId)}
            >
              {isInsertRunning ? 'Inserting...' : 'Insert'}
            </Button>
          </div>
        )}

        {insertError && !isCompleted && <div className={styles.errorMessage}>{insertError}</div>}

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

CodeBlockStep.displayName = 'CodeBlockStep';
