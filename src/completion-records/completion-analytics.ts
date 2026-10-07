import { reportAppInteraction, UserInteraction } from '../lib/analytics';

import type { CompletionFact } from './types';
import { completionAttemptAnalyticsProperties } from './progress-analytics';
import { guideIdentityAnalyticsProperties, pathAnalyticsProperties } from './completion-identity';
export { guideIdentityAnalyticsProperties, pathAnalyticsProperties } from './completion-identity';

export function completionAnalyticsProperties(fact: CompletionFact): Record<string, string | number> {
  return {
    ...guideIdentityAnalyticsProperties(fact),
    ...completionAttemptAnalyticsProperties(fact),
    ...pathAnalyticsProperties(fact.pathIdentity),
    guide_category: fact.guideCategory,
    completion_source: fact.source,
    completion_percentage: fact.completionPercent,
    ...(fact.guideStats && {
      total_block_count: fact.guideStats.blockCount,
      completable_block_count: fact.guideStats.completableBlockCount,
      section_count: fact.guideStats.sectionCount,
      guide_stats_version: fact.guideStats.version,
      block_progress_rule_version: 'block-position-v1',
    }),
    ...(fact.durationMs !== undefined && { duration_ms: fact.durationMs }),
  };
}

export function reportCompletionAnalytics(fact: CompletionFact): void {
  reportAppInteraction(
    fact.kind === 'journey' ? UserInteraction.JourneyCompleted : UserInteraction.GuideCompleted,
    completionAnalyticsProperties(fact)
  );
}
