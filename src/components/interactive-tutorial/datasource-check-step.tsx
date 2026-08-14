/**
 * The datasource picker when its author asked a failing check to block. The
 * advisory form of the same check stays passive inside `InputBlock`; only this
 * one is a tracked step, so only this one can hold a section up.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { Alert, Button, Combobox, Field, Icon, useStyles2, type ComboboxOption } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';

import { testIds } from '../../constants/testIds';
import { useGuideResponsesOptional } from '../../docs-retrieval';
import { markStepCompleted, resetStep, useStepCompletion } from '../../global-state/completion-store';
import type { ProgressReason } from '../../global-state/progress-events';
import { buildInteractiveStepProperties, reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { useStepChecker, validateInteractiveRequirements } from '../../requirements-manager';
import { DataCheckControls } from './data-check-controls';
import { filterDatasourcesByType, toDatasourceOptions } from './datasource-options';
import { STEP_STATES, type StepStateValue } from './step-states';
import { useDataCheck } from './use-data-check';

export interface DatasourceCheckStepProps {
  variableName: string;
  query: string;
  datasourceFilter?: string;
  placeholder?: string;
  failureMessage?: string;
  timeFrom?: string;
  timeTo?: string;
  requirements?: string;
  skippable?: boolean;
  hints?: string;
  children?: React.ReactNode;
  onComplete?: () => void;
  disabled?: boolean;
  className?: string;

  // Unified state management props (passed by parent section)
  stepId?: string;
  isEligibleForChecking?: boolean;
  onStepComplete?: (stepId: string) => void;
  onStepReset?: (stepId: string) => void;
  resetTrigger?: number;

  // Step position tracking
  stepIndex?: number;
  totalSteps?: number;
  sectionId?: string;
  sectionTitle?: string;
}

let datasourceCheckStepCounter = 0;

export function resetDatasourceCheckStepCounter(): void {
  datasourceCheckStepCounter = 0;
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
  picker: css({
    marginBottom: theme.spacing(1),
    maxWidth: '320px',
  }),
  completedBadge: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    color: theme.colors.success.text,
    fontSize: theme.typography.bodySmall.fontSize,
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

export function DatasourceCheckStep({
  variableName,
  query,
  datasourceFilter,
  placeholder,
  failureMessage,
  timeFrom,
  timeTo,
  requirements,
  skippable = false,
  hints,
  children,
  onComplete,
  disabled = false,
  className,
  stepId,
  isEligibleForChecking = true,
  onStepComplete,
  onStepReset,
  resetTrigger,
  stepIndex,
  totalSteps,
  sectionId,
  sectionTitle,
}: DatasourceCheckStepProps) {
  const styles = useStyles2(getStyles);
  const responseContext = useGuideResponsesOptional();

  const [generatedStepId] = useState(() => {
    datasourceCheckStepCounter += 1;
    return `datasource-check-step-${datasourceCheckStepCounter}`;
  });
  const renderedStepId = stepId ?? generatedStepId;

  const datasources = useMemo(() => filterDatasourcesByType(datasourceFilter), [datasourceFilter]);
  const datasourceOptions = useMemo(() => toDatasourceOptions(datasources), [datasources]);

  // The pick lives in the guide response and arrives asynchronously, so reading
  // it once into state would strand the picker empty on every reload. Local
  // state is only for the case with nowhere to persist to.
  const [uncontrolledName, setUncontrolledName] = useState<string | null>(null);
  const storedName = responseContext ? responseContext.getResponse(variableName) : uncontrolledName;
  const rememberedName = typeof storedName === 'string' && storedName ? storedName : null;

  // A remembered name can belong to a data source that has since been deleted,
  // or one the author's filter no longer offers. Trusting it would run a check
  // against a data source the picker never offered.
  const selectedDatasource = rememberedName ? (datasources.find((ds) => ds.name === rememberedName) ?? null) : null;

  const { state, failureDetail, supportedType, canRun, run, reset } = useDataCheck({
    datasource: selectedDatasource,
    query,
    timeFrom,
    timeTo,
  });

  const { completed: isCompleted, reason: completionReason } = useStepCompletion(renderedStepId, sectionId);
  const isStandalone = !onStepComplete;

  useMemo(() => {
    validateInteractiveRequirements({ requirements, stepId: renderedStepId }, 'DatasourceCheckStep');
  }, [requirements, renderedStepId]);

  const checker = useStepChecker({
    requirements: requirements || '',
    targetAction: 'noop',
    refTarget: '',
    stepId: renderedStepId,
    isEligibleForChecking,
    skippable,
    sectionId, // Lets the checker write skip / objectives transitions to the store
  });

  const markComplete = useCallback(
    (reason: ProgressReason = 'manual') => {
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

  const persistReset = useCallback(() => {
    if (isStandalone) {
      resetStep(renderedStepId, sectionId);
    }
  }, [isStandalone, renderedStepId, sectionId]);

  const checkerResetStep = checker.resetStep;

  const retract = useCallback(() => {
    reset();
    persistReset();
    if (onStepReset && renderedStepId) {
      onStepReset(renderedStepId);
    }
    checkerResetStep?.();
  }, [reset, persistReset, onStepReset, renderedStepId, checkerResetStep]);

  // A completion belongs to the data source it was earned against, and the pick
  // can be rewritten by anything that owns the same variable — a sibling
  // advisory picker, a `{{var}}` write, a guide clear. Watching the resolved
  // name rather than this component's own handler is what makes those paths
  // retract too. A name arriving where there was none is hydration, not a
  // change, so it must not wipe a durable pass on reload.
  const verdictOwner = useRef<string | null>(rememberedName);
  useEffect(() => {
    const previous = verdictOwner.current;
    if (previous === rememberedName) {
      return;
    }
    verdictOwner.current = rememberedName;
    if (previous !== null) {
      retract();
    }
  }, [rememberedName, retract]);

  useEffect(() => {
    if (resetTrigger && resetTrigger > 0) {
      // The pick is deliberately kept — only the verdict is cleared.
      reset();
      persistReset();
      // Section already wrote the store via `resetSteps(tailStepIds)`; suppress
      // the per-child store write so the broadcast doesn't fan out and wipe
      // preceding completions (parity with interactive-step).
      if (checkerResetStep) {
        checkerResetStep({ skipStoreWrite: true });
      }
    }
  }, [resetTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRedo = useCallback(() => {
    if (disabled || state === 'checking') {
      return;
    }
    retract();
  }, [disabled, state, retract]);

  // Writing the pick is all this does; the retraction rides on the name change.
  const handleDatasourceChange = useCallback(
    (option: ComboboxOption<string> | null) => {
      const name = option?.value ?? null;
      if (!responseContext) {
        setUncontrolledName(name);
        return;
      }
      if (name) {
        responseContext.setResponse(variableName, name);
      } else {
        responseContext.deleteResponse(variableName);
      }
    },
    [responseContext, variableName]
  );

  const stepContext = useMemo(
    () => ({ stepId: renderedStepId, stepIndex, totalSteps, sectionId, sectionTitle }),
    [renderedStepId, stepIndex, totalSteps, sectionId, sectionTitle]
  );

  const handleRun = useCallback(async () => {
    reportAppInteraction(
      UserInteraction.DataCheckRun,
      buildInteractiveStepProperties(
        { datasource_type: supportedType ?? 'unknown', blocking: true, interaction_location: 'data_check_step' },
        stepContext
      )
    );
    const { outcome, durationMs } = await run();
    // A check the user gave up on, or one a newer run replaced, has no outcome
    // to report and must not complete the step it no longer speaks for.
    if (outcome === 'aborted') {
      return;
    }
    reportAppInteraction(
      outcome === 'passed' ? UserInteraction.DataCheckPassed : UserInteraction.DataCheckFailed,
      buildInteractiveStepProperties(
        {
          datasource_type: supportedType ?? 'unknown',
          blocking: true,
          outcome,
          duration_ms: durationMs,
          interaction_location: 'data_check_step',
        },
        stepContext
      )
    );
    if (outcome === 'passed') {
      markComplete();
    }
  }, [run, markComplete, supportedType, stepContext]);

  const markSkipped = checker.markSkipped;
  const handleSkip = useCallback(async () => {
    // Giving up has to stop the query too: it would otherwise keep spending
    // after the user moved on, and leave Redo inert until it finished.
    reset();
    reportAppInteraction(
      UserInteraction.DataCheckSkipped,
      buildInteractiveStepProperties(
        { datasource_type: supportedType ?? 'unknown', interaction_location: 'data_check_step' },
        stepContext
      )
    );
    await markSkipped?.();
    markComplete('skipped');
  }, [reset, markSkipped, markComplete, supportedType, stepContext]);

  const isEnabled = checker.isEnabled && !disabled;
  const hasDatasources = datasourceOptions.length > 0;
  const isUnsupportedType = Boolean(selectedDatasource) && !supportedType;

  let stepState: StepStateValue = STEP_STATES.IDLE;
  if (isCompleted) {
    stepState = STEP_STATES.COMPLETED;
  } else if (state === 'checking') {
    stepState = STEP_STATES.EXECUTING;
  } else if (checker.isChecking) {
    stepState = STEP_STATES.CHECKING;
  } else if (!isEnabled) {
    stepState = STEP_STATES.REQUIREMENTS_UNMET;
  } else if (state === 'no-data' || state === 'error') {
    stepState = STEP_STATES.ERROR;
  }

  // Skip drives the checker to a terminal state, so the disabled blanket would
  // land on the very step now rendering Redo and leave it unclickable.
  const containerClasses = [
    'interactive-step',
    isCompleted && 'completed',
    !isEnabled && !isCompleted && styles.disabled,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const skipButton = skippable ? (
    <Button
      size="sm"
      variant="secondary"
      fill="text"
      onClick={handleSkip}
      data-testid={testIds.dataCheck.skipButton(renderedStepId)}
    >
      Skip
    </Button>
  ) : null;

  return (
    <div
      className={containerClasses}
      data-test-step-state={stepState}
      data-testid={testIds.dataCheck.step(renderedStepId)}
    >
      {children && <div className={styles.content}>{children}</div>}

      {!isEnabled && !isCompleted && (checker.explanation || hints) && (
        <div className={styles.requirementMessage}>
          {checker.explanation}
          {hints && <div>{hints}</div>}
          {skipButton}
        </div>
      )}

      {isEnabled && !isCompleted && !hasDatasources && (
        <Alert title="No data sources available" severity="warning">
          No data sources{datasourceFilter ? ` of type "${datasourceFilter}"` : ''} are configured in this Grafana
          instance.
          {skipButton}
        </Alert>
      )}

      {isEnabled && !isCompleted && hasDatasources && (
        <>
          <div className={styles.picker}>
            <Field label="Data source">
              <Combobox
                options={datasourceOptions}
                value={selectedDatasource?.name ?? null}
                onChange={handleDatasourceChange}
                placeholder={placeholder || 'Select a data source...'}
                isClearable
                data-testid={testIds.dataCheck.datasourcePicker(renderedStepId)}
              />
            </Field>
          </div>

          <DataCheckControls
            state={state}
            failureDetail={failureDetail}
            failureMessage={failureMessage}
            canRun={canRun}
            isUnsupportedType={isUnsupportedType}
            disabled={disabled}
            onRun={handleRun}
            runTestId={testIds.dataCheck.runQueryButton(renderedStepId)}
            failureTestId={testIds.dataCheck.failure(renderedStepId)}
          >
            {skipButton}
          </DataCheckControls>
        </>
      )}

      {isCompleted && (
        <div className={styles.completedBadge}>
          <Icon name={completionReason === 'skipped' ? 'forward' : 'check-circle'} size="sm" />
          <span>{completionReason === 'skipped' ? 'Skipped' : 'Data available'}</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleRedo}
            disabled={disabled}
            data-testid={testIds.interactive.redoButton(renderedStepId)}
            title="Run the check again"
          >
            ↻ Redo
          </Button>
        </div>
      )}
    </div>
  );
}

DatasourceCheckStep.displayName = 'DatasourceCheckStep';
