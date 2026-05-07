/**
 * `HealthStatusBar` — guide-level diagnostics, IDE-style.
 *
 * Sticky bar at the bottom of the editor showing severity counts and an
 * expandable body listing every diagnostic the lint pipeline has
 * surfaced. Click the bar to toggle the expanded body; each row's
 * `Locate →` action flashes the offending block in place.
 *
 * Read-only by design: diagnostics can't be dismissed. The lint rules
 * exist to nudge authors toward resilient guide design, so allowing
 * silencing would defeat their purpose. Author-facing fix is to
 * address the diagnostic, not hide it.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Icon, IconButton, Tooltip, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { useGuideLintResult } from './BlockEditorContext';
import type { Diagnostic, DiagnosticSeverity } from './lint';
import type { EditorBlock } from './types';
import type { JsonBlock } from '../../types/json-guide.types';

export interface HealthStatusBarProps {
  /** Top-level editor blocks — used to resolve a JSON path back to a block id for jump-to-block. */
  blocks: EditorBlock[];
}

const STORAGE_KEY = 'pathfinder.blockEditor.healthPanel.open';

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
 * Container fields a diagnostic path may descend into. Anything else
 * in the path (e.g. `requirements`, `objectives`) is treated as a leaf
 * field on the current block, not a child container.
 */
const CONTAINER_KEYS = new Set(['blocks', 'whenTrue', 'whenFalse', 'steps']);

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

function blockLabel(block: JsonBlock | undefined, index: number, containerKey: string | null): string {
  if (!block || typeof block !== 'object') {
    return `#${index + 1}`;
  }
  const type = typeof (block as { type?: unknown }).type === 'string' ? (block as { type: string }).type : 'block';
  const title = typeof (block as { title?: unknown }).title === 'string' ? (block as { title: string }).title : null;

  // Inside multistep/guided, children are "Step N", not blocks.
  if (containerKey === 'steps') {
    return `Step ${index + 1}`;
  }
  if (title) {
    return `${capitalize(type)} "${title}"`;
  }
  return `${capitalize(type)} ${index + 1}`;
}

interface ResolvedLocator {
  /**
   * Candidate `data-block-path` values to try in order, deepest first.
   * Steps inside multistep/guided have no DOM presence in the main view,
   * so the deepest renderable ancestor will match instead.
   */
  pathCandidates: string[];
  /** Human-readable breadcrumb of the path from top-level down to the offending block. */
  breadcrumb: string;
}

function resolveLocator(path: ReadonlyArray<string | number>, blocks: EditorBlock[]): ResolvedLocator {
  if (path[0] !== 'blocks' || typeof path[1] !== 'number') {
    return { pathCandidates: [], breadcrumb: '' };
  }
  const topLevel = blocks[path[1]];
  if (!topLevel) {
    return { pathCandidates: [], breadcrumb: '' };
  }

  const segments: string[] = [blockLabel(topLevel.block, path[1], null)];
  const candidates: string[] = [`blocks.${path[1]}`];
  let current: JsonBlock | undefined = topLevel.block;

  for (let i = 2; i < path.length; i += 2) {
    const key = path[i];
    const idx = path[i + 1];
    if (typeof key !== 'string' || typeof idx !== 'number' || !CONTAINER_KEYS.has(key)) {
      break;
    }
    const children = (current as unknown as Record<string, unknown> | undefined)?.[key];
    if (!Array.isArray(children)) {
      break;
    }
    const child = children[idx] as JsonBlock | undefined;
    segments.push(blockLabel(child, idx, key));
    candidates.push(`${candidates[candidates.length - 1]}.${key}.${idx}`);
    if (!child) {
      break;
    }
    current = child;
  }

  // Try deepest match first; fall back up the chain if a renderer
  // (e.g. multistep `steps`) doesn't expose the inner block in the DOM.
  return { pathCandidates: candidates.reverse(), breadcrumb: segments.join(' › ') };
}

/**
 * Scroll the most-specific rendered block into view and pulse a
 * warning-colored outline. The flash works even when no scrolling was
 * needed, so the affordance is always visible.
 */
function flashBlock(pathCandidates: string[]): void {
  let host: HTMLElement | null = null;
  for (const candidate of pathCandidates) {
    const found = document.querySelector(`[data-block-path="${candidate}"]`);
    if (found instanceof HTMLElement) {
      host = found;
      break;
    }
  }
  if (!host) {
    return;
  }
  // Animate the inner block card (the element with the rounded border)
  // so the flash ring follows the visible block edge — falls back to the
  // host wrapper if a card marker isn't present.
  const card = host.querySelector('[data-block-card]');
  const target = card instanceof HTMLElement ? card : host;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (typeof target.animate !== 'function') {
    return;
  }
  // Inset shadow — outer rings get clipped by ancestor `overflow: hidden`
  // (the section's collapse-animation container uses it), so we draw the
  // pulse inside the card's own bounds where nothing can clip it.
  target.animate(
    [
      { boxShadow: 'inset 0 0 0 0 rgba(255, 152, 0, 0)' },
      { boxShadow: 'inset 0 0 0 4px rgba(255, 152, 0, 0.75)' },
      { boxShadow: 'inset 0 0 0 0 rgba(255, 152, 0, 0)' },
    ],
    { duration: 1400, easing: 'ease-out' }
  );
}

function DiagnosticRow({
  diagnostic,
  blocks,
  styles,
}: {
  diagnostic: Diagnostic;
  blocks: EditorBlock[];
  styles: ReturnType<typeof getStyles>;
}) {
  const { pathCandidates, breadcrumb } = resolveLocator(diagnostic.path, blocks);
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
        {breadcrumb && (
          <div className={styles.rowMeta}>
            <span className={styles.breadcrumb}>{breadcrumb}</span>
            {pathCandidates.length > 0 && (
              <button type="button" className={styles.jumpButton} onClick={() => flashBlock(pathCandidates)}>
                Locate →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SeverityChip({
  severity,
  count,
  styles,
}: {
  severity: DiagnosticSeverity;
  count: number;
  styles: ReturnType<typeof getStyles>;
}) {
  const chipClass =
    severity === 'error' ? styles.chipError : severity === 'warning' ? styles.chipWarning : styles.chipInfo;
  return (
    <span className={`${styles.chip} ${chipClass}`} aria-label={`${count} ${SEVERITY_LABELS[severity].toLowerCase()}`}>
      <Icon name={SEVERITY_ICONS[severity]} size="sm" />
      <span>{count}</span>
    </span>
  );
}

export function HealthStatusBar({ blocks }: HealthStatusBarProps) {
  const styles = useStyles2(getStyles);
  const lint = useGuideLintResult();

  const [isExpanded, setIsExpanded] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // localStorage unavailable; in-memory is fine.
      }
      return next;
    });
  }, []);

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
    <div className={styles.root} aria-label="Guide health">
      <button
        type="button"
        className={styles.bar}
        onClick={toggleExpanded}
        aria-expanded={isExpanded}
        aria-label={isExpanded ? 'Collapse guide health' : 'Expand guide health'}
        data-testid="pathfinder-block-editor-health-status-bar"
      >
        <Icon name="heart" size="sm" />
        <span className={styles.title}>Guide health</span>
        {total === 0 ? (
          <span className={styles.allClear}>
            <Icon name="check-circle" size="sm" />
            No issues
          </span>
        ) : (
          <span className={styles.chips}>
            {grouped.error.length > 0 && <SeverityChip severity="error" count={grouped.error.length} styles={styles} />}
            {grouped.warning.length > 0 && (
              <SeverityChip severity="warning" count={grouped.warning.length} styles={styles} />
            )}
            {grouped.info.length > 0 && <SeverityChip severity="info" count={grouped.info.length} styles={styles} />}
          </span>
        )}
        <span className={styles.spacer} />
        <Icon name={isExpanded ? 'angle-down' : 'angle-up'} size="sm" />
      </button>
      {isExpanded && (
        <div className={styles.body}>
          {total === 0 ? (
            <div className={styles.empty}>
              <Icon name="check-circle" size="lg" className={styles.emptyIcon} />
              <span>No issues found — this guide looks healthy.</span>
            </div>
          ) : (
            <>
              {SEVERITY_ORDER.map((sev) =>
                grouped[sev].length === 0 ? null : (
                  <div key={sev} className={styles.section}>
                    <div className={styles.sectionLabel}>
                      <span>
                        {SEVERITY_LABELS[sev]} ({grouped[sev].length})
                      </span>
                      {/* Severity legend lives on a small ?-icon next to
                          the first section header — same Tooltip content
                          as the old underlined-dotted "What do these
                          severities mean?" row, but no vertical-space cost. */}
                      {sev === SEVERITY_ORDER.find((s) => grouped[s].length > 0) && (
                        <Tooltip
                          content={
                            'Errors block save. Warnings highlight resilience risks but are not blocking. ' +
                            'Suggestions are inferential nudges — apply if they fit your guide.'
                          }
                          placement="top"
                        >
                          <IconButton name="question-circle" size="sm" aria-label="What do these severities mean?" />
                        </Tooltip>
                      )}
                    </div>
                    <div className={styles.sectionRows}>
                      {grouped[sev].map((d, i) => (
                        <DiagnosticRow key={`${d.code}-${i}`} diagnostic={d} blocks={blocks} styles={styles} />
                      ))}
                    </div>
                  </div>
                )
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  root: css({
    position: 'sticky',
    bottom: 0,
    zIndex: theme.zIndex.navbarFixed,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: theme.colors.background.secondary,
    borderTop: `1px solid ${theme.colors.border.weak}`,
    flexShrink: 0,
    // Absorbs leftover column space so the bar sits at the editor's
    // visible bottom while leaving the "Add Block" footer attached to
    // the natural end of the blocks list above it.
    marginTop: 'auto',
  }),
  bar: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(0.75, 1.5),
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: theme.colors.text.primary,
    fontSize: theme.typography.bodySmall.fontSize,
    textAlign: 'left',
    width: '100%',
    '&:hover': {
      backgroundColor: theme.colors.action.hover,
    },
    '&:focus-visible': {
      outline: `2px solid ${theme.colors.primary.border}`,
      outlineOffset: -2,
    },
  }),
  title: css({
    fontWeight: theme.typography.fontWeightMedium,
  }),
  spacer: css({
    flex: 1,
  }),
  chips: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
  }),
  chip: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.25),
    padding: theme.spacing(0.125, 0.75),
    borderRadius: theme.shape.radius.pill,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    border: `1px solid transparent`,
  }),
  chipError: css({
    backgroundColor: theme.colors.error.transparent,
    borderColor: theme.colors.error.border,
    color: theme.colors.error.text,
  }),
  chipWarning: css({
    backgroundColor: theme.colors.warning.transparent,
    borderColor: theme.colors.warning.border,
    color: theme.colors.warning.text,
  }),
  chipInfo: css({
    backgroundColor: theme.colors.info.transparent,
    borderColor: theme.colors.info.border,
    color: theme.colors.info.text,
  }),
  allClear: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    color: theme.colors.success.text,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  body: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
    padding: theme.spacing(1.5),
    maxHeight: '40vh',
    overflowY: 'auto',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  section: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.75),
  }),
  sectionLabel: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
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
  breadcrumb: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    wordBreak: 'break-word',
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
    alignItems: 'center',
    gap: theme.spacing(1),
    color: theme.colors.text.secondary,
    padding: theme.spacing(1, 0),
  }),
  emptyIcon: css({
    color: theme.colors.success.text,
    flexShrink: 0,
  }),
});
