/**
 * Guide-level lint.
 *
 * Wraps the canonical `validateGuide` from `src/validation/validate-guide.ts`
 * and exposes the result in a shape useful to the editor UI:
 *   - flat `Diagnostic[]` for a Health-panel-style listing,
 *   - `forPath(prefix)` so consumers can query diagnostics that fall under
 *     a specific JSON path prefix (e.g. `['blocks', 0]` for the first
 *     top-level block, `['blocks', 1, 'blocks', 0]` for a section child).
 *
 * Phase 1 scope: only the diagnostics that already come out of `validateGuide`
 * (Zod errors → severity 'error', everything else → 'warning'). Cross-block
 * editor-only checks are layered in Phase 3 — this module is the seam.
 */

import { validateGuide, type ValidationResult } from '../../../validation/validate-guide';
import type { ValidationError, ValidationWarning } from '../../../validation/errors';
import type { JsonGuide } from '../../../types/json-guide.types';
import { suggestRequirement } from '../../../types/requirements.types';
import type { Diagnostic } from './types';

export interface GuideLintResult {
  /** All diagnostics in document order. */
  diagnostics: Diagnostic[];
  /**
   * Returns the subset of diagnostics whose `path` starts with `prefix`.
   * Used by `<LintBadge>` to render a per-block diagnostic count without
   * needing the block to have a stable JSON `id`.
   */
  forPath: (prefix: Array<string | number>) => Diagnostic[];
  /** True iff the underlying Zod validation succeeded (i.e. no errors). */
  isValid: boolean;
}

const EMPTY_RESULT: GuideLintResult = {
  diagnostics: [],
  forPath: () => [],
  isValid: true,
};

function errorToDiagnostic(error: ValidationError): Diagnostic {
  return {
    severity: 'error',
    code: error.code ? `zod.${error.code}` : 'zod.error',
    message: error.message,
    path: error.path,
  };
}

function warningToDiagnostic(warning: ValidationWarning): Diagnostic {
  // For invalid-condition warnings the path ends at the condition array
  // index (e.g. `[..., 'requirements', 0]`). The condition string isn't
  // stored on the warning, so we cannot recompute a suggestion here — the
  // suggestion lives on the field-level diagnostic instead.
  // For unknown-condition messages the canonical formatter surfaces the
  // bad token in the text after a colon; pull it out so we can offer a fix.
  let suggestion: string | undefined;
  if (warning.type === 'invalid-condition') {
    const match = warning.message.match(/Unknown condition type '([^']+)'/);
    if (match?.[1]) {
      suggestion = suggestRequirement(match[1]) ?? undefined;
    }
  }
  return {
    severity: 'warning',
    code: `guide.${warning.type}`,
    message: warning.message,
    path: warning.path,
    suggestion,
  };
}

function pathStartsWith(path: Array<string | number>, prefix: Array<string | number>): boolean {
  if (path.length < prefix.length) {
    return false;
  }
  for (let i = 0; i < prefix.length; i++) {
    if (path[i] !== prefix[i]) {
      return false;
    }
  }
  return true;
}

function makeForPath(diagnostics: Diagnostic[]): GuideLintResult['forPath'] {
  return (prefix: Array<string | number>) => {
    if (prefix.length === 0) {
      return diagnostics;
    }
    return diagnostics.filter((d) => pathStartsWith(d.path, prefix));
  };
}

/**
 * Run the full guide lint pipeline. Pure function; safe to call from a `useMemo`.
 *
 * @param guide - The in-memory guide. May be `null` (returns an empty result).
 */
export function lintGuide(guide: JsonGuide | null | undefined): GuideLintResult {
  if (!guide) {
    return EMPTY_RESULT;
  }

  // We never want unknown-field warnings in the editor: those exist for
  // detecting forward-incompatible additions, not for nudging authors.
  const result: ValidationResult = validateGuide(guide, { skipUnknownFieldCheck: true });

  const diagnostics: Diagnostic[] = [
    ...result.errors.map(errorToDiagnostic),
    ...result.warnings.map(warningToDiagnostic),
  ];

  return {
    diagnostics,
    forPath: makeForPath(diagnostics),
    isValid: result.isValid,
  };
}
