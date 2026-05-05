/**
 * `LintBadge` — compact per-block diagnostic indicator.
 *
 * Reads from `useGuideLintResult()` and renders a small icon + count next
 * to other block-header badges whenever the block has diagnostics
 * attributed to it. Hovering shows the full list with one message per
 * line. Designed to be visually quiet so it doesn't compete with the
 * action icons or push them off the row.
 *
 * Identification is by JSON path (e.g. `['blocks', 2]` for the third
 * top-level block; `['blocks', 1, 'blocks', 0]` for the first child of
 * the second top-level section). This lets the indicator work for blocks
 * regardless of whether they declare a stable JSON `id`.
 */

import React, { useMemo } from 'react';
import { Icon, Tooltip, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { useGuideLintResult } from './BlockEditorContext';
import type { Diagnostic } from './lint';

export interface LintBadgeProps {
  /**
   * JSON path to the block in the guide, e.g. `['blocks', 0]`. Required so
   * the badge can pull only diagnostics that fall under this block.
   */
  path: Array<string | number>;
}

const MAX_TOOLTIP_LINES = 5;

function DiagnosticTooltipContent({ diagnostics }: { diagnostics: Diagnostic[] }) {
  const styles = useStyles2(getTooltipStyles);
  const head = diagnostics.slice(0, MAX_TOOLTIP_LINES);
  const overflow = diagnostics.length - head.length;
  return (
    <div className={styles.list}>
      {head.map((diag, i) => (
        <div key={`${diag.code}-${i}`} className={styles.line}>
          {diag.message}
        </div>
      ))}
      {overflow > 0 && <div className={styles.overflow}>…and {overflow} more</div>}
    </div>
  );
}

export function LintBadge({ path }: LintBadgeProps) {
  const styles = useStyles2(getStyles);
  const lint = useGuideLintResult();
  const diagnostics = useMemo<Diagnostic[]>(() => {
    if (!lint) {
      return [];
    }
    // `forPathDirect` excludes diagnostics that belong to a nested child
    // (section/conditional children have their own LintBadge). This keeps
    // the parent badge from double-reporting issues already attributed to
    // the offending step.
    return lint.forPathDirect(path);
  }, [lint, path]);

  if (diagnostics.length === 0) {
    return null;
  }

  const hasError = diagnostics.some((d) => d.severity === 'error');
  const indicatorClass = hasError ? styles.error : styles.warning;
  const ariaLabel = hasError
    ? `${diagnostics.length} validation issue${diagnostics.length === 1 ? '' : 's'} on this block (some are errors)`
    : `${diagnostics.length} warning${diagnostics.length === 1 ? '' : 's'} on this block`;

  return (
    <Tooltip content={<DiagnosticTooltipContent diagnostics={diagnostics} />} placement="top">
      <span className={`${styles.indicator} ${indicatorClass}`} role="status" aria-label={ariaLabel}>
        <Icon name={hasError ? 'exclamation-circle' : 'exclamation-triangle'} size="sm" />
        <span className={styles.count}>{diagnostics.length}</span>
      </span>
    </Tooltip>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  indicator: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.25),
    padding: theme.spacing(0, 0.5),
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    borderRadius: theme.shape.radius.default,
    cursor: 'help',
    flexShrink: 0,
  }),
  warning: css({
    color: theme.colors.warning.text,
  }),
  error: css({
    color: theme.colors.error.text,
  }),
  count: css({
    lineHeight: 1,
  }),
});

const getTooltipStyles = (theme: GrafanaTheme2) => ({
  list: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    maxWidth: 360,
  }),
  line: css({
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: theme.typography.bodySmall.lineHeight,
    wordBreak: 'break-word',
  }),
  overflow: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    fontStyle: 'italic',
  }),
});
