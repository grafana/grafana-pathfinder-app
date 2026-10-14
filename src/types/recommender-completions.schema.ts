import { z } from 'zod';

/**
 * Producer-owned wire contract for grafana-recommender `/api/v1/recommend` `completions`;
 * golden at `src/completion-records/testdata/recommend-completions.v1.golden.json`.
 * Additive optional fields keep `v: 1`; rename/removal/meaning change bumps `v`
 * and needs a grafana-recommender follow-up.
 *
 * @coupling API: grafana-recommender `/api/v1/recommend`
 */
export const RECOMMEND_COMPLETIONS_MAX_ITEMS = 250;

export const RecommendCompletionItemWireSchema = z.strictObject({
  guide_source: z.string().min(1),
  guide_id: z.string().min(1),
  percent: z.number().int().min(0).max(100),
  method: z.string().optional(),
  count: z.number().int().min(0),
  completed_at: z.string().optional(),
  duration_seconds: z.number().int().min(0).optional(),
  started_at: z.string().optional(),
  recorded_at: z.string().optional(),
});

export const RecommendCompletionsWireSchema = z.strictObject({
  v: z.literal(1),
  as_of: z.string().optional(),
  truncated: z.boolean(),
  items: z.array(RecommendCompletionItemWireSchema).max(RECOMMEND_COMPLETIONS_MAX_ITEMS),
});

export type RecommendCompletionItemWire = z.infer<typeof RecommendCompletionItemWireSchema>;
export type RecommendCompletionsWire = z.infer<typeof RecommendCompletionsWireSchema>;
