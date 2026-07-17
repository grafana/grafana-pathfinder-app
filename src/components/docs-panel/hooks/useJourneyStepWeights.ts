import { useEffect } from 'react';
import { resolveJourneyStepWeights } from '../../../docs-retrieval';
import type { Milestone } from '../../../types/content.types';

export interface UseJourneyStepWeightsParams {
  /** Journey key the weights are stored under (tab.baseUrl). */
  journeyKey: string | undefined;
  milestones: Milestone[] | undefined;
}

/**
 * Resolves milestone step weights for the active journey on tab open.
 * Repeat invocations are no-ops via the resolver's session cache.
 */
export function useJourneyStepWeights({ journeyKey, milestones }: UseJourneyStepWeightsParams): void {
  useEffect(() => {
    if (!journeyKey || !milestones?.length) {
      return;
    }
    void resolveJourneyStepWeights(journeyKey, milestones);
  }, [journeyKey, milestones]);
}
