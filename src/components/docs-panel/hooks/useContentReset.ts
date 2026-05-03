/**
 * Hook for resetting interactive guide progress.
 * Handles the complex orchestration of analytics, storage clearing,
 * state updates, event dispatching, and content reloading.
 *
 * Extracted from docs-panel.tsx to enable unit testing and reduce
 * complexity in the reset guide button onClick handler.
 */

import { useCallback } from 'react';
import {
  reportAppInteraction,
  UserInteraction,
  getContentTypeForAnalytics,
  enrichWithStepContext,
} from '../../../lib/analytics';
import { interactiveStepStorage, interactiveCompletionStorage } from '../../../lib/user-storage';
import { shouldUseDocsLoader } from '../utils';
import type { LearningJourneyTab } from '../../../types/content-panel.types';
import type { DocsPanelModelOperations } from '../types';

interface UseContentResetOptions {
  model: DocsPanelModelOperations;
}

/**
 * Returns a function that resets all interactive guide progress for a given content item.
 * The reset includes:
 * 1. Analytics tracking
 * 2. Storage clearing (interactive steps + completion percentage)
 * 3. Cross-component event dispatch (notifies recommendations panel and
 *    `useAlignmentReevaluation`, which clears its `hasInteractiveProgress` flag)
 * 4. Content reload to reset UI state
 *
 * @param options - Configuration object with model
 * @returns Async function that performs the reset
 */
export function useContentReset({ model }: UseContentResetOptions) {
  return useCallback(
    async (progressKey: string, activeTab: LearningJourneyTab) => {
      try {
        // Step 1: Track analytics
        const analyticsUrl = activeTab?.content?.url || activeTab?.baseUrl || '';
        reportAppInteraction(
          UserInteraction.ResetProgressClick,
          enrichWithStepContext({
            content_url: analyticsUrl,
            content_type: getContentTypeForAnalytics(analyticsUrl, activeTab?.type || 'docs'),
            interaction_location: 'docs_content_meta_header',
          })
        );

        // Step 2: Clear storage (async, sequential)
        await interactiveStepStorage.clearAllForContent(progressKey);
        await interactiveCompletionStorage.clear(progressKey);

        // Step 3: Dispatch cross-component event.
        // Notifies the recommendations panel to refresh and `useAlignmentReevaluation`
        // to clear its `hasInteractiveProgress` flag for this contentKey.
        window.dispatchEvent(
          new CustomEvent('interactive-progress-cleared', {
            detail: { contentKey: progressKey },
          })
        );

        // Step 4: Reload content to reset UI state.
        // Tag the loader call as `internal_reload` (aligned-by-construction)
        // so the implied-0th-step evaluator doesn't surface a spurious
        // alignment prompt on top of the freshly reloaded guide when the
        // user happens to be on a non-matching page. Only the docs-like
        // branch runs alignment evaluation; the learning-journey branch
        // (`loadTabContent`) doesn't consume this source.
        if (shouldUseDocsLoader(activeTab)) {
          // Calling loadDocsTabContent directly (not openDocsPage) so we
          // reuse the existing tab; the consume-once flag is the right
          // mechanism here.
          // eslint-disable-next-line @typescript-eslint/no-deprecated -- intentional legacy use; loadDocsTabContent has no source param
          model._recordAutoLaunchSource('internal_reload');
          await model.loadDocsTabContent(activeTab.id, activeTab.currentUrl || activeTab.baseUrl);
        } else {
          await model.loadTabContent(activeTab.id, activeTab.currentUrl || activeTab.baseUrl);
        }
      } catch (error) {
        console.error('[DocsPanel] Failed to reset guide progress:', error);
        // TODO: Show error toast to user
        throw error; // Re-throw so caller can handle if needed
      }
    },
    [model]
  );
}
