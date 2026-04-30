/**
 * In-memory state validation for the authoring CLI.
 *
 * `validatePackageState` is the post-mutation gate: it runs Zod against
 * `ContentJsonSchema` and `ManifestJsonSchema`, calls the deeper
 * `validateGuide` for condition syntax + unknown-field checks, and adds the
 * cross-file checks (id equality, schemaVersion drift). Returns
 * `{ ok, issues[] }` rather than throwing so callers can render every issue
 * at once.
 *
 * Separate from the disk-aware `validatePackage(dir)` in
 * `src/validation/validate-package.ts` — that's the publish gate; this is
 * what every authoring write goes through.
 */

import {
  EMPTY_CHOICES_MESSAGE,
  EMPTY_CONDITIONS_MESSAGE,
  EMPTY_SCREENS_MESSAGE,
  EMPTY_STEPS_MESSAGE,
  QUIZ_MULTI_CORRECT_PREFIX,
  QUIZ_NO_CORRECT_CHOICE_PREFIX,
} from '../../../types/json-guide.schema';
import { ContentJsonSchema, ManifestJsonSchema } from '../../../types/package.schema';
import type { ContentJson, ManifestJson } from '../../../types/package.types';
import { validateGuide } from '../../../validation/validate-guide';
import type { PackageIOErrorCode, PackageIOIssue } from './errors';

export interface ValidationOutcome {
  ok: boolean;
  issues: PackageIOIssue[];
}

export interface ValidatePackageStateOptions {
  /**
   * Whether `manifest.schemaVersion` was authored explicitly (vs. defaulted by
   * Zod at parse time). When false, the cross-file drift check is skipped —
   * a defaulted manifest value cannot conflict with content.json. Defaults to
   * `true` (strict) so callers that don't have authored-ness information
   * (e.g., commands that built a manifest in-memory) keep the historical
   * strict behavior.
   */
  manifestSchemaVersionAuthored?: boolean;
}

/**
 * Validate a fully-parsed package state.
 *
 * Composes the same checks `validatePackage(dir)` runs but on in-memory
 * data: Zod against `ContentJsonSchema` (re-checks structure after a
 * mutation), Zod against `ManifestJsonSchema` if a manifest is present,
 * cross-file `id` equality, and the deeper guide-level checks
 * (`validateGuide` covers conditions and unknown fields).
 *
 * Returns `{ ok: false, issues }` rather than throwing because callers
 * routinely want to surface multiple issues to the user in one go (e.g.,
 * structured `--format json` output listing every problem).
 */
export function validatePackageState(
  content: ContentJson,
  manifest: ManifestJson | undefined,
  options: ValidatePackageStateOptions = {}
): ValidationOutcome {
  const issues: PackageIOIssue[] = [];

  const contentParsed = ContentJsonSchema.safeParse(content);
  if (!contentParsed.success) {
    for (const issue of contentParsed.error.issues) {
      if (isEmptyContainerCompletenessMessage(issue.message)) {
        continue;
      }
      issues.push({
        code: classifyContentIssue(issue.message),
        message: `content.json: ${issue.message}`,
        path: ['content.json', ...issue.path.map(String)],
      });
    }
  }

  // Always run validateGuide too — it adds condition syntax and unknown-field
  // checks on top of the basic Zod parse. Skipping it would let an authoring
  // command drift past invalid `requirements: ['weird-condition']` strings.
  const guideResult = validateGuide(content);
  if (!guideResult.isValid) {
    for (const err of guideResult.errors) {
      if (isEmptyContainerCompletenessMessage(err.message)) {
        continue;
      }
      // Skip messages already flagged above to avoid duplicate reporting on
      // the most common failure (Zod returns the same issue from both paths).
      if (issues.some((i) => i.message.includes(err.message))) {
        continue;
      }
      issues.push({
        code: classifyContentIssue(err.message),
        message: `content.json: ${err.message}`,
        path: ['content.json', ...err.path.map(String)],
      });
    }
  }

  if (manifest) {
    const manifestParsed = ManifestJsonSchema.safeParse(manifest);
    if (!manifestParsed.success) {
      for (const issue of manifestParsed.error.issues) {
        issues.push({
          code: 'SCHEMA_VALIDATION',
          message: `manifest.json: ${issue.message}`,
          path: ['manifest.json', ...issue.path.map(String)],
        });
      }
    } else {
      if (manifest.id !== content.id) {
        issues.push({
          code: 'ID_MISMATCH',
          message: `ID mismatch: content.json has "${content.id}", manifest.json has "${manifest.id}". Fix: pathfinder-cli rename-id <dir> <chosen-id>`,
          path: ['id'],
        });
      }
      // Skip the drift check when the manifest's schemaVersion was filled in
      // by a Zod default rather than authored on disk — comparing a defaulted
      // value against an explicitly-authored content.json version yields false
      // drift on legacy packages whose manifest predates the field. The
      // authored flag defaults to `true` for callers that don't supply it, so
      // in-memory mutations (e.g. set-manifest after parsing through the
      // schema) keep the historical strict semantics.
      const manifestSchemaVersionAuthored = options.manifestSchemaVersionAuthored ?? true;
      if (
        manifestSchemaVersionAuthored &&
        content.schemaVersion !== undefined &&
        manifest.schemaVersion !== undefined &&
        manifest.schemaVersion !== content.schemaVersion
      ) {
        issues.push({
          code: 'SCHEMA_VERSION_MISMATCH',
          message: `schemaVersion mismatch: content.json has "${content.schemaVersion}", manifest.json has "${manifest.schemaVersion}". Use set-manifest --schema-version to align them (the manifest patch mirrors to content.json automatically).`,
          path: ['schemaVersion'],
        });
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Drop "at least one X is required" Zod errors from in-memory validation.
 *
 * These are completeness checks the CLI authoring flow legitimately violates
 * between a `add-block <container>` call and the first `add-step` /
 * `add-choice` that fills it in. The standalone `validate` command (which
 * calls `validatePackage(dir)` rather than this in-memory variant) still
 * surfaces these so a published guide cannot ship an empty container.
 */
// Suffix-list rather than exact-match Set because `validateGuide` prepends a
// JSON path to each Zod issue message (`blocks[0].steps: <message>`). Direct
// schema issues are bare strings; both shapes need to match the filter.
const EMPTY_CONTAINER_COMPLETENESS_SUFFIXES: readonly string[] = [
  EMPTY_STEPS_MESSAGE,
  EMPTY_CHOICES_MESSAGE,
  EMPTY_SCREENS_MESSAGE,
  EMPTY_CONDITIONS_MESSAGE,
];

export function isEmptyContainerCompletenessMessage(message: string): boolean {
  if (EMPTY_CONTAINER_COMPLETENESS_SUFFIXES.some((suffix) => message.endsWith(suffix))) {
    return true;
  }
  // The "no correct choice yet" message has a stable prefix and a trailing
  // hint; the path-prefixed variant from validateGuide also contains it. Use
  // includes() to match both shapes.
  if (message.includes(QUIZ_NO_CORRECT_CHOICE_PREFIX)) {
    return true;
  }
  return false;
}

/**
 * Map a Zod / validateGuide message to a stable `PackageIOErrorCode`.
 *
 * Most schema violations stay under the generic `SCHEMA_VALIDATION` bucket so
 * MCP consumers don't have to enumerate every edge case. A few semantic
 * checks get their own codes because the design contract names them: the
 * quiz correct-count refinement and the unknown-requirement refinement both
 * exist so agents can branch on a stable string instead of grepping the
 * message.
 */
export function classifyContentIssue(message: string): PackageIOErrorCode {
  // includes() rather than startsWith() because validateGuide prepends a JSON
  // path to each issue (`blocks[0].choices: Quiz has no...`). Both shapes
  // route to QUIZ_CORRECT_COUNT.
  if (message.includes(QUIZ_MULTI_CORRECT_PREFIX) || message.includes(QUIZ_NO_CORRECT_CHOICE_PREFIX)) {
    return 'QUIZ_CORRECT_COUNT';
  }
  if (message.includes('Unknown requirement ')) {
    return 'UNKNOWN_REQUIREMENT';
  }
  return 'SCHEMA_VALIDATION';
}
