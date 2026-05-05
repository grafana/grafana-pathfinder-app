/**
 * Guide-level lint.
 *
 * Wraps the canonical `validateGuide` from `src/validation/validate-guide.ts`
 * and exposes the result in a shape useful to the editor UI:
 *   - flat `Diagnostic[]` for a Health-panel-style listing,
 *   - `byBlockId: Map<string, Diagnostic[]>` so `BlockItem` can render a
 *     per-block badge without re-traversing the tree.
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
  /** Diagnostics keyed by block id (only populated for diagnostics whose path resolves to a block). */
  byBlockId: Map<string, Diagnostic[]>;
  /** True iff the underlying Zod validation succeeded (i.e. no errors). */
  isValid: boolean;
}

const EMPTY_RESULT: GuideLintResult = {
  diagnostics: [],
  byBlockId: new Map(),
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

/**
 * Walk a guide and build a `path-prefix → block.id` index. The prefix is the
 * canonical Zod path up to (but not including) the block's local fields, e.g.
 *   ['blocks', 0]                 -> top-level block id
 *   ['blocks', 1, 'blocks', 0]    -> first child of section at index 1
 *   ['blocks', 2, 'whenTrue', 0]  -> first whenTrue child of conditional
 *
 * Diagnostics whose path begins with one of these prefixes are attributed to
 * the corresponding block id.
 */
function indexBlockPaths(guide: JsonGuide): Array<{ prefix: Array<string | number>; id: string }> {
  const out: Array<{ prefix: Array<string | number>; id: string }> = [];

  function visit(blocks: unknown, base: Array<string | number>): void {
    if (!Array.isArray(blocks)) {
      return;
    }
    blocks.forEach((block, i) => {
      if (!block || typeof block !== 'object') {
        return;
      }
      const prefix = [...base, i];
      const id = (block as { id?: unknown }).id;
      if (typeof id === 'string' && id) {
        out.push({ prefix, id });
      }
      const blockObj = block as Record<string, unknown>;
      if (Array.isArray(blockObj.blocks)) {
        visit(blockObj.blocks, [...prefix, 'blocks']);
      }
      if (Array.isArray(blockObj.whenTrue)) {
        visit(blockObj.whenTrue, [...prefix, 'whenTrue']);
      }
      if (Array.isArray(blockObj.whenFalse)) {
        visit(blockObj.whenFalse, [...prefix, 'whenFalse']);
      }
    });
  }

  visit(guide.blocks, ['blocks']);
  return out;
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

function attributeToBlocks(
  diagnostics: Diagnostic[],
  blockIndex: Array<{ prefix: Array<string | number>; id: string }>
): Map<string, Diagnostic[]> {
  const byBlockId = new Map<string, Diagnostic[]>();
  for (const diag of diagnostics) {
    // Find the longest matching prefix (most specific block).
    let best: { prefix: Array<string | number>; id: string } | null = null;
    for (const entry of blockIndex) {
      if (pathStartsWith(diag.path, entry.prefix)) {
        if (!best || entry.prefix.length > best.prefix.length) {
          best = entry;
        }
      }
    }
    if (best) {
      const list = byBlockId.get(best.id) ?? [];
      list.push(diag);
      byBlockId.set(best.id, list);
    }
  }
  return byBlockId;
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

  const byBlockId = attributeToBlocks(diagnostics, indexBlockPaths(guide));

  return {
    diagnostics,
    byBlockId,
    isValid: result.isValid,
  };
}
