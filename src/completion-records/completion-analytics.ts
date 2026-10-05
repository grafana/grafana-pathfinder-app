import { reportAppInteraction, UserInteraction } from '../lib/analytics';

import type { CompletionFact } from './types';

// Grafana-published sources. Every other source is customer-authored, so its
// guide identifiers and titles never leave the stack.
const PUBLIC_GUIDE_SOURCES = new Set(['bundled', 'interactive-tutorials', 'online-cdn']);

export function guideIdentityAnalyticsProperties({
  kind,
  guideSource,
  guideId,
  guideTitle,
}: Pick<CompletionFact, 'kind' | 'guideSource' | 'guideId' | 'guideTitle'>): Record<string, string> {
  if (!PUBLIC_GUIDE_SOURCES.has(guideSource)) {
    return {
      guide_source: guideSource === 'app-platform' ? guideSource : 'other',
      guide_visibility: 'private',
    };
  }
  return {
    guide_source: guideSource,
    guide_visibility: 'public',
    ...(kind === 'journey'
      ? { journey_id: guideId, journey_title: guideTitle }
      : { guide_id: guideId, guide_title: guideTitle }),
  };
}

export function completionAnalyticsProperties(fact: CompletionFact): Record<string, string | number> {
  return {
    ...guideIdentityAnalyticsProperties(fact),
    guide_category: fact.guideCategory,
    completion_source: fact.source,
    completion_percentage: fact.completionPercent,
    ...(fact.durationMs !== undefined && { duration_ms: fact.durationMs }),
  };
}

export function reportCompletionAnalytics(fact: CompletionFact): void {
  reportAppInteraction(
    fact.kind === 'journey' ? UserInteraction.JourneyCompleted : UserInteraction.GuideCompleted,
    completionAnalyticsProperties(fact)
  );
}
