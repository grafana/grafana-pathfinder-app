/**
 * Auto-completes the final milestone of a learning journey when it has no
 * interactive steps to drive completion from clicks.
 *
 * The last milestone has no "Next" button, so without this auto-complete
 * a journey can never reach 100%. We wait 500 ms for the DOM to settle,
 * scan for `[data-step-id]` elements, and if none are present, mark the
 * milestone done via the existing `markMilestoneDone` side effect.
 *
 * Bails out early when:
 *   - There is no content
 *   - The content type is not `learning-journey`
 *   - The active tab is missing currentUrl/baseUrl
 *   - The current milestone is not the last
 *
 * The setTimeout is cleared on dep change / unmount.
 */
import * as React from 'react';
import { getMilestoneSlug, isLastMilestone, markMilestoneDone } from '../../../docs-retrieval';
import type { LearningJourneyTab } from '../../../types/content-panel.types';

export interface UseLastMilestoneAutoCompleteParams {
  /** Content currently rendered in the active tab. */
  stableContent: LearningJourneyTab['content'] | null | undefined;
  /** Active tab — used for currentUrl/baseUrl/totalMilestones. */
  activeTab: LearningJourneyTab | null;
  /** Ref to the rendered content container; we scan it for `[data-step-id]`. */
  contentRef: React.RefObject<HTMLDivElement | null>;
}

export function useLastMilestoneAutoComplete({
  stableContent,
  activeTab,
  contentRef,
}: UseLastMilestoneAutoCompleteParams): void {
  React.useEffect(() => {
    if (!stableContent || stableContent.type !== 'learning-journey' || !activeTab?.currentUrl || !activeTab?.baseUrl) {
      return;
    }

    if (!isLastMilestone(stableContent)) {
      return;
    }

    const timer = setTimeout(() => {
      const container = contentRef?.current;
      if (!container) {
        return;
      }

      const hasInteractiveSteps = container.querySelectorAll('[data-step-id]').length > 0;
      if (!hasInteractiveSteps) {
        const slug = getMilestoneSlug(activeTab.currentUrl!);
        if (slug) {
          void markMilestoneDone(activeTab.baseUrl!, slug, stableContent.metadata?.learningJourney?.totalMilestones, {
            packageManifest: stableContent.metadata?.packageManifest,
            guideTitle: activeTab.title,
          });
        }
      }
    }, 500);

    return () => clearTimeout(timer);
    // `activeTab.type` is intentionally not in the deps — re-running on
    // milestone-by-milestone `currentUrl` changes is the load-bearing trigger.
    // `activeTab.title` is only read to label the completion fact; re-arming
    // the timer on a title change is harmless.
  }, [stableContent, activeTab?.currentUrl, activeTab?.baseUrl, activeTab?.title, contentRef]);
}
