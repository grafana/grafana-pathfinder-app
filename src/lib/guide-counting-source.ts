/**
 * The seam between a guide's RENDER tree and its COUNTING tree.
 *
 * They are the same tree on a direct open. They are not on a prepared launch:
 * `prepare-guide-launch.ts` expands snippet refs before a surface is committed,
 * so the renderer receives a tree with a snippet's blocks spliced in, while the
 * counting rule gives a `snippet-ref` exactly one position however many blocks
 * it expands into (`lib/guide-stats/block-index.ts`). Counting whichever tree
 * happened to arrive gave the same guide a different denominator per opening
 * path, and the frozen index kept it for the life of the content key.
 *
 * So an expanded payload carries the pre-inlining guide it was expanded from,
 * and the renderer counts that. Pure string/JSON plumbing — no DOM, no network
 * — so the Node-reachable callers stay Node-reachable.
 */

import type { GuideCountingSource, PreparedRawContent, RawContent } from '../types/content.types';
import type { JsonGuide } from '../types/json-guide.types';

export interface PreparedContentInput {
  /** The payload as fetched, carrying url/type/metadata. */
  fetched: RawContent;
  /** Pre-inlining guide — the canonical counting tree. */
  countingGuide: JsonGuide;
  /** Snippet-expanded guide — what the renderer paints and the launch classifier reads. */
  expandedGuide: JsonGuide;
}

/**
 * Build the one-shot prepared payload. Both trees are serialized here, from
 * one call, so a producer cannot swap in an expanded render body without also
 * supplying the tree it was expanded from.
 */
export function createPreparedContent({
  fetched,
  countingGuide,
  expandedGuide,
}: PreparedContentInput): PreparedRawContent {
  return {
    ...fetched,
    content: JSON.stringify(expandedGuide),
    countingSource: { kind: 'pre-inlining', guideJson: JSON.stringify(countingGuide) },
  };
}

export type CountingTreeSelection =
  | { available: true; guideJson: string }
  /** Known-expanded payload with no preserved counting tree — decline, do not substitute. */
  | { available: false };

/**
 * Pick the tree to count. An absent source means the rendered tree is itself
 * the pre-inlining one, which is every direct open and every editor preview.
 */
export function selectCountingTree(
  renderedGuideJson: string,
  source: GuideCountingSource | undefined
): CountingTreeSelection {
  if (!source) {
    return { available: true, guideJson: renderedGuideJson };
  }
  if (source.kind === 'pre-inlining') {
    return { available: true, guideJson: source.guideJson };
  }
  return { available: false };
}

/**
 * Apply one rewrite to both trees, keeping them different only by snippet
 * expansion. A loader that injects blocks into the render tree alone would
 * reintroduce exactly the cross-path disagreement this module exists to close.
 */
export function rewriteGuideTrees(content: RawContent, rewrite: (guideJson: string) => string): RawContent {
  const source = content.countingSource;
  return {
    ...content,
    content: rewrite(content.content),
    ...(source?.kind === 'pre-inlining' && {
      countingSource: { kind: 'pre-inlining' as const, guideJson: rewrite(source.guideJson) },
    }),
  };
}
