/**
 * Aggregation above a guide: a path's percentage from its members'.
 *
 * Members contribute a percentage, never a block count. That is what removes
 * path-wide totals entirely — no declared step counts, no publish-time
 * recount, no drift between a stamped total and the content it counted — and
 * it is what lets the same formula recurse for any level above a path. See
 * decisions 4 and 5 in `docs/design/COMPLETION-MODEL.md`.
 */

/** A path's progress, in the same shape and units as a guide's. */
export interface MemberRollupProgress {
  /** Integer 0..100, reserving 100 for {@link complete}. */
  percent: number;
  complete: boolean;
}

/**
 * The arithmetic mean of member percentages, weighted equally regardless of
 * member length.
 *
 * `complete` is every member at 100, never `percent === 100`:
 * `guideProgressAtPosition` caps an incomplete guide at 99, so a genuinely
 * finished path can legitimately round to 99 and an incomplete one can round
 * to 100. An empty member list is `{ percent: 0, complete: false }`.
 *
 * A non-finite member percentage would poison the mean and reach a durable
 * record, so members are clamped to 0..100 the way a guide's own percent is.
 */
export function meanOfMemberPercentages(percentages: readonly number[]): MemberRollupProgress {
  if (percentages.length === 0) {
    return { percent: 0, complete: false };
  }

  let total = 0;
  let complete = true;
  for (const value of percentages) {
    const clamped = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
    total += clamped;
    if (clamped < 100) {
      complete = false;
    }
  }

  const mean = total / percentages.length;
  return { percent: complete ? 100 : Math.min(99, Math.floor(mean)), complete };
}
