import { reportAppInteraction, UserInteraction } from '../lib/analytics';

import type { CompletionFact } from './types';
import { completionAttemptAnalyticsProperties } from './progress-analytics';
import { guideIdentityAnalyticsProperties, pathAnalytics } from './completion-identity';
export { guideIdentityAnalyticsProperties } from './completion-identity';

export function completionAnalytics(fact: CompletionFact): {
  properties: Record<string, string | number>;
  options: { privatePath: boolean };
} {
  const path = pathAnalytics(fact.pathIdentity);
  const properties = {
    ...guideIdentityAnalyticsProperties(fact),
    ...completionAttemptAnalyticsProperties(fact),
    ...path.properties,
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
  return { properties, options: path.options };
}

export function reportCompletionAnalytics(fact: CompletionFact): void {
  const { properties, options } = completionAnalytics(fact);
  reportAppInteraction(
    fact.kind === 'journey' ? UserInteraction.JourneyCompleted : UserInteraction.GuideCompleted,
    properties,
    options
  );
}
