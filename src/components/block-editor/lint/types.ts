/**
 * Block editor lint types.
 *
 * Diagnostics surfaced by the editor's real-time lint pipeline. The shape
 * mirrors what the canonical `validateGuide` returns from
 * `src/validation/validate-guide.ts` so the two converge on a single
 * vocabulary; editor-only checks (added in later phases) reuse the same shape.
 */

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  /** Stable machine code: lets us key quick-fixes and tests off this. */
  code: string;
  /** Human-readable message. */
  message: string;
  /** JSON path to the offending value, e.g. `['blocks', 2, 'requirements', 0]`. */
  path: Array<string | number>;
  /**
   * Optional one-click replacement value. For requirements/objectives this is
   * the corrected token (e.g. `has-role:editor` for a misspelled `has-rle:editor`).
   */
  suggestion?: string;
  /**
   * The specific token in a condition string that is at fault. Set for
   * condition diagnostics so the UI can replace just that token without
   * touching neighbours. Undefined for whole-field or whole-guide diagnostics.
   */
  tokenAtFault?: string;
}

/**
 * Result of running the field-level lint on a single condition string.
 * Field-level lint operates on the raw text value of one field (e.g.
 * "exists-reftarget, on-page:/explore"). Returned diagnostics carry no path
 * because the consumer knows the field they came from.
 */
export interface FieldLintResult {
  diagnostics: Diagnostic[];
}
