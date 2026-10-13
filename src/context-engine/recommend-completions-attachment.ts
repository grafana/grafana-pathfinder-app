import { loadMyCompletions } from '../completion-records/completion-read-client';
import { projectRecommendCompletions } from '../completion-records/recommend-completions';
import { logger } from '../lib/logging';
import { recordRecommendCompletions, type RecommendCompletionsOutcome } from '../lib/telemetry';
import { RecommendCompletionsWireSchema, type RecommendCompletionsWire } from '../types/recommender-completions.schema';
import { getFeatureFlagValue } from '../utils/openfeature';

export const COMPLETIONS_BUDGET_MS = 500;

type Settled = { kind: 'timeout' } | Awaited<ReturnType<typeof loadMyCompletions>>;

function finish(outcome: RecommendCompletionsOutcome, value?: RecommendCompletionsWire): undefined {
  recordRecommendCompletions(outcome, value?.items.length, value?.truncated);
  return undefined;
}

/**
 * Resolves to the `completions` payload field, or undefined when it must be omitted. Never throws.
 * The `/my` load is deliberately not aborted at the budget: it finishes in the background and warms
 * the per-tab cache for the next request.
 */
export async function completionsForRecommend(): Promise<RecommendCompletionsWire | undefined> {
  try {
    if (!getFeatureFlagValue('pathfinder.recommend-completions', true)) {
      return finish('disabled');
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<Settled>((resolve) => {
      timer = setTimeout(() => resolve({ kind: 'timeout' }), COMPLETIONS_BUDGET_MS);
    });
    let settled: Settled;
    try {
      settled = await Promise.race([loadMyCompletions(), budget]);
    } finally {
      clearTimeout(timer);
    }

    if (settled.kind !== 'ok') {
      return finish(settled.kind);
    }

    const parsed = RecommendCompletionsWireSchema.safeParse(projectRecommendCompletions(settled.data));
    if (!parsed.success) {
      logger.warn('recommend completions: projection failed validation', {
        paths: parsed.error.issues.map((issue) => issue.path.join('.')),
      });
      return finish('invalid');
    }
    recordRecommendCompletions('ok', parsed.data.items.length, parsed.data.truncated);
    return parsed.data;
  } catch {
    return finish('invalid');
  }
}
