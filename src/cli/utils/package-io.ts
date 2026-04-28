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
  | 'BLOCK_NOT_FOUND'
  | 'CONTAINER_NOT_FOUND'
  | 'PARENT_NOT_CONTAINER'
  | 'WRONG_PARENT_KIND'
  | 'BRANCH_REQUIRED'
  | 'DUPLICATE_ID'
  | 'CONTAINER_REQUIRES_ID'
  | 'CONTAINER_HAS_CHILDREN'
  | 'IF_ABSENT_CONFLICT'
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
  const manifest = fs.existsSync(manifestPath)
    ? (parseFileWithSchema(manifestPath, ManifestJsonSchema, 'manifest.json') as ManifestJson)
    : undefined;

  return { content, manifest };
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
      fs.writeFileSync(path.join(packageDir, 'manifest.json'), serializeJson(state.manifest));
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
    const issues: PackageIOIssue[] = result.error.issues.map((i) => ({
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
export function validatePackageState(content: ContentJson, manifest: ManifestJson | undefined): ValidationOutcome {
  const issues: PackageIOIssue[] = [];

  const contentParsed = ContentJsonSchema.safeParse(content);
  if (!contentParsed.success) {
    for (const issue of contentParsed.error.issues) {
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
    } else if (manifest.id !== content.id) {
      issues.push({
        code: 'ID_MISMATCH',
        message: `ID mismatch: content.json has "${content.id}", manifest.json has "${manifest.id}"`,
        path: ['id'],
      });
    }
  }

  return { ok: issues.length === 0, issues };
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
  target.array.push(block);

  return {
    appended: true,
    id: block.id ?? '',
    position: `${target.path}[${target.array.length - 1}]`,
  };
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

  const forbidden = new Set(['type', 'blocks', 'whenTrue', 'whenFalse', 'steps', 'choices', 'id']);
  const changed: string[] = [];
  for (const [field, value] of Object.entries(options.patch)) {
    if (forbidden.has(field)) {
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
}

/**
 * Remove a block by id. Refuses to drop a non-empty container without
 * `--cascade` so authors don't accidentally lose work.
 */
export function removeBlock(
  content: ContentJson,
  id: string,
  options: RemoveBlockOptions = {}
): { removed: string; childrenRemoved: number } {
  for (const { block, parent, index } of walkBlocks(content)) {
    if (block.id !== id) {
      continue;
    }

    const childCount = countChildren(block);
    if (childCount > 0 && !options.cascade) {
      throw new PackageIOError({
        code: 'CONTAINER_HAS_CHILDREN',
        message: `Block "${id}" has ${childCount} child(ren); pass --cascade to remove it and its children`,
      });
    }

    parent.splice(index, 1);
    return { removed: block.type, childrenRemoved: childCount };
  }

  throw new PackageIOError({
    code: 'BLOCK_NOT_FOUND',
    message: `Block "${id}" not found`,
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

  const validation = validatePackageState(state.content, state.manifest);
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

  return { content, manifest };
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
