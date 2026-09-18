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

        await resetGuideProgress(progressKey, {
          packageManifest: activeTab?.content?.metadata?.packageManifest,
          repository: activeTab?.content?.metadata?.repository,
          milestoneSlug: resolveActiveMilestoneSlug({
            currentUrl: activeTab?.currentUrl,
            journeyBaseUrl: activeTab?.content?.metadata?.learningJourney?.baseUrl,
          }),
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
