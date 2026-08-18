import React from 'react';
import { css } from '@emotion/css';
import { Alert, Button, Icon, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';

import type { DataCheckState } from './use-data-check';

export interface DataCheckControlsProps {
  state: DataCheckState;
  failureDetail: string;
  failureMessage?: string;
  /** False while nothing is picked, or the pick has no query model a check can build. */
  canRun: boolean;
  /** True once something is picked but its type has no query model. */
  isUnsupportedType: boolean;
  disabled?: boolean;
  onRun: () => void;
  runTestId: string;
  failureTestId: string;
  children?: React.ReactNode;
}

const getStyles = (theme: GrafanaTheme2) => ({
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
});

/** The run button, spinner, and failure notice, shared by the advisory picker and the gating step. */
export function DataCheckControls({
  state,
  failureDetail,
  failureMessage,
  canRun,
  isUnsupportedType,
  disabled = false,
  onRun,
  runTestId,
  failureTestId,
  children,
}: DataCheckControlsProps) {
  const styles = useStyles2(getStyles);
  const isChecking = state === 'checking';
  const hasFailed = state === 'no-data' || state === 'error';

  // The author's message describes absent data, so it must not stand in for a
  // check that never ran — a user told the metric is missing may skip a blocking
  // step when the real problem is their connection or permissions.
  const failureText =
    state === 'error'
      ? `The check could not run. ${failureDetail}`.trim()
      : failureMessage || 'The data is currently not available.';

  return (
    <>
      {hasFailed && (
        <div className={styles.failure} role="status" aria-live="polite" data-testid={failureTestId}>
          <Icon name="exclamation-triangle" />
          <div>{failureText}</div>
        </div>
      )}

      {isChecking && (
        <div className={styles.status}>
          <Icon name="fa fa-spinner" />
          <span>Checking your data…</span>
        </div>
      )}

      {isUnsupportedType && (
        <Alert title="This check can't run here" severity="warning">
          A data check can only query Prometheus, Loki, Tempo, and Pyroscope data sources.
        </Alert>
      )}

      <div className={styles.actions}>
        {!isUnsupportedType && (
          <Button
            size="sm"
            variant="primary"
            icon="search"
            onClick={onRun}
            disabled={!canRun || isChecking || disabled}
            data-testid={runTestId}
          >
            {hasFailed ? 'Run check again' : 'Run check'}
          </Button>
        )}
        {children}
      </div>
    </>
  );
}
