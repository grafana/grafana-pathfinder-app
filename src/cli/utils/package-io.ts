/**
 * Package read/mutate/validate/write core for the authoring CLI.
 *
 * The CLI's defining property — "schema-illegal output is impossible" —
 * lives here. Every authoring command composes:
 *
 *   1. readPackage(dir)            → in-memory artifact
 *   2. apply mutator (append, edit, remove)
 *   3. validatePackageState        → Zod + cross-file ID + condition checks
 *   4. writePackage(dir, …)        → only if validation passes
 *
 * The full sequence is exposed as `mutateAndValidate(dir, mutator)`. The
 * helpers below (`appendBlock`, `editBlock`, …) are the mutator primitives
 * that commands stack on top of it.
 *
 * Asset-existence and the full disk-aware diagnostics live in
 * `src/validation/validate-package.ts` — that's still the canonical "lint
 * this package on disk" entry point. This module is intentionally narrower:
 * it only concerns itself with state legality, so a 20-block authoring
 * session pays one Zod re-parse per call instead of a full disk re-walk.
 */

import * as fs from 'fs';
import * as path from 'path';

import { CURRENT_SCHEMA_VERSION } from '../../types/json-guide.schema';
import type {
  JsonAssistantBlock,
  JsonBlock,
  JsonConditionalBlock,
  JsonGuidedBlock,
  JsonMultistepBlock,
  JsonQuizBlock,
  JsonQuizChoice,
  JsonSectionBlock,
  JsonStep,
} from '../../types/json-guide.types';
import { ContentJsonSchema, ManifestJsonSchema } from '../../types/package.schema';
import type { ContentJson, ManifestJson } from '../../types/package.types';
import { validateGuide } from '../../validation/validate-guide';
import { CONTAINER_BLOCK_TYPES, isContainerBlockType } from './block-registry';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Stable error codes returned by the IO layer. Commands map these to
 * structured `--format json` responses; the strings are part of the public
 * MCP-shell-out contract once P3 lands, so don't rename casually.
 */
export type PackageIOErrorCode =
  | 'NOT_FOUND'
  | 'CONTENT_MISSING'
  | 'INVALID_JSON'
  | 'SCHEMA_VALIDATION'
  | 'ID_MISMATCH'
  | 'SCHEMA_VERSION_MISMATCH'
  | 'BLOCK_NOT_FOUND'
  | 'CONTAINER_NOT_FOUND'
  | 'PARENT_NOT_CONTAINER'
  | 'WRONG_PARENT_KIND'
  | 'BRANCH_REQUIRED'
  | 'DUPLICATE_ID'
  | 'CONTAINER_REQUIRES_ID'
  | 'CONTAINER_HAS_CHILDREN'
  | 'IF_ABSENT_CONFLICT'
  | 'INVALID_OPTIONS'
  | 'WRITE_FAILED';

export interface PackageIOIssue {
  code: PackageIOErrorCode;
  message: string;
  path?: string[];
}

export class PackageIOError extends Error {
  readonly code: PackageIOErrorCode;
  readonly issues: PackageIOIssue[];

  constructor(issue: PackageIOIssue, issues?: PackageIOIssue[]) {
    super(issue.message);
    this.name = 'PackageIOError';
    this.code = issue.code;
    this.issues = issues ?? [issue];
  }
}

// ---------------------------------------------------------------------------
// Disk I/O
// ---------------------------------------------------------------------------

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
  assignMissingIds(content);

  return { content, manifest, manifestSchemaVersionAuthored };
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

// ---------------------------------------------------------------------------
// State validation (in-memory)
// ---------------------------------------------------------------------------

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
        code: 'SCHEMA_VALIDATION',
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
        code: 'SCHEMA_VALIDATION',
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
function isEmptyContainerCompletenessMessage(message: string): boolean {
  return /At least one (step|choice|screen|condition) is required/.test(message);
}

// ---------------------------------------------------------------------------
// Tree traversal
// ---------------------------------------------------------------------------

/**
 * Container blocks store their children under different keys. This map tells
 * the traversal code which children-array(s) to descend into for each block
 * type. Steps and choices are intentionally NOT here because they aren't
 * blocks — they're addressed via `appendStep` / `appendChoice`, not the
 * generic block walker.
 */
const CONTAINER_CHILD_KEYS: Record<string, string[]> = {
  section: ['blocks'],
  assistant: ['blocks'],
  conditional: ['whenTrue', 'whenFalse'],
};

/**
 * Walk every block in `content` (depth-first, including children of
 * containers) and yield each one along with the `JsonBlock[]` array that
 * holds it. Yielding the parent array is what lets `removeBlock` splice the
 * matched block out without re-walking from the root.
 */
export function* walkBlocks(content: ContentJson): Generator<{ block: JsonBlock; parent: JsonBlock[]; index: number }> {
  yield* walkArray(content.blocks);
}

function* walkArray(blocks: JsonBlock[]): Generator<{ block: JsonBlock; parent: JsonBlock[]; index: number }> {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (!block) {
      // `noUncheckedIndexedAccess` widens blocks[i] to `JsonBlock | undefined`;
      // sparse arrays don't occur in practice, but the guard is cheap.
      continue;
    }
    yield { block, parent: blocks, index: i };
    const childKeys = CONTAINER_CHILD_KEYS[block.type];
    if (!childKeys) {
      continue;
    }
    for (const key of childKeys) {
      const children = (block as unknown as Record<string, unknown>)[key];
      if (Array.isArray(children)) {
        yield* walkArray(children as JsonBlock[]);
      }
    }
  }
}

/**
 * Find the first block whose `id` matches, anywhere in the tree.
 *
 * Both leaf and container blocks may carry an `id` since P1.1; this getter
 * is the single lookup `edit-block`, `remove-block`, `add-block --parent`,
 * `add-step --parent`, and `add-choice --parent` go through.
 */
export function findBlockById(content: ContentJson, id: string): JsonBlock | null {
  for (const { block } of walkBlocks(content)) {
    if (typeof block.id === 'string' && block.id === id) {
      return block;
    }
  }
  return null;
}

/**
 * Find a container block by id. Same as `findBlockById` but rejects matches
 * on leaf blocks with a structured error so command-side error messages can
 * differentiate "not a container" from "id not found at all".
 */
export function findContainerById(content: ContentJson, id: string): JsonBlock {
  const block = findBlockById(content, id);
  if (!block) {
    throw new PackageIOError({
      code: 'CONTAINER_NOT_FOUND',
      message: `Container "${id}" not found in package`,
    });
  }
  if (!isContainerBlockType(block.type as never)) {
    throw new PackageIOError({
      code: 'PARENT_NOT_CONTAINER',
      message: `Block "${id}" is a ${block.type}, not a container`,
    });
  }
  return block;
}

/**
 * Collect every `id` declared anywhere in the content tree. Used by the
 * mutators below for uniqueness checks before insert and by `--if-absent` to
 * detect the "exists already" branch.
 */
export function collectAllIds(content: ContentJson): Set<string> {
  const ids = new Set<string>();
  for (const { block } of walkBlocks(content)) {
    if (typeof block.id === 'string' && block.id.length > 0) {
      ids.add(block.id);
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Auto-id assignment
// ---------------------------------------------------------------------------

/**
 * Generate the next stable `<type>-<n>` id for a leaf block being appended.
 *
 * Counter scope is per-type and per-guide — the next markdown gets
 * `markdown-<n+1>` where `n` is the current largest matching counter. We scan
 * existing ids rather than carrying a counter alongside the artifact because
 * the artifact is the source of truth (boundary decision 4 of the AI
 * authoring design): no separate state to lose across CLI sessions.
 */
export function nextAutoBlockId(content: ContentJson, blockType: string): string {
  const prefix = `${blockType}-`;
  let max = 0;
  for (const id of collectAllIds(content)) {
    if (!id.startsWith(prefix)) {
      continue;
    }
    const tail = id.slice(prefix.length);
    if (!/^\d+$/.test(tail)) {
      continue;
    }
    const n = Number(tail);
    if (Number.isFinite(n) && n > max) {
      max = n;
    }
  }
  return `${prefix}${max + 1}`;
}

/**
 * Mint stable `<type>-<n>` ids for any block in `content` that lacks one.
 *
 * This is the migration step that makes the rest of the CLI's id-only
 * addressing model work on legacy / hand-authored / bundled content. Without
 * it, structural primitives like `move-block` and `remove-block` cannot
 * target blocks that came from outside the authoring CLI.
 *
 * Walk order is deterministic (depth-first, root → containers → children) so
 * read-only commands like `inspect` mint the same ids that mutating commands
 * subsequently persist. Counters per type extend whatever `<type>-<n>` ids
 * already exist, so manually-authored ids are never clobbered.
 */
export function assignMissingIds(content: ContentJson): { assigned: number } {
  const counters: Record<string, number> = {};
  for (const id of collectAllIds(content)) {
    const match = /^([a-z]+)-(\d+)$/.exec(id);
    if (!match) {
      continue;
    }
    const type = match[1];
    const n = Number(match[2]);
    if (!type || !Number.isFinite(n)) {
      continue;
    }
    if (n > (counters[type] ?? 0)) {
      counters[type] = n;
    }
  }
  let assigned = 0;
  for (const { block } of walkBlocks(content)) {
    if (typeof block.id === 'string' && block.id.length > 0) {
      continue;
    }
    counters[block.type] = (counters[block.type] ?? 0) + 1;
    block.id = `${block.type}-${counters[block.type]}`;
    assigned++;
  }
  return { assigned };
}

// ---------------------------------------------------------------------------
// Mutators
// ---------------------------------------------------------------------------

export interface AppendBlockOptions {
  parentId?: string;
  /** Required when parent is a `conditional`. */
  branch?: 'true' | 'false';
  /**
   * Idempotent create: if a container block with this id already exists and
   * its current scalar fields match the candidate's, return success without
   * mutating. A mismatch raises `IF_ABSENT_CONFLICT`. Has no effect on leaf
   * blocks because their auto-assigned ids are non-deterministic across
   * retries — see [docs/design/AGENT-AUTHORING.md#idempotent-retries-with---if-absent].
   */
  ifAbsent?: boolean;
  /**
   * Position-aware insertion. At most one of `before`/`after`/`position` may
   * be set; supplying more than one is an `INVALID_OPTIONS` error.
   * - `before`/`after`: sibling-id reference within the resolved parent's
   *   child array. If the named id exists elsewhere in the tree but not in
   *   that array, the error names the actual parent.
   * - `position`: 0-based index in the parent's child array, where 0 means
   *   "first" and `array.length` means "append" (same as no option).
   * Without any of these, the block is appended (current behavior).
   */
  before?: string;
  after?: string;
  position?: number;
}

export interface AppendBlockResult {
  /** True when the block was actually appended; false when --if-absent matched. */
  appended: boolean;
  /** The id of the resulting block (auto-assigned for leaves without --id). */
  id: string;
  /** JSONPath-ish position for diagnostics: `blocks[3]`, `blocks[1].whenTrue[0]`. */
  position: string;
}

/**
 * Append a block to either the top-level array or a container's children.
 *
 * Container blocks (section, conditional, assistant, multistep, guided,
 * quiz) MUST have an author-supplied `id` already set; the design forbids
 * auto-assigning ids to containers because they have to be addressable in
 * subsequent calls. Leaf blocks without an `id` get one of the form
 * `<type>-<n>` assigned in this call.
 */
export function appendBlock(
  content: ContentJson,
  block: JsonBlock,
  options: AppendBlockOptions = {}
): AppendBlockResult {
  const isContainer = isContainerBlockType(block.type as never);

  if (isContainer && !block.id) {
    throw new PackageIOError({
      code: 'CONTAINER_REQUIRES_ID',
      message: `Block type "${block.type}" requires --id (container blocks must be addressable)`,
    });
  }

  if (!block.id && !isContainer) {
    block.id = nextAutoBlockId(content, block.type);
  }

  // --if-absent path: short-circuit if a container with the same id already
  // exists. Compares scalar fields; mismatches surface as a single structured
  // error rather than silently overwriting the existing block.
  if (options.ifAbsent && block.id) {
    const existing = findBlockById(content, block.id);
    if (existing) {
      const conflict = scalarFieldsConflict(existing, block);
      if (conflict) {
        throw new PackageIOError({
          code: 'IF_ABSENT_CONFLICT',
          message: `Block "${block.id}" already exists with different ${conflict.field} (existing: ${conflict.existing}, requested: ${conflict.requested})`,
        });
      }
      const existingPosition = positionOf(content, existing);
      return { appended: false, id: block.id, position: existingPosition ?? '<unknown>' };
    }
  }

  // Uniqueness check: ids are unique guide-wide.
  if (block.id) {
    const existingIds = collectAllIds(content);
    if (existingIds.has(block.id)) {
      throw new PackageIOError({
        code: 'DUPLICATE_ID',
        message: `Block id "${block.id}" already exists in this package`,
      });
    }
  }

  // Resolve target array.
  const target = resolveAppendTarget(content, options);
  const insertIndex = resolveInsertIndex(content, target, options);
  target.array.splice(insertIndex, 0, block);

  return {
    appended: true,
    id: block.id ?? '',
    position: `${target.path}[${insertIndex}]`,
  };
}

/**
 * Compute the splice index for an insertion. Default is "append to end".
 * `before`/`after`/`position` are mutually exclusive; at most one may be set.
 *
 * `before`/`after` reference a sibling id within the *target parent's* child
 * array. If the id exists elsewhere in the tree, the error message names the
 * actual parent so authors can correct their --parent flag.
 */
function resolveInsertIndex(content: ContentJson, target: AppendTarget, options: AppendBlockOptions): number {
  const positionalCount =
    (options.before !== undefined ? 1 : 0) +
    (options.after !== undefined ? 1 : 0) +
    (options.position !== undefined ? 1 : 0);
  if (positionalCount > 1) {
    throw new PackageIOError({
      code: 'INVALID_OPTIONS',
      message: '--before, --after, and --position are mutually exclusive; pass at most one.',
    });
  }

  if (options.position !== undefined) {
    const pos = options.position;
    if (!Number.isInteger(pos) || pos < 0 || pos > target.array.length) {
      throw new PackageIOError({
        code: 'INVALID_OPTIONS',
        message: `--position must be an integer in [0, ${target.array.length}] for ${target.path}; got ${pos}`,
      });
    }
    return pos;
  }

  if (options.before !== undefined) {
    return resolveSiblingIndex(content, target, options.before, 'before');
  }
  if (options.after !== undefined) {
    return resolveSiblingIndex(content, target, options.after, 'after') + 1;
  }
  return target.array.length;
}

function resolveSiblingIndex(
  content: ContentJson,
  target: AppendTarget,
  siblingId: string,
  mode: 'before' | 'after'
): number {
  const idx = target.array.findIndex((b) => typeof b.id === 'string' && b.id === siblingId);
  if (idx >= 0) {
    return idx;
  }
  // The sibling id doesn't live in our target array — see if it exists
  // elsewhere so we can give a helpful "wrong parent" message.
  const elsewhere = findBlockById(content, siblingId);
  if (elsewhere) {
    throw new PackageIOError({
      code: 'INVALID_OPTIONS',
      message: `--${mode} "${siblingId}" is not a sibling in ${target.path}; the block exists elsewhere in the tree. Adjust --parent / --branch to target its actual parent first.`,
    });
  }
  throw new PackageIOError({
    code: 'BLOCK_NOT_FOUND',
    message: `--${mode} "${siblingId}" not found in package`,
  });
}

interface AppendTarget {
  array: JsonBlock[];
  path: string;
}

function resolveAppendTarget(content: ContentJson, options: AppendBlockOptions): AppendTarget {
  if (!options.parentId) {
    return { array: content.blocks, path: 'blocks' };
  }

  const parent = findBlockById(content, options.parentId);
  if (!parent) {
    throw new PackageIOError({
      code: 'CONTAINER_NOT_FOUND',
      message: `Parent "${options.parentId}" not found`,
    });
  }

  if (parent.type === 'conditional') {
    if (options.branch !== 'true' && options.branch !== 'false') {
      throw new PackageIOError({
        code: 'BRANCH_REQUIRED',
        message: `Parent "${options.parentId}" is a conditional block — specify --branch true or --branch false`,
      });
    }
    const conditional = parent as JsonConditionalBlock;
    const arr = options.branch === 'true' ? conditional.whenTrue : conditional.whenFalse;
    const branchKey = options.branch === 'true' ? 'whenTrue' : 'whenFalse';
    return { array: arr, path: pathToBlock(content, parent, `${branchKey}`) };
  }

  if (parent.type === 'section' || parent.type === 'assistant') {
    const container = parent as JsonSectionBlock | JsonAssistantBlock;
    return { array: container.blocks, path: pathToBlock(content, parent, 'blocks') };
  }

  // multistep / guided / quiz are containers but NOT block-containers — they
  // hold steps or choices, not nested blocks. Reject with a specific code so
  // the command can suggest add-step / add-choice instead.
  throw new PackageIOError({
    code: 'WRONG_PARENT_KIND',
    message: `Parent "${options.parentId}" is a ${parent.type} — use add-${parent.type === 'quiz' ? 'choice' : 'step'} instead of add-block`,
  });
}

/**
 * Append a step to a multistep or guided block.
 */
export function appendStep(content: ContentJson, step: JsonStep, parentId: string): { position: string } {
  const parent = findBlockById(content, parentId);
  if (!parent) {
    throw new PackageIOError({
      code: 'CONTAINER_NOT_FOUND',
      message: `Parent "${parentId}" not found`,
    });
  }
  if (parent.type !== 'multistep' && parent.type !== 'guided') {
    throw new PackageIOError({
      code: 'WRONG_PARENT_KIND',
      message: `Parent "${parentId}" is a ${parent.type} — steps can only be added to multistep or guided blocks`,
    });
  }
  const block = parent as JsonMultistepBlock | JsonGuidedBlock;
  block.steps.push(step);
  return {
    position: `${pathToBlock(content, parent, 'steps')}[${block.steps.length - 1}]`,
  };
}

/**
 * Append a choice to a quiz block.
 */
export function appendChoice(content: ContentJson, choice: JsonQuizChoice, parentId: string): { position: string } {
  const parent = findBlockById(content, parentId);
  if (!parent) {
    throw new PackageIOError({
      code: 'CONTAINER_NOT_FOUND',
      message: `Parent "${parentId}" not found`,
    });
  }
  if (parent.type !== 'quiz') {
    throw new PackageIOError({
      code: 'WRONG_PARENT_KIND',
      message: `Parent "${parentId}" is a ${parent.type} — choices can only be added to quiz blocks`,
    });
  }

  const quiz = parent as JsonQuizBlock;
  if (quiz.choices.some((c) => c.id === choice.id)) {
    throw new PackageIOError({
      code: 'DUPLICATE_ID',
      message: `Choice id "${choice.id}" already exists in quiz "${parentId}"`,
    });
  }
  quiz.choices.push(choice);
  return {
    position: `${pathToBlock(content, parent, 'choices')}[${quiz.choices.length - 1}]`,
  };
}

export interface EditBlockOptions {
  /** Field set to merge in. Scalar fields replace; arrays replace; structural fields are forbidden. */
  patch: Record<string, unknown>;
}

/**
 * Apply a partial update to an existing block. Scalar and array fields use
 * replace-semantics (per the design); structural fields and the `type`
 * discriminator are rejected with a structured error.
 */
export function editBlock(content: ContentJson, id: string, options: EditBlockOptions): { changed: string[] } {
  const block = findBlockById(content, id);
  if (!block) {
    throw new PackageIOError({
      code: 'BLOCK_NOT_FOUND',
      message: `Block "${id}" not found`,
    });
  }

  // TODO(p5.8): block-level id rename is non-trivial — every conditional/quiz/
  // guided reference and every cross-block link in the package would need
  // updating. Until that walker exists, `id` stays in the forbid-list and
  // authors who guess wrong on a leaf id must remove + re-add. For package-id
  // renames there's a dedicated `rename-id` command.
  const forbidden = new Set(['type', 'blocks', 'whenTrue', 'whenFalse', 'steps', 'choices', 'id']);
  const changed: string[] = [];
  for (const [field, value] of Object.entries(options.patch)) {
    if (forbidden.has(field)) {
      // Specialized hint when the user tried to reorder via edit-block; point
      // them at the structural commands.
      if (field === 'position' || field === 'before' || field === 'after') {
        throw new PackageIOError({
          code: 'SCHEMA_VALIDATION',
          message: `edit-block does not change block position. Use: pathfinder-cli move-block <dir> ${id} --to-position <n>`,
        });
      }
      throw new PackageIOError({
        code: 'SCHEMA_VALIDATION',
        message: `Cannot edit field "${field}" via edit-block (structural or discriminator fields are managed by other commands)`,
      });
    }
    (block as unknown as Record<string, unknown>)[field] = value;
    changed.push(field);
  }
  return { changed };
}

export interface RemoveBlockOptions {
  /** Required to remove a non-empty container; otherwise the call fails with CONTAINER_HAS_CHILDREN. */
  cascade?: boolean;
  /**
   * Promote the removed block's children into the parent's child array at
   * the removed block's position, instead of cascading them out. Mutually
   * exclusive with `cascade`. Only works for "section"-style containers
   * whose children are themselves blocks; for multistep/guided/quiz the
   * children aren't blocks and there's no sensible parent to splice into,
   * so we reject with `INVALID_OPTIONS`.
   */
  orphanChildren?: boolean;
}

/**
 * Remove a block by id. Refuses to drop a non-empty container without
 * `--cascade` (or `--orphan-children`) so authors don't accidentally lose
 * work.
 */
export function removeBlock(
  content: ContentJson,
  id: string,
  options: RemoveBlockOptions = {}
): { removed: string; childrenRemoved: number; childrenOrphaned: number } {
  if (options.cascade && options.orphanChildren) {
    throw new PackageIOError({
      code: 'INVALID_OPTIONS',
      message: '--cascade and --orphan-children are mutually exclusive; pass at most one.',
    });
  }

  for (const { block, parent, index } of walkBlocks(content)) {
    if (block.id !== id) {
      continue;
    }

    const childCount = countChildren(block);

    if (childCount > 0 && options.orphanChildren) {
      // Promote children into the parent array. Only "block-container" types
      // qualify — multistep/guided/quiz hold steps/choices, not blocks, so
      // promoting them into a JsonBlock[] would corrupt the schema.
      if (block.type !== 'section' && block.type !== 'assistant' && block.type !== 'conditional') {
        throw new PackageIOError({
          code: 'INVALID_OPTIONS',
          message: `--orphan-children only works on section, assistant, or conditional blocks (got "${block.type}"). Use --cascade to remove it and its children.`,
        });
      }
      const children = collectChildBlocks(block);
      parent.splice(index, 1, ...children);
      return { removed: block.type, childrenRemoved: 0, childrenOrphaned: children.length };
    }

    if (childCount > 0 && !options.cascade) {
      throw new PackageIOError({
        code: 'CONTAINER_HAS_CHILDREN',
        message: `Block "${id}" has ${childCount} child(ren); pass --cascade to remove it and its children, or --orphan-children to promote them to the parent.`,
      });
    }

    parent.splice(index, 1);
    return { removed: block.type, childrenRemoved: childCount, childrenOrphaned: 0 };
  }

  throw new PackageIOError({
    code: 'BLOCK_NOT_FOUND',
    message: `Block "${id}" not found`,
  });
}

/**
 * Gather all child blocks of a container into a flat array, in declaration
 * order. For conditional blocks, whenTrue children precede whenFalse.
 */
function collectChildBlocks(block: JsonBlock): JsonBlock[] {
  const childKeys = CONTAINER_CHILD_KEYS[block.type];
  if (!childKeys) {
    return [];
  }
  const out: JsonBlock[] = [];
  for (const key of childKeys) {
    const children = (block as unknown as Record<string, unknown>)[key];
    if (Array.isArray(children)) {
      for (const child of children) {
        out.push(child as JsonBlock);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Move
// ---------------------------------------------------------------------------

export interface MoveBlockOptions {
  /** Move so the block ends up immediately before this sibling. */
  before?: string;
  /** Move so the block ends up immediately after this sibling. */
  after?: string;
  /** Move to this 0-based index. Position is in `into`'s child array when reparenting; otherwise in the current parent. */
  toPosition?: number;
  /** Reparent into this container id (section, assistant, or conditional). */
  into?: string;
  /** Required when `into` targets a conditional block: which branch receives the moved block. */
  branch?: 'true' | 'false';
}

export interface MoveBlockResult {
  from: number;
  to: number;
  /** True when the block changed parents (i.e. `into` was set and the resolved target differs from the source). */
  reparented: boolean;
  /** Id of the destination container when reparenting; undefined for in-place moves. */
  toContainer?: string;
}

/**
 * Move a block. Without `into`, the block stays in its current parent and at
 * least one of `before`/`after`/`toPosition` is required. With `into`, the
 * block is reparented; positional flags are optional (default: append).
 */
export function moveBlock(content: ContentJson, id: string, options: MoveBlockOptions): MoveBlockResult {
  const positionalCount =
    (options.before !== undefined ? 1 : 0) +
    (options.after !== undefined ? 1 : 0) +
    (options.toPosition !== undefined ? 1 : 0);

  if (positionalCount === 0 && options.into === undefined) {
    throw new PackageIOError({
      code: 'INVALID_OPTIONS',
      message: 'move-block requires --into <containerId>, or one of --before, --after, --position.',
    });
  }
  if (positionalCount > 1) {
    throw new PackageIOError({
      code: 'INVALID_OPTIONS',
      message: '--before, --after, and --position are mutually exclusive; pass at most one.',
    });
  }

  // Locate the source block first so error messages can fire before any
  // splice happens.
  let source: { block: JsonBlock; parent: JsonBlock[]; index: number } | undefined;
  for (const hit of walkBlocks(content)) {
    if (hit.block.id === id) {
      source = hit;
      break;
    }
  }
  if (!source) {
    throw new PackageIOError({
      code: 'BLOCK_NOT_FOUND',
      message: `Block "${id}" not found`,
    });
  }

  if (options.into !== undefined) {
    return moveBlockInto(content, source, options);
  }

  return moveBlockWithinParent(content, source, options);
}

function moveBlockWithinParent(
  content: ContentJson,
  source: { block: JsonBlock; parent: JsonBlock[]; index: number },
  options: MoveBlockOptions
): MoveBlockResult {
  const { parent, index: fromIndex } = source;
  let toIndex: number;
  if (options.toPosition !== undefined) {
    const pos = options.toPosition;
    if (!Number.isInteger(pos) || pos < 0 || pos >= parent.length) {
      throw new PackageIOError({
        code: 'INVALID_OPTIONS',
        message: `--position must be an integer in [0, ${parent.length - 1}] within the block's parent; got ${pos}. To reparent into another container, pass --into <containerId>.`,
      });
    }
    toIndex = pos;
  } else if (options.before !== undefined) {
    toIndex = findSiblingIndexOrThrow(content, parent, options.before, 'before');
  } else {
    toIndex = findSiblingIndexOrThrow(content, parent, options.after!, 'after') + 1;
  }

  if (toIndex === fromIndex || toIndex === fromIndex + 1) {
    return { from: fromIndex, to: fromIndex, reparented: false };
  }

  const [moved] = parent.splice(fromIndex, 1) as [JsonBlock];
  const adjusted = toIndex > fromIndex ? toIndex - 1 : toIndex;
  parent.splice(adjusted, 0, moved);
  return { from: fromIndex, to: adjusted, reparented: false };
}

function moveBlockInto(
  content: ContentJson,
  source: { block: JsonBlock; parent: JsonBlock[]; index: number },
  options: MoveBlockOptions
): MoveBlockResult {
  const containerId = options.into!;

  if (source.block.id === containerId) {
    throw new PackageIOError({
      code: 'INVALID_OPTIONS',
      message: `Cannot move block "${containerId}" into itself.`,
    });
  }

  const target = resolveAppendTarget(content, { parentId: containerId, branch: options.branch });

  // Reject moving a container into one of its own descendants — that would
  // create a cycle and orphan the entire subtree.
  if (isContainerBlockType(source.block.type as never) && containerHasDescendant(source.block, target.array)) {
    throw new PackageIOError({
      code: 'INVALID_OPTIONS',
      message: `Cannot move container "${source.block.id}" into one of its own descendants (would create a cycle).`,
    });
  }

  // Splice the source out first, then resolve the insert index in the target
  // array. Because the target array may be the same array as the source's
  // parent (when reparenting inside a sibling-of-self via id reference),
  // computing the index after the splice keeps the math simple.
  const [moved] = source.parent.splice(source.index, 1) as [JsonBlock];

  let toIndex: number;
  if (options.toPosition !== undefined) {
    const pos = options.toPosition;
    if (!Number.isInteger(pos) || pos < 0 || pos > target.array.length) {
      // Roll back the splice so on-disk state is unchanged on error.
      source.parent.splice(source.index, 0, moved);
      throw new PackageIOError({
        code: 'INVALID_OPTIONS',
        message: `--position must be an integer in [0, ${target.array.length}] within ${target.path}; got ${pos}`,
      });
    }
    toIndex = pos;
  } else if (options.before !== undefined) {
    try {
      toIndex = findSiblingIndexOrThrow(content, target.array, options.before, 'before');
    } catch (err) {
      source.parent.splice(source.index, 0, moved);
      throw err;
    }
  } else if (options.after !== undefined) {
    try {
      toIndex = findSiblingIndexOrThrow(content, target.array, options.after, 'after') + 1;
    } catch (err) {
      source.parent.splice(source.index, 0, moved);
      throw err;
    }
  } else {
    toIndex = target.array.length;
  }

  target.array.splice(toIndex, 0, moved);
  return { from: source.index, to: toIndex, reparented: true, toContainer: containerId };
}

/**
 * True if `targetArray` is `subject`'s own child array (any depth). Used by
 * `--into` to refuse cycle-creating moves.
 */
function containerHasDescendant(subject: JsonBlock, targetArray: JsonBlock[]): boolean {
  const childKeys = CONTAINER_CHILD_KEYS[subject.type];
  if (!childKeys) {
    return false;
  }
  for (const key of childKeys) {
    const children = (subject as unknown as Record<string, unknown>)[key];
    if (!Array.isArray(children)) {
      continue;
    }
    if (children === targetArray) {
      return true;
    }
    for (const child of children as JsonBlock[]) {
      if (containerHasDescendant(child, targetArray)) {
        return true;
      }
    }
  }
  return false;
}

function findSiblingIndexOrThrow(
  content: ContentJson,
  parentArr: JsonBlock[],
  siblingId: string,
  flagName: 'before' | 'after'
): number {
  const idx = parentArr.findIndex((b) => typeof b.id === 'string' && b.id === siblingId);
  if (idx >= 0) {
    return idx;
  }
  const elsewhere = findBlockById(content, siblingId);
  if (elsewhere) {
    throw new PackageIOError({
      code: 'INVALID_OPTIONS',
      message: `--${flagName} "${siblingId}" is in a different parent than the block you're moving. Cross-parent moves are not supported; use remove-block + add-block.`,
    });
  }
  throw new PackageIOError({
    code: 'BLOCK_NOT_FOUND',
    message: `--${flagName} "${siblingId}" not found in package`,
  });
}

function countChildren(block: JsonBlock): number {
  const childKeys = CONTAINER_CHILD_KEYS[block.type];
  if (childKeys) {
    let total = 0;
    for (const key of childKeys) {
      const children = (block as unknown as Record<string, unknown>)[key];
      if (Array.isArray(children)) {
        total += children.length;
      }
    }
    return total;
  }
  if (block.type === 'multistep' || block.type === 'guided') {
    return (block as JsonMultistepBlock | JsonGuidedBlock).steps.length;
  }
  if (block.type === 'quiz') {
    return (block as JsonQuizBlock).choices.length;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Compose: read → mutate → validate → write
// ---------------------------------------------------------------------------

export interface MutationContext extends PackageState {}
export type Mutator = (state: MutationContext) => void | Promise<void>;

export interface MutationResult {
  state: PackageState;
  validation: ValidationOutcome;
}

/**
 * The validate-on-write core. Reads the package, hands the parsed state to
 * `mutator` (which mutates in place), runs `validatePackageState`, and only
 * persists if validation passes.
 *
 * If validation fails the on-disk state is untouched and the validation
 * issues are returned for the caller to surface; the caller decides whether
 * to throw, render structured JSON, or print human-readable text.
 *
 * This is the single place the "schema-illegal output is impossible"
 * property is enforced for the CLI. Commands should not write packages by
 * any other path.
 */
export async function mutateAndValidate(packageDir: string, mutator: Mutator): Promise<MutationResult> {
  const state = readPackage(packageDir);
  await mutator(state);

  const validation = validatePackageState(state.content, state.manifest, {
    manifestSchemaVersionAuthored: state.manifestSchemaVersionAuthored,
  });
  if (validation.ok) {
    writePackage(packageDir, state);
  }
  return { state, validation };
}

// ---------------------------------------------------------------------------
// `create` helper
// ---------------------------------------------------------------------------

/**
 * Build a fresh `PackageState` for the `create` command. Stamped with
 * `CURRENT_SCHEMA_VERSION` on both files so the resulting package is tagged
 * with the CLI version that produced it.
 */
export function newPackageState(args: {
  id: string;
  title: string;
  type: 'guide' | 'path' | 'journey';
  description?: string;
}): PackageState {
  const content: ContentJson = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: args.id,
    title: args.title,
    blocks: [],
  };

  // We could pass through ManifestJsonObjectSchema.parse() to fill in the
  // defaults explicitly, but doing so on construction means the on-disk file
  // has every field rather than relying on schema defaults at read-time —
  // which is the more defensible long-term shape (round-trips deterministic).
  const manifest = ManifestJsonSchema.parse({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: args.id,
    type: args.type,
    description: args.description,
  }) as ManifestJson;

  // `create` writes schemaVersion explicitly, so a freshly-created package
  // is "authored" for the drift check.
  return { content, manifest, manifestSchemaVersionAuthored: true };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface ConflictDetail {
  field: string;
  existing: string;
  requested: string;
}

/**
 * Compare scalar fields between an existing block and a candidate for the
 * `--if-absent` idempotency check. Returns the first mismatching scalar
 * field or `null` when the candidate matches the existing block in every
 * scalar value the candidate provides.
 *
 * Structural fields (`blocks`, `whenTrue`, `whenFalse`, `steps`, `choices`)
 * are intentionally ignored — `--if-absent` is for the "create the container
 * if it isn't there" pattern; existing children are preserved by design.
 */
function scalarFieldsConflict(existing: JsonBlock, candidate: JsonBlock): ConflictDetail | null {
  const structural = new Set(['blocks', 'whenTrue', 'whenFalse', 'steps', 'choices']);
  const existingRecord = existing as unknown as Record<string, unknown>;
  const candidateRecord = candidate as unknown as Record<string, unknown>;

  if (existing.type !== candidate.type) {
    return { field: 'type', existing: existing.type, requested: candidate.type };
  }

  for (const [field, value] of Object.entries(candidateRecord)) {
    if (structural.has(field) || field === 'type') {
      continue;
    }
    if (value === undefined) {
      continue;
    }
    const existingValue = existingRecord[field];
    if (Array.isArray(value) && Array.isArray(existingValue)) {
      if (JSON.stringify(value) !== JSON.stringify(existingValue)) {
        return { field, existing: JSON.stringify(existingValue), requested: JSON.stringify(value) };
      }
      continue;
    }
    if (existingValue !== value) {
      return {
        field,
        existing: existingValue === undefined ? '<unset>' : String(existingValue),
        requested: String(value),
      };
    }
  }
  return null;
}

/**
 * Compute a JSONPath-ish string locating `target` inside `content`. Used for
 * diagnostic position fields in success output. Falls back to the bare key
 * if the block isn't found (which shouldn't happen — the caller has just
 * resolved the block via walkBlocks).
 */
function pathToBlock(content: ContentJson, target: JsonBlock, suffix: string): string {
  const path = positionOf(content, target);
  return path ? `${path}.${suffix}` : suffix;
}

function positionOf(content: ContentJson, target: JsonBlock): string | null {
  // Top-level scan. Recursion uses an inner helper to track the running path.
  const stack: Array<{ blocks: JsonBlock[]; prefix: string }> = [{ blocks: content.blocks, prefix: 'blocks' }];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) {
      break;
    }
    const { blocks, prefix } = frame;
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (!block) {
        continue;
      }
      const here = `${prefix}[${i}]`;
      if (block === target) {
        return here;
      }
      const childKeys = CONTAINER_CHILD_KEYS[block.type];
      if (!childKeys) {
        continue;
      }
      for (const key of childKeys) {
        const children = (block as unknown as Record<string, unknown>)[key];
        if (Array.isArray(children)) {
          stack.push({ blocks: children as JsonBlock[], prefix: `${here}.${key}` });
        }
      }
    }
  }
  return null;
}

// Pin the imports so `tsc --noEmit` reports unused-export drift if upstream
// renames CONTAINER_BLOCK_TYPES / `JsonStep` shape; both are part of the
// observed contract that downstream commands depend on.
void CONTAINER_BLOCK_TYPES;
