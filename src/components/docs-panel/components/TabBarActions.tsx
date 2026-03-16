/**
 * Unified tab bar actions component for docs-panel.
 * Renders icon buttons for left (recommendations) or right (editor, my learning,
 * options menu, close) positions. All buttons use the same iconTab/iconTabActive
 * styles for consistent sizing and highlight behavior.
 */

import React from 'react';
import { Icon, Dropdown, Menu, Tooltip } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { config, getAppEvents, locationService } from '@grafana/runtime';
import { reportAppInteraction, UserInteraction } from '../../../lib/analytics';
import { PLUGIN_BASE_URL } from '../../../constants';
import { testIds } from '../../../constants/testIds';

export interface TabBarActionsProps {
  /** Which side of the tab bar to render */
  position: 'left' | 'right';
  /** CSS class name for the container wrapper */
  className?: string;
  /** Currently active tab ID (used for highlight) */
  activeTabId: string;
  /** iconTab CSS class */
  iconTabClass: string;
  /** iconTabActive CSS class (applied alongside iconTabClass when active) */
  iconTabActiveClass: string;
  /** Switch to a tab by ID */
  onSetActiveTab: (tabId: string) => void;
}

export const TabBarActions: React.FC<TabBarActionsProps> = ({
  position,
  className,
  activeTabId,
  iconTabClass,
  iconTabActiveClass,
  onSetActiveTab,
}) => {
  const user = config.bootData?.user;
  const canAccessPluginSettings = user?.isGrafanaAdmin === true || user?.orgRole === 'Admin';

  const handleFeedbackClick = () => {
    reportAppInteraction(UserInteraction.GeneralPluginFeedbackButton, {
      interaction_location: 'header_menu_feedback',
      panel_type: 'docs_panel',
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
    const appEvents = getAppEvents();
    appEvents.publish({
      type: 'close-extension-sidebar',
      payload: {},
    });
  };

  const handleMyLearningClick = () => {
    locationService.push(PLUGIN_BASE_URL);
  };

  const tabClass = (isActive: boolean) => `${iconTabClass} ${isActive ? iconTabActiveClass : ''}`;

  if (position === 'left') {
    return (
      <div className={className}>
        <button
          className={tabClass(activeTabId === 'recommendations')}
          onClick={() => onSetActiveTab('recommendations')}
          title={t('docsPanel.recommendations', 'Recommendations')}
          data-testid={testIds.docsPanel.recommendationsTab}
        >
          <Icon name="document-info" size="md" />
        </button>
      </div>
    );
  }

  return (
    <div className={className}>
      <button
        className={tabClass(activeTabId === 'editor')}
        onClick={() => onSetActiveTab('editor')}
        title={t('docsPanel.guideEditor', 'Guide editor')}
        data-testid={testIds.docsPanel.tab('editor')}
      >
        <Icon name="edit" size="md" />
      </button>
      <button
        className={iconTabClass}
        onClick={handleMyLearningClick}
        title={t('docsPanel.myLearning', 'My learning')}
        data-testid={testIds.docsPanel.myLearningTab}
      >
        <Icon name="book-open" size="md" />
      </button>
      <Dropdown
        placement="bottom-end"
        overlay={
          <Menu>
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
        <button
          className={iconTabClass}
          title={t('docsPanel.menuTooltip', 'More options')}
          data-testid={testIds.docsPanel.optionsMenuTrigger}
        >
          <Icon name="ellipsis-v" size="md" />
        </button>
      </Dropdown>
      <button
        className={iconTabClass}
        onClick={handleCloseSidebar}
        title={t('docsPanel.closeSidebar', 'Close sidebar')}
        aria-label="Close sidebar"
        data-testid={testIds.docsPanel.closeButton}
      >
        <Icon name="times" size="md" />
      </button>
    </div>
  );
};
