/**
 * Canonical block-count / completion-denominator computation for a guide.
 *
 * This is the single implementation of the counting rule agreed on 2026-08-19.
 * It is a pure function over the guide block schema — no file IO, no network,
 * no rendering, no CLI concerns — so the CLI, an upload script, the plugin
 * frontend, and a Go port can all inherit the same arithmetic.
 *
 * The rule:
 *
 * - The denominator is the total number of blocks, EXCLUDING containers. A
 *   section holding five blocks contributes five, not six.
 * - Progress is position-based and monotonic: if the furthest block with
 *   evidence of completion sits at position `n`, completion is `n / total`.
 *   Reaching `n` implies `1..n-1`, so non-interactive preamble is never
 *   individually completable.
 * - `multistep`, `guided`, `conditional`, and `snippet-ref` count as exactly
 *   ONE block each, with the traversal never entering them. See
 *   {@link OPAQUE_PARENT_BLOCK_TYPES}.
 *
 * Consumers must ask this module for a block's position rather than deriving
 * one themselves — that is what makes the numerator and the denominator
 * structurally incapable of disagreeing.
 */

import type { JsonBlock } from '../../types/json-guide.types';
import { emitsCompletionEvidence } from './completion-affordance';

/**
 * The narrowest block shape the counter needs. `JsonBlock` satisfies it; so
 * does a raw parsed manifest payload whose blocks have not been narrowed,
 * which is why the child arrays are optional and read-only here.
 */
export interface CountableBlock {
  type: string;
  blocks?: readonly CountableBlock[];
  whenTrue?: readonly CountableBlock[];
  whenFalse?: readonly CountableBlock[];
  id?: string;
  /** Read only for `input`, whose completion affordance depends on its shape. */
  inputType?: string;
  dataCheckQuery?: string;
  dataCheckBlocking?: boolean;
}

/**
 * Containers that hold child blocks and are transparent to the count: they
 * contribute nothing themselves, their contents contribute everything.
 */
export const TRANSPARENT_CONTAINER_BLOCK_TYPES = [
  'section',
  'assistant',
  'collapsible',
] as const satisfies ReadonlyArray<JsonBlock['type']>;

/**
 * Blocks that hold children yet count as exactly one, with the traversal
 * never entering them.
 *
 * `multistep` and `guided` abstract their inner steps away from the
 * denominator; analytics still tracks the child steps separately.
 *
 * `conditional` counts as one because descending into `whenTrue` and
 * `whenFalse` would put blocks in the denominator that the reader can never
 * see, making 100% unreachable for every guide holding one.
 *
 * `snippet-ref` counts as one and its resolved contents inherit that single
 * position. `src/snippet-engine/inline-refs.ts` splices the resolved blocks in
 * before the parser sees the guide, so the denominator here is the
 * PRE-INLINING count and a consumer must index the pre-inlining tree. Mapping
 * an inlined block back to its ref is not available: the splice carries no
 * provenance field, so there is nothing to map back from.
 */
export const OPAQUE_PARENT_BLOCK_TYPES = [
  'multistep',
  'guided',
  'conditional',
  'snippet-ref',
] as const satisfies ReadonlyArray<JsonBlock['type']>;

const TRANSPARENT_CONTAINERS: ReadonlySet<string> = new Set(TRANSPARENT_CONTAINER_BLOCK_TYPES);

/** A block that occupies a position in the denominator. */
export interface CountedBlock {
  /** 1-based position in document order. */
  position: number;
  type: string;
  /** Author-assigned id, when the block carries one. */
  id?: string;
  /**
   * Child indices from the guide root, e.g. `[2, 0]` for the first block of
   * the third top-level block. Always available, unlike `id`.
   */
  path: readonly number[];
  /**
   * Whether the block can emit evidence that the reader completed it. Not the
   * same as "renders interactively" — see `completion-affordance.ts`.
   */
  interactive: boolean;
}

/**
 * Total plus per-block positions. The total alone would let a consumer
 * recompute positions and drift; this carries both so it never has to.
 */
export interface GuideBlockIndex {
  /** The completion denominator. */
  totalBlockCount: number;
  /** Counted blocks in document order; `blocks[i].position === i + 1`. */
  blocks: readonly CountedBlock[];
  /** Position by block id. First occurrence wins when ids are duplicated. */
  positionsById: ReadonlyMap<string, number>;
  /**
   * For each container carrying an id, the position of the last counted block
   * inside it — the position "mark as complete" on that container evidences.
   * Containers with no counted descendants are absent. First occurrence wins
   * when ids are duplicated, matching `positionsById`: last-wins would let a
   * click on the earlier container permanently over-credit progress, and
   * progress is monotonic so it could never be corrected downward.
   */
  containerEndPositions: ReadonlyMap<string, number>;
  /** Transparent `section` containers encountered. Not part of the denominator. */
  sectionCount: number;
  /** Counted blocks that are interactive. */
  interactiveBlockCount: number;
  /**
   * Position of the last interactive counted block, or 0 when the guide has
   * none. `finalInteractivePosition === totalBlockCount` means the final
   * counted block is interactive, so the guide needs no "Mark as complete"
   * button at its foot; anything less means one is mandatory.
   */
  finalInteractivePosition: number;
}

/**
 * Walk a guide's blocks and produce its denominator and per-block positions.
 *
 * Traversal is depth-first pre-order over document order, so positions match
 * the order a reader meets the blocks.
 */
export function computeGuideBlockIndex(blocks: readonly CountableBlock[] | undefined): GuideBlockIndex {
  const counted: CountedBlock[] = [];
  const positionsById = new Map<string, number>();
  const containerEndPositions = new Map<string, number>();
  let sectionCount = 0;
  let interactiveBlockCount = 0;
  let finalInteractivePosition = 0;

  function visit(children: readonly CountableBlock[] | undefined, prefix: readonly number[]): void {
    if (!Array.isArray(children)) {
      return;
    }

    for (let index = 0; index < children.length; index++) {
      const block = children[index];
      if (!block || typeof block.type !== 'string') {
        continue;
      }
      const path = [...prefix, index];

      if (TRANSPARENT_CONTAINERS.has(block.type)) {
        if (block.type === 'section') {
          sectionCount++;
        }
        const before = counted.length;
        visit(block.blocks, path);
        if (
          typeof block.id === 'string' &&
          block.id.length > 0 &&
          counted.length > before &&
          !containerEndPositions.has(block.id)
        ) {
          containerEndPositions.set(block.id, counted.length);
        }
        continue;
      }

      const interactive = emitsCompletionEvidence(block);
      const position = counted.length + 1;
      counted.push({ position, type: block.type, ...(block.id ? { id: block.id } : {}), path, interactive });
      if (typeof block.id === 'string' && block.id.length > 0 && !positionsById.has(block.id)) {
        positionsById.set(block.id, position);
      }
      if (interactive) {
        interactiveBlockCount++;
        finalInteractivePosition = position;
      }
    }
  }

  visit(blocks, []);

  return {
    totalBlockCount: counted.length,
    blocks: counted,
    positionsById,
    containerEndPositions,
    sectionCount,
    interactiveBlockCount,
    finalInteractivePosition,
  };
}
