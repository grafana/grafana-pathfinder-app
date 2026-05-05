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
  /**
   * Called when the user clicks "Use X" on a diagnostic that carries a
   * near-match suggestion. The form replaces `badToken` with `replacement`
   * inside the condition field.
   */
  onApplyFix?: (badToken: string, replacement: string) => void;
  /**
   * Called when the user clicks "Remove" on a diagnostic for a token that
   * is completely unknown (no near-match suggestion was available). The
   * form drops `badToken` from the condition field.
   */
  onRemoveToken?: (badToken: string) => void;
  /** Optional `data-testid` on the container; useful for tests. */
  testId?: string;
}

export function ConditionLintMessages({ diagnostics, onApplyFix, onRemoveToken, testId }: ConditionLintMessagesProps) {
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
        const canReplace = !!(diag.suggestion && diag.tokenAtFault && onApplyFix);
        // Offer "Remove" only when the token is unknown enough that we
        // don't have a suggestion to replace it with — otherwise the
        // primary action is "Use <suggestion>" and a remove button would
        // just clutter the row.
        const canRemove = !canReplace && !!(diag.tokenAtFault && onRemoveToken);
        return (
          <div key={`${diag.code}-${i}`} className={`${styles.row} ${rowClass}`}>
            <Icon name={isError ? 'times-circle' : 'exclamation-triangle'} size="sm" className={iconClass} />
            <span className={styles.message}>{diag.message}</span>
            {canReplace && (
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
            {canRemove && (
              <Button
                size="sm"
                variant="secondary"
                fill="outline"
                type="button"
                icon="trash-alt"
                onClick={() => onRemoveToken!(diag.tokenAtFault!)}
              >
                Remove
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
    gap: theme.spacing(0.25),
    // Pull the warnings up close to the input — Grafana's `Field` adds a
    // generous bottom margin, which makes the gap look disconnected.
    marginTop: theme.spacing(-1),
    marginBottom: theme.spacing(0.5),
  }),
  row: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0.5, 1),
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
