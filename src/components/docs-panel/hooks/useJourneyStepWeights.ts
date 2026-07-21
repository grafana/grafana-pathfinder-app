import { useEffect } from 'react';
import { resolveJourneyStepWeights } from '../../../docs-retrieval';
import type { LearningJourneyTab } from '../../../types/content-panel.types';

/**
 * Resolves milestone step weights for the active journey on tab open.
 * Repeat invocations are no-ops via the resolver's session cache.
 */
export function useJourneyStepWeights(activeTab: LearningJourneyTab | null | undefined): void {
  const learningJourney =
    activeTab?.type === 'learning-journey' ? activeTab.content?.metadata.learningJourney : undefined;
  const journeyKey = learningJourney?.baseUrl || activeTab?.baseUrl;
  const milestones = learningJourney?.milestones;

  useEffect(() => {
    if (!journeyKey || !milestones?.length) {
      return;
    }
    void resolveJourneyStepWeights(journeyKey, milestones);
  }, [journeyKey, milestones]);
}
