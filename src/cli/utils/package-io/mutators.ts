/**
 * Block / step / choice mutators — `appendBlock`, `appendStep`,
 * `appendChoice`, `editBlock`, `removeBlock`. Each mutator operates on a
 * parsed `ContentJson` in place and throws a `PackageIOError` with a stable
 * code on every well-defined failure mode.
 *
 * `resolveAppendTarget` is exported (for use by `move.ts`) but is not part of
 * the package-io public API surface — it stays an internal-to-the-directory
 * utility, not re-exported through `index.ts`.
 *
 * Also houses the `--if-absent` equivalence helpers (`findEquivalentLeaf`,
 * `scalarFieldsConflict`) and JSONPath formatting (`positionOf`,
 * `pathToBlock`) used by the mutators above. These are private to the
 * module.
 */

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
} from '../../../types/json-guide.types';
import type { ContentJson } from '../../../types/package.types';
import { isContainerBlockType } from '../block-registry';
import { nextAutoBlockId } from './auto-id';
import { PackageIOError } from './errors';
import { CONTAINER_CHILD_KEYS, CONTAINER_NON_BLOCK_CHILD_KEYS, collectAllIds, findBlockById, walkBlocks } from './tree';

// ---------------------------------------------------------------------------
// appendBlock
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

  // --if-absent path for leaves WITHOUT an explicit --id: search the
  // resolved target parent's children for a content-equivalent leaf and
  // return its id without minting a new one. Without this, re-running the
  // same `add-block markdown … --if-absent --content X` after a crash
  // produces a fresh auto-id (`markdown-2`) instead of the no-op the agent
  // expected — duplicating content silently. Containers and leaves with
  // explicit ids fall through to the id-based --if-absent path below.
  if (options.ifAbsent && !isContainer && !block.id) {
    const target = resolveAppendTarget(content, options);
    const equivalent = findEquivalentLeaf(target.array, block);
    if (equivalent) {
      const equivalentPosition = positionOf(content, equivalent);
      return {
        appended: false,
        id: (equivalent as { id?: string }).id ?? '',
        position: equivalentPosition ?? '<unknown>',
      };
    }
    // No equivalent → fall through to normal append. We don't conflict on
    // "same-type but different content" siblings: an agent calling
    // --if-absent wants "create iff my exact content isn't there", not
    // "fail if any sibling of this type exists".
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

// ---------------------------------------------------------------------------
// appendStep
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// appendChoice
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// editBlock
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// removeBlock
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Insertion-target resolution (shared with move.ts)
// ---------------------------------------------------------------------------

export interface AppendTarget {
  array: JsonBlock[];
  path: string;
}

/**
 * Resolve the parent + branch combination to the actual `JsonBlock[]` array
 * we'll splice into. Exported for use by `move.ts`'s `moveBlockInto`; not
 * part of the package-io public API.
 */
export function resolveAppendTarget(content: ContentJson, options: AppendBlockOptions): AppendTarget {
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

// ---------------------------------------------------------------------------
// --if-absent equivalence helpers
// ---------------------------------------------------------------------------

interface ConflictDetail {
  field: string;
  existing: string;
  requested: string;
}

/**
 * Find an existing leaf block in `siblings` whose type and scalar fields
 * exactly match `candidate`. Used by leaf-block `--if-absent` to short-circuit
 * idempotent retries — if the agent re-runs the same `add-block markdown …`
 * after a crash, the second call returns the existing block's id instead of
 * appending a duplicate.
 *
 * Excludes ids and structural arrays from the equivalence check: the
 * candidate has no id yet (auto-id minting happens after this lookup), and
 * leaves don't have structural arrays anyway. Auto-assigned ids on the
 * existing block are preserved as the canonical id of the result.
 */
function findEquivalentLeaf(siblings: JsonBlock[], candidate: JsonBlock): JsonBlock | null {
  for (const sibling of siblings) {
    if (sibling.type !== candidate.type) {
      continue;
    }
    if (scalarFieldsConflict(sibling, candidate) === null) {
      return sibling;
    }
  }
  return null;
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

// ---------------------------------------------------------------------------
// Container-children helpers
// ---------------------------------------------------------------------------

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

function countChildren(block: JsonBlock): number {
  const blockKeys = CONTAINER_CHILD_KEYS[block.type] ?? [];
  const nonBlockKeys = CONTAINER_NON_BLOCK_CHILD_KEYS[block.type] ?? [];
  let total = 0;
  for (const key of [...blockKeys, ...nonBlockKeys]) {
    const children = (block as unknown as Record<string, unknown>)[key];
    if (Array.isArray(children)) {
      total += children.length;
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// JSONPath formatting
// ---------------------------------------------------------------------------

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
