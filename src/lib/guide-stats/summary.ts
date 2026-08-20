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
 * Version of the stamped stats object. Bump it when the COUNTING RULE changes,
 * or when these fields change shape — the rule being the load-bearing trigger,
 * because a rule change leaves the shapes untouched while restating the
 * denominator of every already-stamped manifest and every percentage already
 * recorded against it. Without a bump, an old-rule stamp and a new-rule stamp
 * are byte-indistinguishable.
 *
 * NOT a content version: it says nothing about whether the guide changed.
 */
export const GUIDE_STATS_VERSION = 1;

export interface GuideStatsSummary {
  version: number;
  /** The completion denominator: counted blocks, containers excluded. */
  blockCount: number;
  /** Section containers. Reported for authoring insight; not in the denominator. */
  sectionCount: number;
  /** Counted blocks carrying a completion affordance. */
  completableBlockCount: number;
  /**
   * Position of the last completable block, 0 when there is none. Equal to
   * `blockCount` when the final counted block is completable, which is the
   * signal that the guide needs no "Mark as complete" button at its foot.
   */
  finalCompletablePosition: number;
}

export function summarizeGuideBlockIndex(index: GuideBlockIndex): GuideStatsSummary {
  return {
    version: GUIDE_STATS_VERSION,
    blockCount: index.totalBlockCount,
    sectionCount: index.sectionCount,
    completableBlockCount: index.completableBlockCount,
    finalCompletablePosition: index.finalCompletablePosition,
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
 * `finalCompletablePosition` comes from the last part that has one, and equals
 * `blockCount` only when the concatenation genuinely ends on a completable
 * block.
 *
 * Only totals roll up: per-block positions stay per guide, on the
 * `computeGuideBlockIndex` of each part. A consumer recording a percentage
 * against a rolled-up `blockCount` therefore needs its numerator from
 * somewhere else — see issue #1666, which carries the tier-0 schema and the
 * first consumer.
 *
 * Callers must summarize every milestone before its parent; the ordering is
 * load-bearing, not incidental.
 */
export function rollUpGuideStats(parts: readonly GuideStatsSummary[]): GuideStatsSummary {
  let blockCount = 0;
  let sectionCount = 0;
  let completableBlockCount = 0;
  let finalCompletablePosition = 0;

  for (const part of parts) {
    if (part.finalCompletablePosition > 0) {
      finalCompletablePosition = blockCount + part.finalCompletablePosition;
    }
    blockCount += part.blockCount;
    sectionCount += part.sectionCount;
    completableBlockCount += part.completableBlockCount;
  }

  return { version: GUIDE_STATS_VERSION, blockCount, sectionCount, completableBlockCount, finalCompletablePosition };
}
