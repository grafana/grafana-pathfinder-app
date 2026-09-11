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
 *   Reaching `n` implies `1..n-1`, so preamble that emits no evidence is
 *   never individually completable.
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

/** The sentinel `json-parser.ts` keys top-level blocks under. */
const STANDALONE_PARENT_ID = '__standalone__';

/** The step-id namespace a transparent container puts its children in. */
interface ContainerNamespace {
  /**
   * The namespace itself, spelled exactly as `json-parser.ts` spells it.
   * `undefined` for a `collapsible`: its converter passes no step context, so
   * its children take no derived id.
   */
  id: string | undefined;
  /**
   * Whether the namespace embeds the container's own sibling index. An author
   * id does not, which is what makes an id-bearing section's children immune
   * to a `snippet-ref` splice anywhere outside it.
   */
  indexDerived: boolean;
}

function childSectionNamespace(block: CountableBlock, jsonPath: string): ContainerNamespace {
  if (block.type === 'section') {
    return block.id
      ? { id: `section-${block.id}`, indexDerived: false }
      : { id: `section:${jsonPath}`, indexDerived: true };
  }
  if (block.type === 'assistant') {
    return { id: `assistant:${jsonPath}`, indexDerived: true };
  }
  return { id: undefined, indexDerived: true };
}

/** Where a block sits, in the namespace the parser keys derived step ids under. */
export interface BlockStepIdContext {
  /** Owning section, conditional branch, or synthetic standalone parent. */
  parentSectionId: string;
  /** Zero-based index within the parent block array. */
  index: number;
}

/** Optional collaborators for {@link computeGuideBlockIndex}. */
export interface BlockIndexOptions {
  /**
   * Runtime step id for a counted block, injected rather than imported so this
   * module stays dependency-free. `resolveCountedBlockStepId` in
   * `src/global-state/guide-step-id-resolver.ts` is the canonical
   * implementation; anything else has to agree with the parser or the
   * numerator resolves nothing.
   *
   * Not called for blocks under a `collapsible`, which the parser gives no
   * step context and therefore no derived id.
   */
  resolveStepId?: (block: CountableBlock, context: BlockStepIdContext) => string | undefined;
}

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
  completable: boolean;
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
   * Position by runtime step id — the key a completed "Do it" arrives under,
   * which is the author id only for the rare block that carries one. Empty
   * when no resolver was supplied. First occurrence wins, as with
   * {@link positionsById}. Excludes every block whose runtime step id a
   * `snippet-ref` splice would shift — its own later siblings, and anything
   * under a container whose namespace embeds a shifted index — see the
   * traversal's own comment. Those blocks fall back to
   * {@link positionsById}/0 rather than a step id the runtime will never
   * dispatch.
   */
  positionsByStepId: ReadonlyMap<string, number>;
  /**
   * For each container carrying an id, the position of the last counted block
   * inside it — the position "mark as complete" on that container evidences.
   * Keyed by the container's RUNTIME id (`section-<authorId>`, as
   * `childSectionNamespace` spells it), not the bare author id, because that is the
   * namespace the acknowledgement the reader actually produces arrives under.
   * Containers with no counted descendants are absent. First occurrence wins
   * when ids are duplicated, matching `positionsById`: last-wins would let a
   * click on the earlier container permanently over-credit progress, and
   * progress is monotonic so it could never be corrected downward.
   */
  containerEndPositions: ReadonlyMap<string, number>;
  /** Transparent `section` containers encountered. Not part of the denominator. */
  sectionCount: number;
  /** Counted blocks that can emit completion evidence. */
  completableBlockCount: number;
  /**
   * Position of the last completable counted block, or 0 when the guide has
   * none. An authoring signal, not a rendering predicate: the foot-of-guide
   * "Mark as complete" button is unconditional, so do not re-derive one from
   * this field without re-opening `docs/design/COMPLETION-MODEL.md`.
   */
  finalCompletablePosition: number;
}

/**
 * Walk a guide's blocks and produce its denominator and per-block positions.
 *
 * Traversal is depth-first pre-order over document order, so positions match
 * the order a reader meets the blocks.
 */
export function computeGuideBlockIndex(
  blocks: readonly CountableBlock[] | undefined,
  options?: BlockIndexOptions
): GuideBlockIndex {
  const counted: CountedBlock[] = [];
  const positionsById = new Map<string, number>();
  const positionsByStepId = new Map<string, number>();
  const containerEndPositions = new Map<string, number>();
  let sectionCount = 0;
  let completableBlockCount = 0;
  let finalCompletablePosition = 0;
  const resolveStepId = options?.resolveStepId;

  function visit(
    children: readonly CountableBlock[] | undefined,
    prefix: readonly number[],
    // `parentSectionId` and `jsonPath` mirror `json-parser.ts`'s own walk: the
    // step id is a hash over them, so a divergence here silently rekeys every
    // anonymous block's progress. `undefined` means the parser supplies no
    // step context, which is what makes a `collapsible` child unaddressable.
    parentSectionId: string | undefined,
    jsonPath: string,
    // Whether `parentSectionId` embeds an index a `snippet-ref` shifted, and
    // whether `jsonPath` does. They differ: an id-bearing section resets the
    // first while still carrying the second down to any id-less container
    // nested inside it.
    parentNamespaceShifted: boolean,
    jsonPathShifted: boolean
  ): void {
    if (!Array.isArray(children)) {
      return;
    }

    // A `snippet-ref` splices in a runtime-sized batch of blocks before
    // `json-parser.ts` ever sees the guide (`snippet-engine/inline-refs.ts`),
    // shifting every later sibling's POST-inlining index by however many
    // blocks it expands into — an amount this traversal cannot know without
    // waiting on the snippet CDN, which would defeat the frozen index's
    // stability guarantee (see `active-guide-index.ts`). So once a
    // snippet-ref has been seen among this parent's children, later siblings
    // — and anything nested under one whose namespace embeds that shifted
    // index — are excluded from `positionsByStepId` rather than keyed under
    // an index the runtime will never dispatch: a miss falls through to
    // `positionsById`/0, the honest degradation an unauthored block already
    // gets, instead of colliding with whatever unrelated block happens to
    // hash to the same wrong-index step id.
    let sawSnippetRefSibling = false;

    for (let index = 0; index < children.length; index++) {
      const block = children[index];
      if (!block || typeof block.type !== 'string') {
        continue;
      }
      const path = [...prefix, index];
      const blockJsonPath = `${jsonPath}[${index}]`;

      if (TRANSPARENT_CONTAINERS.has(block.type)) {
        if (block.type === 'section') {
          sectionCount++;
        }
        const before = counted.length;
        const namespace = childSectionNamespace(block, blockJsonPath);
        const childJsonPathShifted = jsonPathShifted || sawSnippetRefSibling;
        visit(
          block.blocks,
          path,
          namespace.id,
          `${blockJsonPath}.blocks`,
          namespace.indexDerived && childJsonPathShifted,
          childJsonPathShifted
        );
        if (
          namespace.id !== undefined &&
          typeof block.id === 'string' &&
          block.id.length > 0 &&
          counted.length > before &&
          !containerEndPositions.has(namespace.id)
        ) {
          containerEndPositions.set(namespace.id, counted.length);
        }
        continue;
      }

      const completable = emitsCompletionEvidence(block);
      const position = counted.length + 1;
      counted.push({ position, type: block.type, ...(block.id ? { id: block.id } : {}), path, completable });
      if (typeof block.id === 'string' && block.id.length > 0 && !positionsById.has(block.id)) {
        positionsById.set(block.id, position);
      }
      if (resolveStepId && parentSectionId !== undefined && !parentNamespaceShifted && !sawSnippetRefSibling) {
        const stepId = resolveStepId(block, { parentSectionId, index });
        if (stepId && !positionsByStepId.has(stepId)) {
          positionsByStepId.set(stepId, position);
        }
      }
      if (completable) {
        completableBlockCount++;
        finalCompletablePosition = position;
      }
      if (block.type === 'snippet-ref') {
        sawSnippetRefSibling = true;
      }
    }
  }

  visit(blocks, [], STANDALONE_PARENT_ID, 'blocks', false, false);

  return {
    totalBlockCount: counted.length,
    blocks: counted,
    positionsById,
    positionsByStepId,
    containerEndPositions,
    sectionCount,
    completableBlockCount,
    finalCompletablePosition,
  };
}
