/**
 * DataCheckStep Component
 *
 * Verifies the user's data source actually holds the data the guide teaches
 * against. The user picks a data source, then runs the check; the step
 * completes only when the check passes.
 *
 * The check runs on click and never on a cadence — that is the whole reason
 * this is a step rather than a `requirements` token, which the requirements
 * pipeline would re-evaluate on several timers.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { css } from '@emotion/css';
import { Alert, Button, Combobox, Field, Icon, useStyles2, type ComboboxOption } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { getDataSourceSrv } from '@grafana/runtime';

import { getNormalizedDatasourceType, type SupportedDatasourceType } from '../../constants/datasource-types';
import { testIds } from '../../constants/testIds';
import { useGuideResponsesOptional } from '../../docs-retrieval';
import { markStepCompleted, useStepCompletion } from '../../global-state/completion-store';
import {
  DATA_CHECK_RESULT_EVENT,
  dispatchDataCheckRequest,
  type DataCheckResultDetail,
} from '../../integrations/assistant-integration/data-check-event';
// Deep import (not the barrel): the barrel re-exports @grafana/assistant, which crashes under jsdom.
import { useIsAssistantAvailable } from '../../integrations/assistant-integration/assistant-dev-mode';
import { runDataCheckQuery } from '../../lib/datasource/run-data-check-query';
import { logger } from '../../lib/logging';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { useStepChecker, validateInteractiveRequirements } from '../../requirements-manager';
import { STEP_STATES, type StepStateValue } from './step-states';

export type DataCheckMode = 'query' | 'ai' | 'either';

export interface DataCheckStepProps {
  datasourceType: SupportedDatasourceType;
  mode: DataCheckMode;
  title?: string;
  query?: string;
  aiPrompt?: string;
  timeFrom?: string;
  timeTo?: string;
  failureMessage?: string;
  variableName?: string;
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
  onStepComplete?: (stepId: string) => void;
  resetTrigger?: number;

  // Step position tracking
  stepIndex?: number;
  totalSteps?: number;
  sectionId?: string;
  sectionTitle?: string;
}

type CheckState = 'idle' | 'checking' | 'failed';

let dataCheckStepCounter = 0;

export function resetDataCheckStepCounter(): void {
  dataCheckStepCounter = 0;
}

const getStyles = (theme: GrafanaTheme2) => ({
  disabled: css({
    opacity: 0.5,
    pointerEvents: 'none' as const,
  }),
  title: css({
    fontSize: theme.typography.h6.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    marginBottom: theme.spacing(1),
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
  actions: css({
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'center',
  }),
  status: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(1),
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  completedBadge: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    color: theme.colors.success.text,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  failure: css({
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
    marginBottom: theme.spacing(1),
    backgroundColor: theme.colors.warning.transparent,
    border: `1px solid ${theme.colors.warning.border}`,
    borderRadius: theme.shape.radius.default,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.primary,
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

/** Options for the picker, narrowed to the type the author asked for. */
function getDatasourceOptions(datasourceType: SupportedDatasourceType): Array<ComboboxOption<string>> {
  try {
    return getDataSourceSrv()
      .getList()
      .filter((ds) => getNormalizedDatasourceType(ds.type) === datasourceType)
      .map((ds) => ({ label: ds.name, value: ds.uid, description: ds.type }));
  } catch (error) {
    logger.warn('[DataCheckStep] Failed to get datasources', { error });
    return [];
  }
}

export const DataCheckStep = forwardRef<
  { executeStep: () => Promise<boolean>; markSkipped?: () => void },
  DataCheckStepProps
>(
  (
    {
      datasourceType,
      mode,
      title,
      query,
      aiPrompt,
      timeFrom,
      timeTo,
      failureMessage,
      variableName,
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
      onStepComplete,
      resetTrigger,
      sectionId,
    },
    ref
  ) => {
    const styles = useStyles2(getStyles);
    const responseContext = useGuideResponsesOptional();
    const isAssistantAvailable = useIsAssistantAvailable();

    const generatedStepIdRef = useRef<string | undefined>(undefined);
    if (!generatedStepIdRef.current) {
      dataCheckStepCounter += 1;
      generatedStepIdRef.current = `data-check-step-${dataCheckStepCounter}`;
    }
    const renderedStepId = stepId ?? generatedStepIdRef.current;

    // Reserved when the author didn't name a variable, so the pick is still
    // remembered per guide without colliding with authored variables.
    const responseKey = variableName ?? `__dataCheckDatasource_${renderedStepId}`;

    const datasourceOptions = useMemo(() => getDatasourceOptions(datasourceType), [datasourceType]);

    const [datasourceUid, setDatasourceUid] = useState<string | null>(() => {
      const existing = responseContext?.getResponse(responseKey);
      return typeof existing === 'string' && existing ? existing : null;
    });
    const [checkState, setCheckState] = useState<CheckState>('idle');
    const [failureDetail, setFailureDetail] = useState('');

    const { completed: storedCompleted } = useStepCompletion(renderedStepId, sectionId);
    const isStandalone = !onStepComplete;
    const isCompleted = storedCompleted;

    const abortRef = useRef<AbortController | null>(null);
    const pendingAiRequestRef = useRef<string | null>(null);

    useMemo(() => {
      validateInteractiveRequirements({ requirements, stepId: renderedStepId }, 'DataCheckStep');
    }, [requirements, renderedStepId]);

    const checker = useStepChecker({
      requirements: requirements || '',
      objectives: objectives || '',
      targetAction: 'noop',
      refTarget: '',
      stepId: renderedStepId,
      isEligibleForChecking,
      skippable,
      sectionId,
    });

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

    const cancelInFlight = useCallback(() => {
      abortRef.current?.abort();
      abortRef.current = null;
      pendingAiRequestRef.current = null;
    }, []);

    // Section reset clears the verdict but deliberately keeps the data source
    // pick — re-picking after every reset would be hostile.
    useEffect(() => {
      if (resetTrigger === undefined) {
        return;
      }
      cancelInFlight();
      setCheckState('idle');
      setFailureDetail('');
    }, [resetTrigger, cancelInFlight]);

    useEffect(() => () => cancelInFlight(), [cancelInFlight]);

    const handleDatasourceChange = useCallback(
      (option: ComboboxOption<string> | null) => {
        const uid = option?.value ?? null;
        // A pass belongs to the data source it was run against; switching away
        // must not leave a green check standing.
        cancelInFlight();
        setDatasourceUid(uid);
        setCheckState('idle');
        setFailureDetail('');
        if (responseContext) {
          if (uid) {
            responseContext.setResponse(responseKey, uid);
          } else {
            responseContext.deleteResponse(responseKey);
          }
        }
      },
      [responseContext, responseKey, cancelInFlight]
    );

    const reportOutcome = useCallback(
      (checkMode: 'query' | 'ai', passed: boolean) => {
        reportAppInteraction(passed ? UserInteraction.DataCheckPassed : UserInteraction.DataCheckFailed, {
          check_mode: checkMode,
          datasource_type: datasourceType,
          step_id: renderedStepId,
        });
      },
      [datasourceType, renderedStepId]
    );

    const handleRunQuery = useCallback(async () => {
      if (!datasourceUid || !query) {
        return;
      }
      cancelInFlight();
      const controller = new AbortController();
      abortRef.current = controller;
      setCheckState('checking');
      setFailureDetail('');
      reportAppInteraction(UserInteraction.DataCheckRun, {
        check_mode: 'query',
        datasource_type: datasourceType,
        step_id: renderedStepId,
      });

      const result = await runDataCheckQuery({
        datasourceUid,
        datasourceType,
        query,
        from: timeFrom,
        to: timeTo,
        signal: controller.signal,
      });

      if (controller.signal.aborted) {
        return;
      }
      abortRef.current = null;

      if (result.ok && result.hasData) {
        setCheckState('idle');
        reportOutcome('query', true);
        markComplete();
        return;
      }
      setFailureDetail(result.ok ? '' : result.error);
      setCheckState('failed');
      reportOutcome('query', false);
    }, [
      datasourceUid,
      query,
      datasourceType,
      timeFrom,
      timeTo,
      renderedStepId,
      markComplete,
      cancelInFlight,
      reportOutcome,
    ]);

    const handleAskAi = useCallback(() => {
      if (!datasourceUid || !aiPrompt) {
        return;
      }
      cancelInFlight();
      const requestId = `${renderedStepId}-${dataCheckStepCounter}-${performance.now()}`;
      pendingAiRequestRef.current = requestId;
      setCheckState('checking');
      setFailureDetail('');
      reportAppInteraction(UserInteraction.DataCheckRun, {
        check_mode: 'ai',
        datasource_type: datasourceType,
        step_id: renderedStepId,
      });
      dispatchDataCheckRequest({
        requestId,
        datasourceUid,
        datasourceType,
        aiPrompt,
        timeFrom,
        timeTo,
      });
    }, [datasourceUid, aiPrompt, datasourceType, timeFrom, timeTo, renderedStepId, cancelInFlight]);

    useEffect(() => {
      const handler = (e: Event) => {
        const detail = (e as CustomEvent<DataCheckResultDetail>).detail;
        if (!detail || detail.requestId !== pendingAiRequestRef.current) {
          return;
        }
        pendingAiRequestRef.current = null;
        if (detail.passed) {
          setCheckState('idle');
          reportOutcome('ai', true);
          markComplete();
          return;
        }
        setFailureDetail(detail.reason);
        setCheckState('failed');
        reportOutcome('ai', false);
      };
      window.addEventListener(DATA_CHECK_RESULT_EVENT, handler);
      return () => window.removeEventListener(DATA_CHECK_RESULT_EVENT, handler);
    }, [markComplete, reportOutcome]);

    const handleSkip = useCallback(() => {
      reportAppInteraction(UserInteraction.DataCheckSkipped, {
        datasource_type: datasourceType,
        step_id: renderedStepId,
      });
      markComplete();
    }, [markComplete, datasourceType, renderedStepId]);

    // "Do Section" can't answer the data question for the user, so a data check
    // only auto-advances when it has already passed.
    useImperativeHandle(
      ref,
      () => ({
        executeStep: async () => isCompleted,
        markSkipped: () => markComplete(),
      }),
      [isCompleted, markComplete]
    );

    const isEnabled = checker.isEnabled && !disabled;
    const isChecking = checkState === 'checking';
    const hasDatasources = datasourceOptions.length > 0;
    const showQueryButton = mode !== 'ai' && Boolean(query);
    const showAiButton = mode !== 'query' && Boolean(aiPrompt) && isAssistantAvailable;

    let stepState: StepStateValue = STEP_STATES.IDLE;
    if (isCompleted) {
      stepState = STEP_STATES.COMPLETED;
    } else if (isChecking) {
      stepState = STEP_STATES.EXECUTING;
    } else if (checker.isChecking) {
      stepState = STEP_STATES.CHECKING;
    } else if (!isEnabled) {
      stepState = STEP_STATES.REQUIREMENTS_UNMET;
    } else if (checkState === 'failed') {
      stepState = STEP_STATES.ERROR;
    }

    const containerClasses = ['interactive-step', isCompleted && 'completed', !isEnabled && styles.disabled, className]
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
        {title && <div className={styles.title}>{title}</div>}
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
            No {datasourceType} data sources are configured in this Grafana instance.
            {skipButton}
          </Alert>
        )}

        {isEnabled && !isCompleted && hasDatasources && (
          <>
            <div className={styles.picker}>
              <Field label="Data source">
                <Combobox
                  options={datasourceOptions}
                  value={datasourceUid}
                  onChange={handleDatasourceChange}
                  placeholder={`Select a ${datasourceType} data source...`}
                  data-testid={testIds.dataCheck.datasourcePicker(renderedStepId)}
                />
              </Field>
            </div>

            {checkState === 'failed' && (
              <div
                className={styles.failure}
                role="status"
                aria-live="polite"
                data-testid={testIds.dataCheck.failure(renderedStepId)}
              >
                <Icon name="exclamation-triangle" />
                <div>{failureMessage || failureDetail || 'The data is currently not available.'}</div>
              </div>
            )}

            {isChecking && (
              <div className={styles.status}>
                <Icon name="fa fa-spinner" />
                <span>Checking your data…</span>
              </div>
            )}

            <div className={styles.actions}>
              {showQueryButton && (
                <Button
                  size="sm"
                  variant="primary"
                  icon="search"
                  onClick={handleRunQuery}
                  disabled={!datasourceUid || isChecking}
                  data-testid={testIds.dataCheck.runQueryButton(renderedStepId)}
                >
                  {checkState === 'failed' ? 'Run query again' : 'Run query'}
                </Button>
              )}
              {showAiButton && (
                <Button
                  size="sm"
                  variant={showQueryButton ? 'secondary' : 'primary'}
                  icon="ai"
                  onClick={handleAskAi}
                  disabled={!datasourceUid || isChecking}
                  data-testid={testIds.dataCheck.askAiButton(renderedStepId)}
                >
                  {checkState === 'failed' ? 'Ask AI again' : 'Ask AI'}
                </Button>
              )}
              {skipButton}
            </div>
          </>
        )}

        {isCompleted && (
          <div className={styles.completedBadge}>
            <Icon name="check-circle" size="sm" />
            <span>Data available</span>
          </div>
        )}
      </div>
    );
  }
);

DataCheckStep.displayName = 'DataCheckStep';
