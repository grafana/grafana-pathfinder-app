/**
 * `LintBadge` — small per-block diagnostic count badge.
 *
 * Reads from `useGuideLintResult()` and renders a coloured badge whenever
 * the block has any diagnostics attributed to it. Hovering the badge shows
 * the diagnostic messages so the author can decide whether to open the
 * block to fix.
 *
 * Identification is by JSON path (e.g. `['blocks', 2]` for the third
 * top-level block; `['blocks', 1, 'blocks', 0]` for the first child of the
 * second top-level section). This lets the badge work for blocks regardless
 * of whether they declare a stable JSON `id`. Renders nothing if (a) lint
 * hasn't run yet, (b) this block path has no diagnostics.
 */

import React, { useMemo } from 'react';
import { Badge } from '@grafana/ui';
import { useGuideLintResult } from './BlockEditorContext';
import type { Diagnostic } from './lint';

export interface LintBadgeProps {
  /**
   * JSON path to the block in the guide, e.g. `['blocks', 0]`. Required so
   * the badge can pull only diagnostics that fall under this block (and any
   * children, for sections / conditionals).
   */
  path: Array<string | number>;
}

function summariseDiagnostics(diagnostics: Diagnostic[]): string {
  if (diagnostics.length === 0) {
    return '';
  }
  const head = diagnostics.slice(0, 5).map((d) => `• ${d.message}`);
  const overflow = diagnostics.length > 5 ? `\n…and ${diagnostics.length - 5} more` : '';
  return head.join('\n') + overflow;
}

export function LintBadge({ path }: LintBadgeProps) {
  const lint = useGuideLintResult();
  const diagnostics = useMemo<Diagnostic[]>(() => {
    if (!lint) {
      return [];
    }
    return lint.forPath(path);
  }, [lint, path]);

  if (diagnostics.length === 0) {
    return null;
  }

  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  const hasError = errorCount > 0;
  const text = hasError
    ? `${errorCount} error${errorCount === 1 ? '' : 's'}`
    : `${diagnostics.length} warning${diagnostics.length === 1 ? '' : 's'}`;
  const color = hasError ? 'red' : 'orange';
  const tooltip = summariseDiagnostics(diagnostics);

  return <Badge text={text} color={color} icon="exclamation-triangle" tooltip={tooltip} />;
}
