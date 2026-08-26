/**
 * Zod schema for the stamped `manifest.stats` object.
 *
 * Tier 0 because both sides of the stamp need it and they sit either side of
 * `lib/`: `package.schema.ts` (tier 0) declares the manifest field, and
 * `lib/guide-stats/summary.ts` (tier 1) computes the value. A shared definition
 * therefore has to land below both — `package.schema.ts` importing from `lib/`
 * would be an upward tier import.
 *
 * `GuideStatsSummary` is inferred from this schema rather than declared
 * alongside it, so the writer and the validator cannot drift.
 *
 * @coupling Producer: summarizeGuideBlockIndex in lib/guide-stats/summary.ts
 */

import { z } from 'zod';

/** A non-negative integer count or position. */
const countSchema = z.number().int().min(0);

/**
 * @coupling Type: GuideStatsSummary (inferred below)
 */
export const GuideStatsSummarySchema = z.object({
  version: countSchema,
  blockCount: countSchema,
  sectionCount: countSchema,
  completableBlockCount: countSchema,
  finalCompletablePosition: countSchema,
});

/**
 * Serializable projection of a guide's block index — the completion
 * denominator plus the numbers a reader needs without the guide body in hand.
 *
 * Field meanings are owned by `lib/guide-stats/summary.ts`, which produces this
 * shape; this module owns only its validation.
 */
export type GuideStatsSummary = z.infer<typeof GuideStatsSummarySchema>;
