import { reportAppInteraction, UserInteraction } from '../lib/analytics';

import type { CompletionFact } from './types';

// Grafana-published sources. Every other source is customer-authored, so its
// guide identifiers and titles never leave the stack.
const PUBLIC_GUIDE_SOURCES = new Set(['bundled', 'interactive-tutorials', 'online-cdn']);

export function completionAnalyticsProperties(fact: CompletionFact): Record<string, string | number> {
  const isPublic = PUBLIC_GUIDE_SOURCES.has(fact.guideSource);
  const identity: Record<string, string> = !isPublic
    ? {}
    : fact.kind === 'journey'
      ? { journey_id: fact.guideId, journey_title: fact.guideTitle }
      : { guide_id: fact.guideId, guide_title: fact.guideTitle };
  return {
    guide_source: isPublic || fact.guideSource === 'app-platform' ? fact.guideSource : 'other',
    guide_visibility: isPublic ? 'public' : 'private',
    guide_category: fact.guideCategory,
    completion_source: fact.source,
    completion_percentage: fact.completionPercent,
    ...identity,
    ...(fact.durationMs !== undefined && { duration_ms: fact.durationMs }),
  };
}

export function reportCompletionAnalytics(fact: CompletionFact): void {
  reportAppInteraction(
    fact.kind === 'journey' ? UserInteraction.JourneyCompleted : UserInteraction.GuideCompleted,
    completionAnalyticsProperties(fact)
  );
}
