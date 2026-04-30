/**
 * Disk I/O for package directories.
 *
 * `readPackage` parses `content.json` (and optionally `manifest.json`)
 * through their Zod schemas, applies defaults, runs the auto-id migration
 * for legacy content lacking ids, and returns a fully-populated
 * `PackageState`. `writePackage` is the symmetric writer with stable
 * formatting (2-space indent, trailing newline, suppressed empty arrays).
 *
 * The schema-defaulted-vs-authored tracking on `manifest.schemaVersion` is
 * load-bearing for the cross-file drift check downstream — see the
 * `manifestSchemaVersionAuthored` field on `PackageState`.
 */

import * as fs from 'fs';
import * as path from 'path';

import { ContentJsonSchema, ManifestJsonSchema } from '../../../types/package.schema';
import type { ContentJson, ManifestJson } from '../../../types/package.types';
import { assignMissingIds } from './auto-id';
import { PackageIOError, type PackageIOIssue } from './errors';
import { isEmptyContainerCompletenessMessage } from './state-validation';

export interface PackageState {
  content: ContentJson;
  /**
   * Manifest is optional on disk — a package with only `content.json` is a
   * standalone guide. CLI authoring commands always populate one because
   * `create` writes both files, but read paths must tolerate its absence.
   */
  manifest: ManifestJson | undefined;
  /**
   * Whether `manifest.json` on disk explicitly set `schemaVersion`. Zod fills
   * in a default at parse time, so once read we cannot tell the difference
   * from `manifest.schemaVersion` alone. Callers that compare manifest and
   * content schemaVersions (the drift check) must skip the comparison when
   * this flag is false — otherwise legacy packages with a manifest that
   * never set schemaVersion (and therefore inherits today's default) would
   * spuriously fail against an older content.json.
   *
   * Optional because write-only callers (`writePackage`) and synthetic
   * states constructed in tests don't need to track it; the default at the
   * validator boundary is "authored" (strict).
   */
  manifestSchemaVersionAuthored?: boolean;
  /**
   * Number of `<type>-<n>` ids minted on read by `assignMissingIds` because
   * legacy / bundled / hand-authored content lacked them. Surfaced in command
   * success output so authors aren't surprised to see id additions in the
   * write diff alongside their actual change.
   *
   * Optional because synthetic states constructed in tests don't go through
   * `readPackage` and don't need to track it.
   */
  idsAssignedOnRead?: number;
}

/**
 * Read content.json (and optionally manifest.json) from a package directory
 * and parse them through their Zod schemas. Throws `PackageIOError` with a
 * structured code on every failure mode the CLI cares about.
 *
 * Schema parsing here applies defaults — the returned manifest, for
 * instance, has `repository: 'interactive-tutorials'` even if the file
 * omitted it. That's intentional: subsequent `editBlock` / `setManifest`
 * calls operate on a fully-defaulted artifact, and `writePackage` then
 * persists those defaults explicitly so the on-disk state reflects what was
 * validated.
 */
export function readPackage(packageDir: string): PackageState {
  if (!fs.existsSync(packageDir)) {
    throw new PackageIOError({
      code: 'NOT_FOUND',
      message: `Package directory not found: ${packageDir}`,
    });
  }

  const contentPath = path.join(packageDir, 'content.json');
  if (!fs.existsSync(contentPath)) {
    throw new PackageIOError({
      code: 'CONTENT_MISSING',
      message: `content.json not found in ${packageDir}`,
    });
  }

  // Casts: Zod's inferred type for the recursive `blocks` array is
  // `unknown[]` (z.lazy throws away static type information); the runtime
  // shape is correct, the same pattern is used in validate-package.ts.
  const content = parseFileWithSchema(contentPath, ContentJsonSchema, 'content.json') as ContentJson;

  const manifestPath = path.join(packageDir, 'manifest.json');
  let manifest: ManifestJson | undefined;
  let manifestSchemaVersionAuthored = false;
  if (fs.existsSync(manifestPath)) {
    // Detect whether manifest.json authored schemaVersion explicitly before
    // Zod applies its default; the drift check downstream depends on this.
    const rawManifest = readRawJson(manifestPath, 'manifest.json');
    manifestSchemaVersionAuthored =
      typeof rawManifest === 'object' &&
      rawManifest !== null &&
      typeof (rawManifest as Record<string, unknown>).schemaVersion === 'string';
    manifest = parseFileWithSchema(manifestPath, ManifestJsonSchema, 'manifest.json') as ManifestJson;
  }

  // Auto-id migration: mint stable `<type>-<n>` ids for any block lacking
  // one. This is what lets the rest of the CLI address bundled / legacy /
  // hand-authored content with `move-block`, `remove-block`, etc. The walk
  // order is deterministic so a read-only inspect and a subsequent mutation
  // see the same ids; mutateAndValidate persists them on the next write.
  const { assigned } = assignMissingIds(content);

  return { content, manifest, manifestSchemaVersionAuthored, idsAssignedOnRead: assigned };
}

function readRawJson(filePath: string, label: string): unknown {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new PackageIOError({
      code: 'INVALID_JSON',
      message: `Cannot read ${label}: ${detail}`,
    });
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new PackageIOError({
      code: 'INVALID_JSON',
      message: `${label} is not valid JSON: ${detail}`,
    });
  }
}

/**
 * Write `content.json` and (if present) `manifest.json` to `packageDir`,
 * creating the directory if it doesn't exist yet.
 *
 * Files are written with two-space indentation and a trailing newline so
 * diffs are stable across CLI invocations. The trailing newline matches the
 * convention used by the existing bundled-interactives content — diff hygiene
 * matters because guide edits often go through PR review.
 */
export function writePackage(packageDir: string, state: PackageState): void {
  fs.mkdirSync(packageDir, { recursive: true });

  try {
    fs.writeFileSync(path.join(packageDir, 'content.json'), serializeJson(state.content));
    if (state.manifest) {
      // Don't persist a Zod-defaulted `schemaVersion` back to disk — round
      // tripping it would turn a never-authored field into an "authored"
      // value on the next read, retroactively activating the drift check
      // against content.json's explicit version. The state is the source of
      // truth for whether the field was authored on entry; we honor that.
      const compacted = compactManifest(state.manifest, {
        stripSchemaVersion: state.manifestSchemaVersionAuthored === false,
      });
      fs.writeFileSync(path.join(packageDir, 'manifest.json'), serializeJson(compacted));
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new PackageIOError({
      code: 'WRITE_FAILED',
      message: `Failed to write package to ${packageDir}: ${detail}`,
    });
  }
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Strip empty-array fields from the manifest so freshly-created packages don't
 * carry visual noise (e.g., `"depends": []`, `"recommends": []`) that the
 * hand-authored bundled guides also omit. Schema parsing keeps these as the
 * default for ergonomics in code; we only suppress them at serialization time.
 */
const SUPPRESSIBLE_EMPTY_ARRAY_KEYS = [
  'depends',
  'recommends',
  'suggests',
  'provides',
  'conflicts',
  'replaces',
] as const;
function compactManifest(manifest: ManifestJson, options: { stripSchemaVersion?: boolean } = {}): ManifestJson {
  const out: Record<string, unknown> = { ...manifest };
  for (const key of SUPPRESSIBLE_EMPTY_ARRAY_KEYS) {
    const value = out[key];
    if (Array.isArray(value) && value.length === 0) {
      delete out[key];
    }
  }
  if (options.stripSchemaVersion) {
    delete out.schemaVersion;
  }
  return out as unknown as ManifestJson;
}

// `readJsonFile` from `src/validation/package-io.ts` returns a result object;
// here we want to throw because the CLI's mutate flow has no useful continuation
// path past a malformed file.
function parseFileWithSchema<T>(
  filePath: string,
  schema: {
    safeParse: (
      input: unknown
    ) =>
      | { success: true; data: T }
      | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } };
  },
  label: string
): T {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new PackageIOError({
      code: 'INVALID_JSON',
      message: `Cannot read ${label}: ${detail}`,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new PackageIOError({
      code: 'INVALID_JSON',
      message: `${label} is not valid JSON: ${detail}`,
    });
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    // Filter completeness issues — the authoring flow legitimately reads
    // packages mid-construction with empty step / choice arrays. If any
    // genuine schema issue remains after filtering, fail loud.
    const realIssues = result.error.issues.filter((i) => !isEmptyContainerCompletenessMessage(i.message));
    if (realIssues.length === 0) {
      // The strict-schema parse failed only on empty containers; the file
      // is structurally valid for authoring purposes. Return the raw
      // parsed JSON cast to T — the CLI mutators will populate the empty
      // arrays as the agent fills them in.
      //
      // Safety note: this skips Zod's default-application. That's only
      // reached for `ContentJsonSchema` in practice (manifest.json has no
      // empty-container completeness checks), and `ContentJsonSchema`
      // declares no `.default()` fields — `schemaVersion` is `optional()`
      // and downstream consumers (`validatePackageState` drift check,
      // `inspect`'s schemaVersion display) all guard against undefined.
      // If a future change adds a `.default()` to `ContentJsonSchema`,
      // populate it manually here before returning.
      return parsed as T;
    }
    const issues: PackageIOIssue[] = realIssues.map((i) => ({
      code: 'SCHEMA_VALIDATION',
      message: `${label}: ${i.message}`,
      path: i.path.map(String),
    }));
    throw new PackageIOError(
      { code: 'SCHEMA_VALIDATION', message: `${label} failed schema validation`, path: [label] },
      issues
    );
  }

  return result.data;
}
