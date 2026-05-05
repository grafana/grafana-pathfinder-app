/**
 * `ConditionLintMessages` — small inline presentation of field-level lint
 * diagnostics.
 *
 * Sits beneath a requirements / objectives / verify input, renders one row
 * per diagnostic, and offers a "Replace with X" button when the diagnostic
 * carries a typo suggestion. Clicking the button asks the parent to apply
 * the fix via `onApplyFix(badToken, replacement)`.
 *
 * Visual style: warning palette via Grafana's `Alert` component at severity
 * "warning". Errors (rare for field-level lint) use severity "error".
 */

import React from 'react';
import { Button, Stack } from '@grafana/ui';
import type { Diagnostic } from './types';

export interface ConditionLintMessagesProps {
  diagnostics: Diagnostic[];
  onApplyFix?: (badToken: string, replacement: string) => void;
  /** Optional `data-testid` on the container; useful for tests. */
  testId?: string;
}

const containerStyle: React.CSSProperties = {
  marginTop: 4,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const messageStyle = (severity: Diagnostic['severity']): React.CSSProperties => ({
  fontSize: 12,
  color: severity === 'error' ? '#F2495C' : '#FF9830',
});

export function ConditionLintMessages({ diagnostics, onApplyFix, testId }: ConditionLintMessagesProps) {
  if (diagnostics.length === 0) {
    return null;
  }
  return (
    <div style={containerStyle} data-testid={testId}>
      {diagnostics.map((diag, i) => {
        const canFix = !!(diag.suggestion && diag.tokenAtFault && onApplyFix);
        return (
          <Stack key={`${diag.code}-${i}`} direction="row" gap={1} alignItems="center">
            <span style={messageStyle(diag.severity)}>{diag.message}</span>
            {canFix && (
              <Button
                size="sm"
                variant="secondary"
                fill="text"
                type="button"
                onClick={() => onApplyFix!(diag.tokenAtFault!, diag.suggestion!)}
              >
                Replace with {diag.suggestion}
              </Button>
            )}
          </Stack>
        );
      })}
    </div>
  );
}
