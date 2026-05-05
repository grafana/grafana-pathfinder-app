/**
 * `ConditionLintMessages` — small inline presentation of field-level lint
 * diagnostics.
 *
 * Sits beneath a requirements / objectives / verify input, renders one row
 * per diagnostic with a warning/error icon, and offers a "Replace with X"
 * button when the diagnostic carries a typo suggestion. Clicking the
 * button asks the parent to apply the fix via `onApplyFix(badToken, replacement)`.
 *
 * Visual language follows Grafana's warning palette so it reads as a soft
 * inline hint rather than a blocking error banner.
 */

import React from 'react';
import { Button, Icon, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import type { Diagnostic } from './types';

export interface ConditionLintMessagesProps {
  diagnostics: Diagnostic[];
  onApplyFix?: (badToken: string, replacement: string) => void;
  /** Optional `data-testid` on the container; useful for tests. */
  testId?: string;
}

export function ConditionLintMessages({ diagnostics, onApplyFix, testId }: ConditionLintMessagesProps) {
  const styles = useStyles2(getStyles);
  if (diagnostics.length === 0) {
    return null;
  }
  return (
    <div className={styles.container} data-testid={testId}>
      {diagnostics.map((diag, i) => {
        const isError = diag.severity === 'error';
        const rowClass = isError ? styles.rowError : styles.rowWarning;
        const iconClass = isError ? styles.iconError : styles.iconWarning;
        const canFix = !!(diag.suggestion && diag.tokenAtFault && onApplyFix);
        return (
          <div key={`${diag.code}-${i}`} className={`${styles.row} ${rowClass}`}>
            <Icon name={isError ? 'times-circle' : 'exclamation-triangle'} size="sm" className={iconClass} />
            <span className={styles.message}>{diag.message}</span>
            {canFix && (
              <Button
                size="sm"
                variant="secondary"
                fill="solid"
                type="button"
                icon="sync"
                onClick={() => onApplyFix!(diag.tokenAtFault!, diag.suggestion!)}
              >
                Use {diag.suggestion}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    marginTop: theme.spacing(0.5),
  }),
  row: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0.75, 1),
    borderRadius: theme.shape.radius.default,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: theme.typography.bodySmall.lineHeight,
  }),
  rowWarning: css({
    backgroundColor: theme.colors.warning.transparent,
    borderLeft: `3px solid ${theme.colors.warning.border}`,
    color: theme.colors.text.primary,
  }),
  rowError: css({
    backgroundColor: theme.colors.error.transparent,
    borderLeft: `3px solid ${theme.colors.error.border}`,
    color: theme.colors.text.primary,
  }),
  iconWarning: css({
    color: theme.colors.warning.text,
    flexShrink: 0,
  }),
  iconError: css({
    color: theme.colors.error.text,
    flexShrink: 0,
  }),
  message: css({
    flex: 1,
    minWidth: 0,
    wordBreak: 'break-word',
  }),
});
