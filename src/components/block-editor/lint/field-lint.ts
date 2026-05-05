/**
 * Field-level lint for requirements / objectives / verify inputs.
 *
 * Wraps `validateConditionString` from `src/validation/condition-validator.ts`
 * and `suggestRequirement` from `src/types/requirements.types.ts` into a
 * single keystroke-cheap call that returns `Diagnostic[]` ready for the form
 * UI.
 *
 * The interesting nuance is **mid-edit suppression**. Without it, an author
 * typing `on-pa` would immediately see "Unknown condition type 'on-pa'",
 * which is noisy. We suppress unknown-type warnings for any token that is a
 * strict prefix of a known parameterized prefix or fixed type.
 */

import { validateConditionString, type ConditionIssue } from '../../../validation/condition-validator';
import {
  FIXED_REQUIREMENTS,
  PARAMETERIZED_REQUIREMENT_PREFIXES,
  suggestRequirement,
} from '../../../types/requirements.types';
import type { Diagnostic, FieldLintResult } from './types';

/**
 * Returns true if `token` could plausibly be in-progress: it is a strict
 * prefix of a known fixed requirement (`exists-r` → `exists-reftarget`) or
 * of a parameterized prefix (`on-pa` → `on-page:`). The empty string is
 * never considered in-progress (it never produces a diagnostic anyway).
 */
function isInProgressToken(token: string): boolean {
  if (!token) {
    return false;
  }
  for (const fixed of FIXED_REQUIREMENTS) {
    if (fixed.startsWith(token) && fixed !== token) {
      return true;
    }
  }
  for (const prefix of PARAMETERIZED_REQUIREMENT_PREFIXES) {
    if (prefix.startsWith(token) && prefix !== token) {
      return true;
    }
  }
  return false;
}

function issueToDiagnostic(issue: ConditionIssue): Diagnostic {
  const suggestion = issue.code === 'unknown_type' ? (suggestRequirement(issue.condition) ?? undefined) : undefined;
  return {
    severity: 'warning',
    code: `condition.${issue.code}`,
    message: issue.message,
    path: issue.path,
    suggestion: suggestion ?? undefined,
  };
}

/**
 * Lint a single condition field's raw text value.
 *
 * @param value - The raw text from the input (comma-separated)
 * @param options.suppressInProgress - If true (default), tokens that look
 *   like an in-flight prefix do not produce diagnostics. Set false in tests
 *   that want to assert on the unfiltered output.
 */
export function lintConditionField(value: string, options: { suppressInProgress?: boolean } = {}): FieldLintResult {
  const suppress = options.suppressInProgress ?? true;

  if (!value || !value.trim()) {
    return { diagnostics: [] };
  }

  const issues = validateConditionString(value, []);
  const diagnostics: Diagnostic[] = [];

  for (const issue of issues) {
    if (suppress && issue.code === 'unknown_type' && isInProgressToken(issue.condition)) {
      continue;
    }
    diagnostics.push(issueToDiagnostic(issue));
  }

  return { diagnostics };
}

/**
 * Replace one specific bad token in a comma-separated condition field with a
 * corrected value. Whitespace and order around other tokens are preserved.
 *
 * Used by the inline "Replace with X" quick-fix button.
 */
export function replaceTokenInConditionField(value: string, oldToken: string, newToken: string): string {
  const parts = value.split(',');
  let replaced = false;
  const next = parts
    .map((part) => {
      if (replaced) {
        return part;
      }
      const trimmed = part.trim();
      if (trimmed === oldToken) {
        replaced = true;
        // Preserve any leading whitespace around the token.
        const leading = part.match(/^\s*/)?.[0] ?? '';
        const trailing = part.match(/\s*$/)?.[0] ?? '';
        return `${leading}${newToken}${trailing}`;
      }
      return part;
    })
    .join(',');
  return replaced ? next : value;
}
