import { useCallback } from 'react';
import { getAppEvents } from '@grafana/runtime';
import { t } from '@grafana/i18n';
import {
  reportAppInteraction,
  UserInteraction,
  getContentTypeForAnalytics,
  tabTypeToContentType,
  enrichWithStepContext,
} from '../../../lib/analytics';
import { logger } from '../../../lib/logging';
import { resolveActiveMilestoneSlug } from '../../../docs-retrieval';
import type { LearningJourneyTab } from '../../../types/content-panel.types';
import type { DocsPanelModelOperations } from '../types';
import { resetGuideProgress } from './resetGuideProgress';

interface UseContentResetOptions {
  model: DocsPanelModelOperations;
}

export function useContentReset({ model }: UseContentResetOptions) {
  return useCallback(
    async (progressKey: string, activeTab: LearningJourneyTab) => {
      try {
        const analyticsUrl = activeTab?.content?.url || activeTab?.baseUrl || '';
        reportAppInteraction(
          UserInteraction.ResetProgressClick,
          enrichWithStepContext({
            content_url: analyticsUrl,
            content_type: getContentTypeForAnalytics(analyticsUrl, tabTypeToContentType(activeTab?.type)),
            interaction_location: 'docs_content_meta_header',
          })
        );

        // trackMemberBaseUrl fallback: mirrors recordGuideCompletionForSurface
        // (the writer) exactly. A track-only guide carries no learningJourney
        // (COMPLETION-MODEL.md decision 10), so without this fallback the
        // slug never resolves, resetGuideProgress falls through to the
        // manifest-preferring identity, and — because metadata.packageManifest
        // for a track-only guide load is the RETAINED PARENT path's manifest,
        // not this guide's own — the reset invalidates the parent path's
        // completion guard instead of this guide's, while the guide's own
        // durable completion fact (keyed by this same slug) is untouched.
        const journeyBaseUrl =
          activeTab?.content?.metadata?.learningJourney?.baseUrl ?? activeTab?.content?.metadata?.trackMemberBaseUrl;

        await resetGuideProgress(progressKey, {
          packageManifest: activeTab?.content?.metadata?.packageManifest,
          repository: activeTab?.content?.metadata?.repository,
          milestoneSlug: resolveActiveMilestoneSlug({
            currentUrl: activeTab?.currentUrl,
            journeyBaseUrl,
          }),
          journeyBaseUrl,
        });

        // An internal reload does not request alignment for the fresh guide.
        await model.loadTab(activeTab.id, activeTab.currentUrl || activeTab.baseUrl, {
          source: 'internal_reload',
        });
      } catch (error) {
        logger.error('[DocsPanel] Failed to reset guide progress', { error });
        getAppEvents().publish({
          type: 'alert-error',
          payload: [
            t('docsPanel.resetGuideErrorTitle', 'Reset failed'),
            t(
              'docsPanel.resetGuideErrorMessage',
              "Couldn't reset guide progress. Please try again or reload the page."
            ),
          ],
        });
        throw error;
      }
    },
    [model]
  );
}
