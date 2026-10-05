import { LOCAL_BUNDLED_GUIDE_IDS } from '../constants/local-bundled-guides';
import { reportAppInteraction, UserInteraction } from '../lib/analytics';

import type { CompletionFact } from './types';

// Privacy boundary: only these sources may send a guide identifier or title to RudderStack.
const PUBLIC_GUIDE_SOURCES = new Set(['bundled', 'interactive-tutorials', 'online-cdn']);

export function guideIdentityAnalyticsProperties({
  kind,
  guideSource,
  guideId,
  guideTitle,
}: Pick<CompletionFact, 'kind' | 'guideSource' | 'guideId' | 'guideTitle'>): Record<string, string> {
  const [idProperty, titleProperty] =
    kind === 'journey' ? ['journey_id', 'journey_title'] : ['guide_id', 'guide_title'];
  if (guideSource === 'bundled' && LOCAL_BUNDLED_GUIDE_IDS.has(guideId)) {
    return { guide_source: guideSource, guide_visibility: 'private', [idProperty]: guideId };
  }
  if (!PUBLIC_GUIDE_SOURCES.has(guideSource)) {
    return {
      guide_source: guideSource === 'app-platform' ? guideSource : 'other',
      guide_visibility: 'private',
    };
  }
  return {
    guide_source: guideSource,
    guide_visibility: 'public',
    [idProperty]: guideId,
    [titleProperty]: guideTitle,
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
