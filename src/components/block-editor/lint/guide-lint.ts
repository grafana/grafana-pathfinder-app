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
import { formatPath, type ValidationError, type ValidationWarning } from '../../../validation/errors';
import type { JsonGuide } from '../../../types/json-guide.types';
import { suggestRequirement, unknownRequirementMessage } from '../../../types/requirements.types';
import type { Diagnostic } from './types';

/**
 * Strip the canonical "path: …" prefix and the CLI-specific
 * "Run \"pathfinder-cli requirements list\" for valid tokens." suffix from
 * a validation message, leaving the part that's useful to a content author
 * inside the editor. The full path is still available on `Diagnostic.path`
 * for routing.
 */
function cleanMessage(rawMessage: string, path: Array<string | number>): string {
  let message = rawMessage;
  if (path.length > 0) {
    const prefix = `${formatPath(path)}: `;
    if (message.startsWith(prefix)) {
      message = message.slice(prefix.length);
    }
  }
  // Strip the CLI hint — irrelevant inside the editor and visually noisy.
  message = message.replace(/\s*Run "pathfinder-cli requirements list" for valid tokens\.\s*$/, '');
  return message.trim();
}

/**
 * Pull the offending requirement token out of an unknown-requirement
 * message so we can surface a "Replace with X" quick-fix on the diagnostic.
 * The token is wrapped in straight or curly quotes depending on the source
 * (Zod custom-error vs condition-validator), so handle both.
 */
function extractRequirementToken(message: string): string | null {
  // unknownRequirementMessage uses double quotes: `Unknown requirement "x"`.
  const doubleQuote = message.match(/Unknown requirement "([^"]+)"/);
  if (doubleQuote?.[1]) {
    return doubleQuote[1];
  }
  // condition-validator uses single quotes: `Unknown condition type 'x'`.
  const singleQuote = message.match(/Unknown condition type '([^']+)'/);
  if (singleQuote?.[1]) {
    return singleQuote[1];
  }
  return null;
}

/**
 * Field names that introduce a separate visible block in the editor's tree
 * (sections expose children via `blocks`, conditionals via `whenTrue` /
 * `whenFalse`). When we attribute diagnostics to a block, we want to stop
 * at these boundaries so the parent's badge doesn't double-count something
 * that also has its own `<LintBadge>` further down the tree.
 *
 * `steps` is intentionally NOT in this set: multistep / guided steps are
 * edited inline inside the parent block's form, so step-level diagnostics
 * belong on the parent.
 */
const NESTED_BLOCK_CONTAINERS = new Set(['blocks', 'whenTrue', 'whenFalse']);

export interface GuideLintResult {
  /** All diagnostics in document order. */
  diagnostics: Diagnostic[];
  /**
   * Returns every diagnostic whose `path` starts with `prefix`, including
   * those that fall inside nested containers (sections, conditional
   * branches). Useful for whole-subtree summaries (e.g. the future Health
   * panel).
   */
  forPath: (prefix: Array<string | number>) => Diagnostic[];
  /**
   * Returns diagnostics that belong directly to the block at `prefix` and
   * its inline-edited fields (requirements, objectives, steps, etc.) —
   * but NOT diagnostics from nested children that have their own visible
   * block in the editor. Used by `<LintBadge>` so a section badge doesn't
   * duplicate the count already shown on its child step.
   */
  forPathDirect: (prefix: Array<string | number>) => Diagnostic[];
  /** True iff the underlying Zod validation succeeded (i.e. no errors). */
  isValid: boolean;
}

const EMPTY_RESULT: GuideLintResult = {
  diagnostics: [],
  forPath: () => [],
  forPathDirect: () => [],
  isValid: true,
};

function errorToDiagnostic(error: ValidationError): Diagnostic {
  // The Zod schema's RequirementTokenSchema rejects unknown tokens with the
  // canonical `unknownRequirementMessage(token)` text; surface a quick-fix
  // suggestion the same way `lintConditionField` does for in-form lint.
  const token = extractRequirementToken(error.message);
  const suggestion = token ? (suggestRequirement(token) ?? undefined) : undefined;
  // If the canonical message already includes the suggestion phrasing
  // ("…did you mean …"), the editor message has it too — nothing to do.
  // Otherwise the unknownRequirementMessage helper produces the same text
  // the CLI uses; we just strip the CLI suffix for the editor.
  void unknownRequirementMessage; // referenced for the suggestion-source comment above
  return {
    severity: 'error',
    code: error.code ? `zod.${error.code}` : 'zod.error',
    message: cleanMessage(error.message, error.path),
    path: error.path,
    suggestion,
    tokenAtFault: token ?? undefined,
  };
}

function warningToDiagnostic(warning: ValidationWarning): Diagnostic {
  const token = extractRequirementToken(warning.message);
  const suggestion = token ? (suggestRequirement(token) ?? undefined) : undefined;
  return {
    severity: 'warning',
    code: `guide.${warning.type}`,
    message: cleanMessage(warning.message, warning.path),
    path: warning.path,
    suggestion,
    tokenAtFault: token ?? undefined,
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

function makeForPathDirect(diagnostics: Diagnostic[]): GuideLintResult['forPathDirect'] {
  return (prefix: Array<string | number>) => {
    if (prefix.length === 0) {
      return [];
    }
    return diagnostics.filter((d) => {
      if (!pathStartsWith(d.path, prefix)) {
        return false;
      }
      // Exclude any diagnostic that descends into a nested-child container
      // immediately after the block's prefix.
      const next = d.path[prefix.length];
      return typeof next !== 'string' || !NESTED_BLOCK_CONTAINERS.has(next);
    });
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
    forPathDirect: makeForPathDirect(diagnostics),
    isValid: result.isValid,
  };
}
