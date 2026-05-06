/**
 * `HealthPanel` — guide-level diagnostics aside.
 *
 * Right-side panel showing every diagnostic the lint pipeline has
 * surfaced for the current guide, grouped by severity. Each row links
 * to the offending block so authors can jump straight to the fix.
 *
 * Reads from `useGuideLintResult()` (populated by the BlockEditor each
 * time the guide changes — Phase 1) and is mounted by BlockEditor when
 * the toolbar toggle in BlockEditorHeader is on.
 *
 * Phase 3 v1 scope: read-only listing + jump-to-block. Per-guide
 * dismissal (writing `metadata.lintIgnores`) is deferred until the
 * editor's `updateGuideMetadata` API can carry arbitrary metadata.
 */

import React, { useMemo } from 'react';
import { Badge, Icon, IconButton, Stack, Tooltip, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { useGuideLintResult } from './BlockEditorContext';
import type { Diagnostic, DiagnosticSeverity } from './lint';
import type { EditorBlock } from './types';

export interface HealthPanelProps {
  /** Top-level editor blocks — used to resolve a JSON path back to a block id for jump-to-block. */
  blocks: EditorBlock[];
  /** Called when the close (×) button is clicked. */
  onClose: () => void;
}

const SEVERITY_ORDER: DiagnosticSeverity[] = ['error', 'warning', 'info'];

const SEVERITY_LABELS: Record<DiagnosticSeverity, string> = {
  error: 'Errors',
  warning: 'Warnings',
  info: 'Suggestions',
};

const SEVERITY_ICONS: Record<DiagnosticSeverity, 'times-circle' | 'exclamation-triangle' | 'info-circle'> = {
  error: 'times-circle',
  warning: 'exclamation-triangle',
  info: 'info-circle',
};

/**
 * Resolve a diagnostic's JSON path to the editor-level id of the
 * top-level block it falls under. Diagnostics in nested children
 * still scroll to the top-level parent — good enough for jump-to-fix.
 */
function topLevelBlockIdForPath(path: ReadonlyArray<string | number>, blocks: EditorBlock[]): string | null {
  if (path[0] !== 'blocks' || typeof path[1] !== 'number') {
    return null;
  }
  const block = blocks[path[1]];
  return block ? block.id : null;
}

function jumpToBlock(blockId: string): void {
  const el = document.querySelector(`[data-block-id="${CSS.escape(blockId)}"]`);
  if (!el) {
    return;
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/**
 * Render one diagnostic row.
 */
function DiagnosticRow({
  diagnostic,
  blocks,
  styles,
}: {
  diagnostic: Diagnostic;
  blocks: EditorBlock[];
  styles: ReturnType<typeof getStyles>;
}) {
  const blockId = topLevelBlockIdForPath(diagnostic.path, blocks);
  const blockIndex = typeof diagnostic.path[1] === 'number' ? diagnostic.path[1] + 1 : null;
  const sevClass =
    diagnostic.severity === 'error'
      ? styles.rowError
      : diagnostic.severity === 'warning'
        ? styles.rowWarning
        : styles.rowInfo;
  const iconClass =
    diagnostic.severity === 'error'
      ? styles.iconError
      : diagnostic.severity === 'warning'
        ? styles.iconWarning
        : styles.iconInfo;

  return (
    <div className={`${styles.row} ${sevClass}`}>
      <Icon name={SEVERITY_ICONS[diagnostic.severity]} size="sm" className={iconClass} />
      <div className={styles.rowBody}>
        <div className={styles.rowMessage}>{diagnostic.message}</div>
        {blockIndex !== null && (
          <div className={styles.rowMeta}>
            <span className={styles.metaPart}>Block {blockIndex}</span>
            {blockId && (
              <button type="button" className={styles.jumpButton} onClick={() => jumpToBlock(blockId)}>
                Jump to block →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SeveritySection({
  severity,
  diagnostics,
  blocks,
  styles,
}: {
  severity: DiagnosticSeverity;
  diagnostics: Diagnostic[];
  blocks: EditorBlock[];
  styles: ReturnType<typeof getStyles>;
}) {
  if (diagnostics.length === 0) {
    return null;
  }
  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionLabel}>{SEVERITY_LABELS[severity]}</span>
        <Badge text={String(diagnostics.length)} color={severityToBadgeColor(severity)} />
      </div>
      <div className={styles.sectionRows}>
        {diagnostics.map((d, i) => (
          <DiagnosticRow key={`${d.code}-${i}`} diagnostic={d} blocks={blocks} styles={styles} />
        ))}
      </div>
    </div>
  );
}

function severityToBadgeColor(s: DiagnosticSeverity): 'red' | 'orange' | 'blue' {
  if (s === 'error') {
    return 'red';
  }
  if (s === 'warning') {
    return 'orange';
  }
  return 'blue';
}

export function HealthPanel({ blocks, onClose }: HealthPanelProps) {
  const styles = useStyles2(getStyles);
  const lint = useGuideLintResult();

  const grouped = useMemo(() => {
    const out: Record<DiagnosticSeverity, Diagnostic[]> = { error: [], warning: [], info: [] };
    if (!lint) {
      return out;
    }
    for (const d of lint.diagnostics) {
      out[d.severity].push(d);
    }
    return out;
  }, [lint]);

  const total = grouped.error.length + grouped.warning.length + grouped.info.length;

  return (
    <aside className={styles.panel} aria-label="Guide health">
      <div className={styles.header}>
        <Stack direction="row" alignItems="center" gap={1}>
          <Icon name="heart" size="md" />
          <span className={styles.title}>Guide health</span>
          {total > 0 && <Badge text={String(total)} color="blue" />}
        </Stack>
        <IconButton name="times" aria-label="Close health panel" onClick={onClose} tooltip="Close" />
      </div>

      {total === 0 ? (
        <div className={styles.empty}>
          <Icon name="check-circle" size="xl" className={styles.emptyIcon} />
          <div className={styles.emptyTitle}>No issues found</div>
          <div className={styles.emptySubtitle}>
            Pathfinder couldn&apos;t find any structural problems with this guide. Nice work.
          </div>
        </div>
      ) : (
        <div className={styles.body}>
          <Tooltip
            content={
              'Errors block save. Warnings highlight resilience risks but are not blocking. ' +
              'Suggestions are inferential nudges — apply if they fit your guide.'
            }
            placement="bottom"
          >
            <div className={styles.legend}>What do these severities mean?</div>
          </Tooltip>
          {SEVERITY_ORDER.map((sev) => (
            <SeveritySection key={sev} severity={sev} diagnostics={grouped[sev]} blocks={blocks} styles={styles} />
          ))}
        </div>
      )}
    </aside>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  panel: css({
    width: 360,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    borderLeft: `1px solid ${theme.colors.border.weak}`,
    backgroundColor: theme.colors.background.secondary,
    overflowY: 'auto',
  }),
  header: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing(1.5),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    position: 'sticky',
    top: 0,
    backgroundColor: theme.colors.background.secondary,
    zIndex: 1,
  }),
  title: css({
    fontSize: theme.typography.h5.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  body: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
    padding: theme.spacing(1.5),
  }),
  legend: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    cursor: 'help',
    textDecoration: 'underline dotted',
    alignSelf: 'flex-start',
  }),
  section: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.75),
  }),
  sectionHeader: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  sectionLabel: css({
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  }),
  sectionRows: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.75),
  }),
  row: css({
    display: 'flex',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
    borderRadius: theme.shape.radius.default,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: theme.typography.bodySmall.lineHeight,
    border: `1px solid transparent`,
  }),
  rowError: css({
    backgroundColor: theme.colors.error.transparent,
    borderColor: theme.colors.error.border,
  }),
  rowWarning: css({
    backgroundColor: theme.colors.warning.transparent,
    borderColor: theme.colors.warning.border,
  }),
  rowInfo: css({
    backgroundColor: theme.colors.info.transparent,
    borderColor: theme.colors.info.border,
  }),
  iconError: css({ color: theme.colors.error.text, flexShrink: 0, marginTop: 2 }),
  iconWarning: css({ color: theme.colors.warning.text, flexShrink: 0, marginTop: 2 }),
  iconInfo: css({ color: theme.colors.info.text, flexShrink: 0, marginTop: 2 }),
  rowBody: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    flex: 1,
    minWidth: 0,
  }),
  rowMessage: css({
    color: theme.colors.text.primary,
    wordBreak: 'break-word',
  }),
  rowMeta: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  metaPart: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  jumpButton: css({
    background: 'none',
    border: 'none',
    color: theme.colors.text.link,
    cursor: 'pointer',
    padding: 0,
    fontSize: theme.typography.bodySmall.fontSize,
    '&:hover': {
      textDecoration: 'underline',
    },
  }),
  empty: css({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(4, 2),
    textAlign: 'center',
    color: theme.colors.text.secondary,
  }),
  emptyIcon: css({
    color: theme.colors.success.text,
  }),
  emptyTitle: css({
    fontSize: theme.typography.h5.fontSize,
    color: theme.colors.text.primary,
  }),
  emptySubtitle: css({
    fontSize: theme.typography.bodySmall.fontSize,
    maxWidth: 260,
  }),
});
