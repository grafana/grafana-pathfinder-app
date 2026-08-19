/**
 * Serializable projection of a {@link GuideBlockIndex}, and the rollup that
 * aggregates a path's or journey's milestones into one summary.
 *
 * Per-block positions stay in the index; only the numbers a downstream reader
 * needs without the guide body in hand are published here. Key order is fixed
 * by the literal below so a build step that writes this into a manifest
 * produces byte-identical output for unchanged content.
 */

import { computeGuideBlockIndex, type CountableBlock, type GuideBlockIndex } from './block-index';

/**
 * Schema version of the stats object. Bumped when these fields change shape —
 * NOT a content version, so it says nothing about whether the guide changed.
 */
export const GUIDE_STATS_VERSION = 1;

export interface GuideStatsSummary {
  version: number;
  /** The completion denominator: counted blocks, containers excluded. */
  blockCount: number;
  /** Section containers. Reported for authoring insight; not in the denominator. */
  sectionCount: number;
  /** Counted blocks carrying a completion affordance. */
  interactiveBlockCount: number;
  /** Position of the last interactive block, 0 when there is none. */
  finalInteractivePosition: number;
}

export function summarizeGuideBlockIndex(index: GuideBlockIndex): GuideStatsSummary {
  return {
    version: GUIDE_STATS_VERSION,
    blockCount: index.totalBlockCount,
    sectionCount: index.sectionCount,
    interactiveBlockCount: index.interactiveBlockCount,
    finalInteractivePosition: index.finalInteractivePosition,
  };
}

export function summarizeGuideBlocks(blocks: readonly CountableBlock[] | undefined): GuideStatsSummary {
  return summarizeGuideBlockIndex(computeGuideBlockIndex(blocks));
}

/**
 * Aggregate ordered parts into one summary, as if their blocks were
 * concatenated in the given order.
 *
 * A path or journey rolls up as `[its own content, ...its milestones]`, which
 * needs no special case: a metapackage with no body of its own contributes a
 * zero part. Positions are offsets into the concatenation, so
 * `finalInteractivePosition` comes from the last part that has one — which is
 * what keeps the 100% special case meaningful across a rollup.
 *
 * Callers must summarize every milestone before its parent; the ordering is
 * load-bearing, not incidental.
 */
export function rollUpGuideStats(parts: readonly GuideStatsSummary[]): GuideStatsSummary {
  let blockCount = 0;
  let sectionCount = 0;
  let interactiveBlockCount = 0;
  let finalInteractivePosition = 0;

  for (const part of parts) {
    if (part.finalInteractivePosition > 0) {
      finalInteractivePosition = blockCount + part.finalInteractivePosition;
    }
    blockCount += part.blockCount;
    sectionCount += part.sectionCount;
    interactiveBlockCount += part.interactiveBlockCount;
  }

  return { version: GUIDE_STATS_VERSION, blockCount, sectionCount, interactiveBlockCount, finalInteractivePosition };
}
