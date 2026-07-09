/**
 * Tab bar actions component for docs-panel.
 * Contains the menu dropdown with feedback and settings options,
 * plus the close sidebar button.
 */

import React, { useState, useEffect } from 'react';
import { IconButton, Dropdown, Menu, Tooltip } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { config, getAppEvents, locationService } from '@grafana/runtime';
import { reportAppInteraction, UserInteraction, getContentTypeForAnalytics } from '../../../lib/analytics';
import { PLUGIN_BASE_URL } from '../../../constants';
import { testIds } from '../../../constants/testIds';
import { clearExtensionSidebarDocked } from '../../../lib/storage/extension-sidebar';
import { PERMANENT_TAB_IDS } from '../utils';
import type { LearningJourneyTab } from '../../../types/content-panel.types';

export interface TabBarActionsProps {
  /** CSS class name for the container */
  className?: string;
  /** Active tab; when it is a content tab, enriches feedback analytics and enables the dev-only refresh item. */
  activeTab?: LearningJourneyTab | null;
  /** Whether the dev-only `Refresh (dev)` item is rendered. */
  isDevMode?: boolean;
  /** Reload handler for the `Refresh (dev)` item. */
  onReloadActiveTab?: (tab: LearningJourneyTab) => void;
  /**
   * Switch the panel back to the recommendations tab in place. When supplied,
   * the "My learning" button keeps the user in the sidebar instead of a
   * full-page navigation to the plugin home. Falls back to navigation when
   * absent (e.g. the component rendered outside the panel).
   */
  onNavigateToRecommendations?: () => void;
}

/**
 * Renders the tab bar action buttons: menu dropdown and close sidebar button.
 * Menu contains feedback and settings options.
 */
export const TabBarActions: React.FC<TabBarActionsProps> = ({
  className,
  activeTab,
  isDevMode = false,
  onReloadActiveTab,
  onNavigateToRecommendations,
}) => {
  const user = config.bootData?.user;
  const canAccessPluginSettings = user?.isGrafanaAdmin === true || user?.orgRole === 'Admin';

  const contentTab = activeTab && !PERMANENT_TAB_IDS.has(activeTab.id) ? activeTab : null;
  const reloadContentTab = contentTab && onReloadActiveTab ? () => onReloadActiveTab(contentTab) : null;

  const handleFeedbackClick = () => {
    const contentUrl = contentTab ? contentTab.content?.url || contentTab.baseUrl : undefined;
    reportAppInteraction(UserInteraction.GeneralPluginFeedbackButton, {
      interaction_location: 'header_menu_feedback',
      panel_type: 'docs_panel',
      ...(contentTab && {
        content_url: contentUrl || '',
        content_type: getContentTypeForAnalytics(contentUrl, contentTab.type || 'docs'),
      }),
    });
    setTimeout(() => {
      window.open(
        'https://docs.google.com/forms/d/e/1FAIpQLSdBvntoRShjQKEOOnRn4_3AWXomKYq03IBwoEaexlwcyjFe5Q/viewform?usp=header',
        '_blank',
        'noopener,noreferrer'
      );
    }, 100);
  };

  const handleSettingsClick = () => {
    reportAppInteraction(UserInteraction.DocsPanelInteraction, {
      action: 'navigate_to_config',
      source: 'header_menu_settings',
    });
    locationService.push('/plugins/grafana-pathfinder-app?page=configuration');
  };

  const handleCloseSidebar = () => {
    reportAppInteraction(UserInteraction.DocsPanelInteraction, {
      action: 'close_sidebar',
      source: 'header_close_button',
    });
    // Close the extension sidebar
    const appEvents = getAppEvents();
    appEvents.publish({
      type: 'close-extension-sidebar',
      payload: {},
    });
    // Clear the persisted docked state too, so an explicit close isn't undone by
    // Grafana restoring the panel (browser_restore) on the next page load.
    clearExtensionSidebarDocked();
  };

  const handleMyLearningClick = () => {
    reportAppInteraction(UserInteraction.DocsPanelInteraction, {
      action: 'navigate_to_recommendations',
      source: 'header_my_learning',
    });
    if (onNavigateToRecommendations) {
      onNavigateToRecommendations();
      return;
    }
    locationService.push(PLUGIN_BASE_URL);
  };

  const [kioskEnabled, setKioskEnabled] = useState(!!(window as any).__pathfinderKioskConfig);

  useEffect(() => {
    const onReady = () => setKioskEnabled(true);
    document.addEventListener('pathfinder-kiosk-ready', onReady);
    return () => document.removeEventListener('pathfinder-kiosk-ready', onReady);
  }, []);

  const handleKioskClick = () => {
    document.dispatchEvent(new CustomEvent('pathfinder-open-kiosk'));
  };

  return (
    <div className={className}>
      {kioskEnabled && (
        <IconButton
          name="presentation-play"
          size="sm"
          tooltip="Kiosk mode"
          onClick={handleKioskClick}
          aria-label="Open kiosk mode"
          data-testid={testIds.kioskMode.button}
        />
      )}
      <IconButton
        name="book-open"
        size="sm"
        tooltip={t('docsPanel.myLearning', 'My learning')}
        onClick={handleMyLearningClick}
        aria-label={t('docsPanel.myLearning', 'My learning')}
        data-testid={testIds.docsPanel.myLearningTab}
      />
      <Dropdown
        placement="bottom-end"
        overlay={
          <Menu>
            {isDevMode && reloadContentTab && (
              <Menu.Item label={t('docsPanel.refreshDev', 'Refresh (dev)')} icon="sync" onClick={reloadContentTab} />
            )}
            <Menu.Item
              label={t('docsPanel.giveFeedback', 'Give feedback')}
              icon="comment-alt-message"
              onClick={handleFeedbackClick}
            />
            {canAccessPluginSettings ? (
              <Menu.Item label={t('docsPanel.settings', 'Settings')} icon="cog" onClick={handleSettingsClick} />
            ) : (
              <Tooltip
                content={t('docsPanel.settingsNoPermission', "You don't have permission to access plugin settings")}
                placement="left"
              >
                <span>
                  <Menu.Item label={t('docsPanel.settings', 'Settings')} icon="cog" disabled />
                </span>
              </Tooltip>
            )}
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
      <IconButton
        name="times"
        size="sm"
        tooltip={t('docsPanel.closeSidebar', 'Close sidebar')}
        onClick={handleCloseSidebar}
        aria-label="Close sidebar"
        data-testid={testIds.docsPanel.closeButton}
      />
    </div>
  );
};
