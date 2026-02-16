/**
 * Tab bar actions component for docs-panel.
 * Contains the menu dropdown with feedback and settings options,
 * plus the close sidebar button.
 */

import React from 'react';
import { IconButton, Dropdown, Menu } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { getAppEvents, locationService } from '@grafana/runtime';
import { reportAppInteraction, UserInteraction } from '../../../lib/analytics';
import { PLUGIN_BASE_URL } from '../../../constants';
import { testIds } from '../../testIds';

export interface TabBarActionsProps {
  /** CSS class name for the container */
  className?: string;
}

/**
 * Renders the tab bar action buttons: menu dropdown and close sidebar button.
 * Menu contains feedback and settings options.
 */
export const TabBarActions: React.FC<TabBarActionsProps> = ({ className }) => {
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
    // Close the extension sidebar
    const appEvents = getAppEvents();
    appEvents.publish({
      type: 'close-extension-sidebar',
      payload: {},
    });
  };

  const handleMyLearningClick = () => {
    locationService.push(PLUGIN_BASE_URL);
  };

  return (
    <div className={className}>
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
            <Menu.Item
              label={t('docsPanel.giveFeedback', 'Give feedback')}
              icon="comment-alt-message"
              onClick={handleFeedbackClick}
            />
            <Menu.Item label={t('docsPanel.settings', 'Settings')} icon="cog" onClick={handleSettingsClick} />
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
