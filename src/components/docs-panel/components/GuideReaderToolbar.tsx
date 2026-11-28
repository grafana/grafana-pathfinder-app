import React from 'react';
import { useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';

import { usePathfinderPluginConfig } from '../../../hooks';
import {
  AnalyticsLinkType,
  getContentTypeForAnalytics,
  reportAppInteraction,
  tabTypeToContentType,
  UserInteraction,
} from '../../../lib/analytics';
import { getMilestoneStyles } from '../../../styles/docs-panel.styles';
import type { LearningJourneyTab } from '../../../types/content-panel.types';
import type { RawContent } from '../../../types/content.types';
import { GuideProgressBar } from '../../guide-progress';
import { ReaderAssistantIconButton } from '../../reader-assistant/ReaderAssistant';
import { useIsAssistantAvailable } from '../../../integrations/assistant-integration/assistant-dev-mode';
import { LessonReaderHeader } from '../../LearningPaths/PathLessonHeader';
import { pickControllerTabOpenAction } from '../utils/controller-tab-open-action';
import { pickGrafanaDocsOpenAction } from '../utils/grafana-docs-open-action';
import type { MilestoneToolbarSurface } from './LearningJourneyMilestoneToolbar';
import { ReaderActionsMenu } from './ReaderActionsMenu';

interface GuideReaderToolbarProps {
  activeTab: LearningJourneyTab;
  content: RawContent;
  surface: Exclude<MilestoneToolbarSurface, 'fullscreen'>;
  hasInteractiveProgress?: boolean;
  progressKey?: string | null;
  onResetGuide?: (progressKey: string, tab: LearningJourneyTab) => Promise<void> | void;
}

export function GuideReaderToolbar({
  activeTab,
  content,
  surface,
  hasInteractiveProgress,
  progressKey,
  onResetGuide,
}: GuideReaderToolbarProps) {
  const styles = useStyles2(getMilestoneStyles, surface);
  const assistantAvailable = useIsAssistantAvailable();
  const { config } = usePathfinderPluginConfig();
  const guideUrl = content.url || activeTab.baseUrl;
  const { cleanUrl } = pickGrafanaDocsOpenAction(guideUrl);
  const { createControllerUrl } = pickControllerTabOpenAction(guideUrl, activeTab.type);
  const showReset = onResetGuide && (hasInteractiveProgress || activeTab.type === 'interactive');
  const showController = config.enableTwoTabController && createControllerUrl;
  const showMenu = surface === 'sidebar' || cleanUrl || showController || showReset;
  const interactionLocation = surface === 'sidebar' ? 'docs_content_meta_right' : 'floating_panel_guide_toolbar';

  const open = (url: string) => {
    reportAppInteraction(UserInteraction.OpenExtraResource, {
      content_url: url,
      content_type: getContentTypeForAnalytics(url, tabTypeToContentType(activeTab.type)),
      link_text: activeTab.title,
      source_page: guideUrl || 'unknown',
      link_type: AnalyticsLinkType.ExternalBrowser,
      interaction_location: interactionLocation,
    });
  };

  return (
    <LessonReaderHeader
      className={styles.milestoneProgress}
      title={content.metadata.title || activeTab.title}
      titleElement="h1"
      navigationLabel={t('learningCard.guide', 'Guide')}
      navigation={
        assistantAvailable || showMenu ? (
          <>
            {assistantAvailable && <ReaderAssistantIconButton content={content} activeTab={activeTab} />}
            {showMenu && (
              <ReaderActionsMenu
                showPanelModeActions={surface === 'sidebar'}
                openAriaLabel={t('docsPanel.openInNewTab', 'Open this page in new tab')}
                onOpen={
                  cleanUrl
                    ? () => {
                        open(cleanUrl);
                        setTimeout(() => window.open(cleanUrl, '_blank', 'noopener,noreferrer'), 100);
                      }
                    : undefined
                }
                onOpenController={
                  showController
                    ? () => {
                        open(guideUrl || 'unknown');
                        window.open(showController(), '_blank', 'noopener,noreferrer');
                      }
                    : undefined
                }
                onReset={
                  showReset
                    ? () => {
                        if (progressKey) {
                          return onResetGuide(progressKey, activeTab);
                        }
                        return undefined;
                      }
                    : undefined
                }
              />
            )}
          </>
        ) : undefined
      }
    >
      <GuideProgressBar contentUrl={content.url} inToolbar />
    </LessonReaderHeader>
  );
}
