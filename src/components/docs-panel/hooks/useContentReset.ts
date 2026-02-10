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
import { isDocsLikeTab } from '../utils';
import type { LearningJourneyTab } from '../../../types/content-panel.types';
import type { DocsPanelModelOperations } from '../types';

interface UseContentResetOptions {
  model: DocsPanelModelOperations;
  setHasInteractiveProgress: (value: boolean) => void;
}

/**
 * Returns a function that resets all interactive guide progress for a given content item.
 * The reset includes:
 * 1. Analytics tracking
 * 2. Storage clearing (interactive steps + completion percentage)
 * 3. Local state update
 * 4. Cross-component event dispatch (notifies recommendations panel)
 * 5. Content reload to reset UI state
 *
 * @param options - Configuration object with model and state setter
 * @returns Async function that performs the reset
 */
export function useContentReset({ model, setHasInteractiveProgress }: UseContentResetOptions) {
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

        // Step 3: Update local state
        setHasInteractiveProgress(false);

        // Step 4: Dispatch cross-component event
        // This notifies the recommendations panel to refresh
        window.dispatchEvent(
          new CustomEvent('interactive-progress-cleared', {
            detail: { contentKey: progressKey },
          })
        );

        // Step 5: Reload content to reset UI state
        if (isDocsLikeTab(activeTab.type)) {
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
    [model, setHasInteractiveProgress]
  );
}
