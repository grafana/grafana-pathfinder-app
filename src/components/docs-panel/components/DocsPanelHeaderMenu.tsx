/**
 * Kebab menu shown in the docs panel's content header.
 *
 * De-duplicates two near-identical inline blocks that previously lived in
 * `docs-panel.tsx` (one in the docs/interactive content-meta toolbar, one
 * passed as `trailingActions` to LearningJourneyMilestoneToolbar). The
 * menus differ only in the analytics `interaction_location` payload and
 * the default `content_type` fallback — both are now explicit props.
 *
 * Pre-mortem H5 (telemetry parity): the two callers pass distinct
 * `interactionLocation` and `defaultContentType` values; the prop interface
 * accepts no defaults so neither caller can silently emit wrong analytics.
 */
import React from 'react';
import { Dropdown, IconButton, Menu } from '@grafana/ui';
import { t } from '@grafana/i18n';
import type { LearningJourneyTab } from '../../../types/content-panel.types';
import { reportAppInteraction, UserInteraction } from '../../../lib/analytics';

export type FeedbackInteractionLocation = 'docs_panel_header_feedback_menu' | 'milestone_progress_bar_feedback_menu';

export interface DocsPanelHeaderMenuProps {
  /** Active tab — used for content_url / content_type analytics payload. */
  activeTab: LearningJourneyTab;
  /** Whether dev-mode `Refresh (dev)` item is rendered. */
  isDevMode: boolean;
  /** Called when the user clicks `Refresh (dev)`. The active tab is passed
   *  back so the caller can route to the reload helper. */
  onReload: (tab: LearningJourneyTab) => void;
  /**
   * Analytics interaction_location for the feedback click — explicitly
   * required so each call site emits its own value (H5).
   */
  interactionLocation: FeedbackInteractionLocation;
  /**
   * Default `content_type` analytics payload when the tab's `type` is
   * undefined. Docs surfaces pass 'docs'; the milestone toolbar passes
   * 'learning-journey'.
   */
  defaultContentType: 'docs' | 'learning-journey';
}

export function DocsPanelHeaderMenu({
  activeTab,
  isDevMode,
  onReload,
  interactionLocation,
  defaultContentType,
}: DocsPanelHeaderMenuProps): React.ReactElement {
  return (
    <Dropdown
      placement="bottom-end"
      overlay={
        <Menu>
          {isDevMode && (
            <Menu.Item
              label={t('docsPanel.refreshDev', 'Refresh (dev)')}
              icon="sync"
              onClick={() => {
                if (activeTab) {
                  onReload(activeTab);
                }
              }}
            />
          )}
          <Menu.Item
            label={t('docsPanel.giveFeedback', 'Give feedback')}
            icon="comment-alt-message"
            onClick={() => {
              reportAppInteraction(UserInteraction.GeneralPluginFeedbackButton, {
                interaction_location: interactionLocation,
                panel_type: 'combined_learning_journey',
                content_url: activeTab.content?.url || activeTab.baseUrl || '',
                content_type: activeTab.type || defaultContentType,
              });
              setTimeout(() => {
                window.open(
                  'https://docs.google.com/forms/d/e/1FAIpQLSdBvntoRShjQKEOOnRn4_3AWXomKYq03IBwoEaexlwcyjFe5Q/viewform?usp=header',
                  '_blank',
                  'noopener,noreferrer'
                );
              }, 100);
            }}
          />
        </Menu>
      }
    >
      <IconButton
        name="ellipsis-v"
        size="sm"
        aria-label={t('docsPanel.menuAriaLabel', 'More options')}
        tooltip={t('docsPanel.menuTooltip', 'More options')}
      />
    </Dropdown>
  );
}
