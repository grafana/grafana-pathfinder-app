import { loadMyCompletions } from '../completion-records/completion-read-client';
import { projectRecommendCompletions } from '../completion-records/recommend-completions';
import { logger } from '../lib/logging';
import { recordRecommendCompletions, type RecommendCompletionsOutcome } from '../lib/telemetry';
import { RecommendCompletionsWireSchema, type RecommendCompletionsWire } from '../types/recommender-completions.schema';
import { getFeatureFlagValue } from '../utils/openfeature';

export const COMPLETIONS_BUDGET_MS = 500;

type Settled = { kind: 'timeout' } | Awaited<ReturnType<typeof loadMyCompletions>>;

export interface CompletionsAttachment {
  completions?: RecommendCompletionsWire;
  outcome: RecommendCompletionsOutcome;
}

/**
 * Resolves to the `completions` payload field (absent when it must be omitted) and its outcome. Never throws.
 * The `/my` load is deliberately not aborted at the budget: it finishes in the background and warms
 * the per-tab cache for the next request. Telemetry is reported separately, with the caller's measured wait.
 */
export async function completionsForRecommend(): Promise<CompletionsAttachment> {
  try {
    if (!getFeatureFlagValue('pathfinder.recommend-completions', false)) {
      return { outcome: 'disabled' };
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
      return { outcome: settled.kind };
    }

    const parsed = RecommendCompletionsWireSchema.safeParse(projectRecommendCompletions(settled.data));
    if (!parsed.success) {
      logger.warn('recommend completions: projection failed validation', {
        paths: parsed.error.issues.map((issue) => issue.path.join('.')),
      });
      return { outcome: 'invalid' };
    }
    return { completions: parsed.data, outcome: 'ok' };
  } catch {
    return { outcome: 'invalid' };
  }
}

/** `waitMs` is how long the recommend request was blocked on the attachment; disabled never waits. */
export function reportCompletionsAttachment(attachment: CompletionsAttachment, waitMs: number): void {
  const { completions, outcome } = attachment;
  recordRecommendCompletions(
    outcome,
    completions?.items.length,
    completions?.truncated,
    outcome === 'disabled' ? undefined : Math.round(waitMs)
  );
}
