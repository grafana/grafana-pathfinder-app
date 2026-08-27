/**
 * Serializable projection of a {@link GuideBlockIndex}, and the rollup that
 * aggregates a path's or journey's milestones into one summary.
 *
 * Per-block positions stay in the index; only the numbers a downstream reader
 * needs without the guide body in hand are published here. Key order is fixed
 * by the literal below so a build step that writes this into a manifest
 * produces byte-identical output for unchanged content.
 */

import type { GuideStatsSummary } from '../../types/guide-stats.schema';

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

/**
 * Re-exported from tier 0, where the Zod schema owns the shape so the writer
 * here and the validator on the read side cannot drift (#1666). The type-only
 * import keeps this module free of a runtime dependency.
 *
 * - `version` — {@link GUIDE_STATS_VERSION} at the time of the stamp.
 * - `blockCount` — the completion denominator: counted blocks, containers excluded.
 * - `sectionCount` — section containers. Authoring insight; not in the denominator.
 * - `completableBlockCount` — counted blocks carrying a completion affordance.
 * - `finalCompletablePosition` — position of the last completable block, 0 when
 *   there is none. Equal to `blockCount` when the final counted block is
 *   completable, which is the signal that the guide needs no "Mark as complete"
 *   button at its foot.
 */
export type { GuideStatsSummary };

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
