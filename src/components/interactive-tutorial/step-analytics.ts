import { buildInteractiveStepProperties, AnalyticsContentType, type StepContext } from '../../lib/analytics';
import { getGuideProgress } from '../../global-state/completion-store';
import { getContentKey } from '../../global-state/content-key';
import { getActiveJourneyContext } from '../../global-state/journey-context';

/**
 * Journey context for step events fired inside a learning-path milestone:
 * the whole path session reports content_type learning-journey, and the
 * milestone position makes overall path progress trackable without joining
 * step URLs against milestone lists.
 */
export function journeyContextProperties(): Record<string, string | number> {
  const journey = getActiveJourneyContext();
  if (!journey) {
    return {};
  }

  return {
    content_type: AnalyticsContentType.LearningJourney,
    journey_url: journey.journeyUrl,
    milestone_number: journey.milestoneNumber,
    milestone_total: journey.totalMilestones,
  };
}

// Percentage is resolved at event time; memoized step metadata would go stale.
export function buildStepEventProperties(
  baseProperties: Record<string, string | number | boolean>,
  stepContext: StepContext
): Record<string, string | number | boolean> {
  return {
    ...buildInteractiveStepProperties(baseProperties, {
      ...stepContext,
      completionPercentage: getGuideProgress(getContentKey()).percentage,
    }),
    ...journeyContextProperties(),
  };
}
