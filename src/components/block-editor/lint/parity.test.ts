/**
 * CLI ↔ editor lint parity.
 *
 * The contract: every diagnostic the canonical `validateGuide` emits
 * (used by the CLI, MCP `pathfinder_validate`, and the schema-export
 * pipeline) MUST be reproduced by the editor's `lintGuide` at the same
 * severity, same JSON path, with an equivalent code (the editor
 * prefixes canonical codes with `zod.` for errors and `guide.` for
 * warnings).
 *
 * The editor MAY emit additional diagnostics that have no canonical
 * counterpart — these are the editor-only cross-block checks (Phase 3+:
 * destructive-action-without-objective, orphan-section-reference, etc.).
 * Their codes always start with `editor.` so we can distinguish.
 *
 * If a canonical diagnostic is missing from the editor — or if the
 * editor emits a `zod.`/`guide.`-coded diagnostic the canonical doesn't
 * — the test fails. Editor-only `editor.*` codes pass through silently.
 *
 * Add a new fixture below whenever a new lint rule is introduced.
 */

import { validateGuide } from '../../../validation/validate-guide';
import { lintGuide } from './guide-lint';
import type { JsonGuide } from '../../../types/json-guide.types';
import type { ValidationError, ValidationWarning } from '../../../validation/errors';
import type { Diagnostic } from './types';
// Real bundled guide — smoke test that healthy guides stay healthy across paths.
import firstDashboardGuide from '../../../bundled-interactives/first-dashboard/content.json';

const FIRST_DASHBOARD = firstDashboardGuide as unknown as JsonGuide;

const FIXTURES: Array<{ name: string; guide: JsonGuide }> = [
  {
    name: 'empty valid guide',
    guide: { id: 'empty', title: 'Empty', blocks: [] },
  },
  {
    name: 'guide with one valid interactive block',
    guide: {
      id: 'one',
      title: 'One block',
      blocks: [
        {
          type: 'interactive',
          action: 'highlight',
          reftarget: 'button',
          content: 'Click',
          requirements: ['exists-reftarget'],
        },
      ],
    },
  },
  {
    name: 'guide with unknown requirement (Zod error)',
    guide: {
      id: 'unknown-req',
      title: 'Unknown req',
      blocks: [
        {
          type: 'interactive',
          action: 'highlight',
          reftarget: 'button',
          content: 'Click',
          requirements: ['totally-bogus'],
        },
      ],
    },
  },
  {
    name: 'guide with format-issue requirement (canonical warning)',
    guide: {
      id: 'bad-format',
      title: 'Bad format',
      blocks: [
        {
          type: 'interactive',
          action: 'highlight',
          reftarget: 'button',
          content: 'Click',
          requirements: ['on-page:no-leading-slash'],
        },
      ],
    },
  },
  {
    name: 'guide with multiple issues at different paths',
    guide: {
      id: 'multi',
      title: 'Multi',
      blocks: [
        {
          type: 'interactive',
          action: 'highlight',
          reftarget: 'a',
          content: 'first',
          requirements: ['on-page:no-slash'],
        },
        {
          type: 'section',
          title: 'A section',
          blocks: [
            {
              type: 'interactive',
              action: 'highlight',
              reftarget: 'b',
              content: 'nested',
              requirements: ['min-version:not-semver'],
            },
          ],
        },
      ],
    },
  },
  {
    name: 'guide with non-requirement Zod error (formfill missing reftarget)',
    // Cast to JsonGuide because TS would catch this at compile time, but
    // we want runtime Zod to catch it instead.
    guide: {
      id: 'zod-error',
      title: 'Zod error',
      blocks: [
        {
          type: 'interactive',
          action: 'formfill',
          content: 'fill',
          // reftarget intentionally omitted
        },
      ],
    } as unknown as JsonGuide,
  },
  {
    name: 'real bundled guide (first-dashboard) is clean',
    guide: FIRST_DASHBOARD,
  },
];

function pathsEqual(a: ReadonlyArray<string | number>, b: ReadonlyArray<string | number>): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Match a canonical error against the editor's diagnostic list.
 * The editor prefixes canonical Zod codes with `zod.`; messages differ
 * (the editor strips the path prefix and CLI hint) but path + severity +
 * canonical code must round-trip.
 */
function findMatchingError(error: ValidationError, editorDiagnostics: Diagnostic[]): Diagnostic | undefined {
  const expectedCode = error.code ? `zod.${error.code}` : 'zod.error';
  return editorDiagnostics.find(
    (d) => d.severity === 'error' && d.code === expectedCode && pathsEqual(d.path, error.path)
  );
}

function findMatchingWarning(warning: ValidationWarning, editorDiagnostics: Diagnostic[]): Diagnostic | undefined {
  const expectedCode = `guide.${warning.type}`;
  return editorDiagnostics.find(
    (d) => d.severity === 'warning' && d.code === expectedCode && pathsEqual(d.path, warning.path)
  );
}

/** Returns true if the diagnostic's code is an editor-only check (no canonical source). */
function isEditorOnly(diagnostic: Diagnostic): boolean {
  return diagnostic.code.startsWith('editor.');
}

describe('CLI ↔ editor lint parity', () => {
  describe.each(FIXTURES)('$name', ({ guide }) => {
    it('every canonical diagnostic is reproduced by the editor (editor may emit additional editor.* checks)', () => {
      // Editor uses skipUnknownFieldCheck:true (it's not a forward-compat
      // signal in the editor context). Match that here.
      const canonical = validateGuide(guide, { skipUnknownFieldCheck: true });
      const editor = lintGuide(guide);

      // Restrict the editor side to canonical-derived diagnostics —
      // editor.* codes are the cross-block checks and have no canonical
      // counterpart, so they pass through silently.
      const editorCanonicalErrors = editor.diagnostics.filter((d) => d.severity === 'error' && !isEditorOnly(d));
      const editorCanonicalWarnings = editor.diagnostics.filter((d) => d.severity === 'warning' && !isEditorOnly(d));

      // Counts of canonical-derived diagnostics must match exactly.
      expect(editorCanonicalErrors).toHaveLength(canonical.errors.length);
      expect(editorCanonicalWarnings).toHaveLength(canonical.warnings.length);

      // Every canonical error must have a corresponding editor error at
      // the same path with the prefixed code.
      for (const error of canonical.errors) {
        const matched = findMatchingError(error, editorCanonicalErrors);
        if (!matched) {
          throw new Error(
            `No editor error matched canonical error: ${JSON.stringify({
              path: error.path,
              code: error.code,
              message: error.message,
            })}\n\nEditor errors saw:\n${JSON.stringify(editorCanonicalErrors, null, 2)}`
          );
        }
      }

      // Same for warnings.
      for (const warning of canonical.warnings) {
        const matched = findMatchingWarning(warning, editorCanonicalWarnings);
        if (!matched) {
          throw new Error(
            `No editor warning matched canonical warning: ${JSON.stringify({
              path: warning.path,
              type: warning.type,
              message: warning.message,
            })}\n\nEditor warnings saw:\n${JSON.stringify(editorCanonicalWarnings, null, 2)}`
          );
        }
      }
    });

    it('agrees on overall validity', () => {
      const canonical = validateGuide(guide, { skipUnknownFieldCheck: true });
      const editor = lintGuide(guide);
      expect(editor.isValid).toBe(canonical.isValid);
    });
  });
});
