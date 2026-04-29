/**
 * `moveBlock` and helpers — reorder a block within its parent or reparent it
 * into another container. The same `--before`/`--after`/`--position`
 * semantics as `appendBlock`'s positional flags, plus `--into <id>` for
 * reparenting and `--branch true|false` when reparenting into a conditional.
 *
 * Cycle safety: refuses to move a container into one of its own descendants
 * (`containerHasDescendant`), which would orphan an entire subtree. Cross-
 * parent uses of `--before`/`--after` are intentionally rejected with a
 * pointer at remove + add-block — supporting cross-parent sibling references
 * would make reasoning about "which array does the id live in?" much harder.
 */

import type { JsonBlock } from '../../../types/json-guide.types';
import type { ContentJson } from '../../../types/package.types';
import { isContainerBlockType } from '../block-registry';
import { PackageIOError } from './errors';
import { resolveAppendTarget } from './mutators';
import { CONTAINER_CHILD_KEYS, findBlockById, walkBlocks } from './tree';

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
