/**
 * Wires `setupScrollTracking` from `lib/analytics` to the rendered content's
 * scrollable container.
 *
 * Looks up the scrollable element by the DOM id `inner-docs-content` — a
 * contract surface pinned by `docs-panel.contract.test.tsx`. Do not rename.
 *
 * Skipped for the recommendations tab and for tabs without loaded content,
 * matching the original inline gate.
 */
import * as React from 'react';
import { setupScrollTracking } from '../../../lib/analytics';
import { getActiveJourneyCompletionPercentage } from '../../../global-state/journey-context';
import type { LearningJourneyTab } from '../../../types/content-panel.types';

export interface UseScrollTrackingParams {
  activeTab: LearningJourneyTab | null;
  isRecommendationsTab: boolean;
}

export function useScrollTracking({ activeTab, isRecommendationsTab }: UseScrollTrackingParams): void {
  React.useEffect(() => {
    if (!isRecommendationsTab && activeTab && activeTab.content) {
      const scrollableElement = document.getElementById('inner-docs-content');
      if (scrollableElement) {
        const cleanup = setupScrollTracking(
          scrollableElement,
          activeTab,
          isRecommendationsTab,
          getActiveJourneyCompletionPercentage
        );
        return cleanup;
      }
    }
    return undefined;
    // Deps mirror the original inline effect: activeTab object, activeTab.content,
    // isRecommendationsTab. `activeTab` is included as a whole so that tab swaps
    // (different id) re-wire to the new tab's analytics context.
  }, [activeTab, activeTab?.content, isRecommendationsTab]);
}
