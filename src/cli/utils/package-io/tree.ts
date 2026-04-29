/**
 * Tree traversal primitives over a `ContentJson` block tree.
 *
 * The walkers and lookups here are the only place container-child-key
 * knowledge lives: `CONTAINER_CHILD_KEYS` and `CONTAINER_NON_BLOCK_CHILD_KEYS`
 * are the single source of truth for "which fields hold this container's
 * children". Mutators, move, auto-id, and removal logic all import these
 * constants rather than re-encoding the per-type knowledge.
 */

import type { JsonBlock } from '../../../types/json-guide.types';
import type { ContentJson } from '../../../types/package.types';
import { isContainerBlockType } from '../block-registry';
import { PackageIOError } from './errors';

/**
 * Container blocks store their children under different keys. This map tells
 * the traversal code which children-array(s) to descend into for each block
 * type. Steps and choices are intentionally NOT here because they aren't
 * blocks — they're addressed via `appendStep` / `appendChoice`, not the
 * generic block walker.
 */
export const CONTAINER_CHILD_KEYS: Record<string, string[]> = {
  section: ['blocks'],
  assistant: ['blocks'],
  conditional: ['whenTrue', 'whenFalse'],
};

/**
 * Container blocks whose children are NOT `JsonBlock`s (steps, choices). The
 * walker skips these — generic block traversal would corrupt their schema —
 * but `countChildren` and other "any non-empty container" checks need to see
 * them. Driving the count from a map removes a duplicate site of container-
 * type knowledge (previously hardcoded as per-type ifs in countChildren).
 */
export const CONTAINER_NON_BLOCK_CHILD_KEYS: Record<string, string[]> = {
  multistep: ['steps'],
  guided: ['steps'],
  quiz: ['choices'],
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
