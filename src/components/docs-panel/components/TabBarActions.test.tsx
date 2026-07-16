/**
 * Tests for TabBarActions component.
 * Tests menu rendering and sidebar close functionality.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { TabBarActions } from './TabBarActions';
import { testIds } from '../../../constants/testIds';
import { PLUGIN_BASE_URL } from '../../../constants';

// Mock @grafana/runtime - all mock values defined inline for hoisting compatibility
jest.mock('@grafana/runtime', () => {
  const mockPublish = jest.fn();
  const mockPush = jest.fn();
  const mockConfig = {
    bootData: {
      user: {
        orgRole: 'Admin',
        isGrafanaAdmin: false,
      },
    },
  };
  return {
    config: mockConfig,
    getAppEvents: jest.fn(() => ({ publish: mockPublish })),
    locationService: { push: mockPush },
    __mockPublish: mockPublish, // Export for test access
    __mockPush: mockPush, // Export for test access
    __mockConfig: mockConfig, // Export for test access
  };
});

// Mock @grafana/i18n
jest.mock('@grafana/i18n', () => ({
  t: jest.fn((key: string, fallback: string) => fallback),
}));

// Mock analytics
jest.mock('../../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  getContentTypeForAnalytics: jest.fn((_url: string | undefined | null, fallback = 'docs') => fallback),
  tabTypeToContentType: jest.fn((type?: string) => (type === 'interactive' ? 'interactive-guide' : type || 'docs')),
  UserInteraction: {
    GeneralPluginFeedbackButton: 'general_plugin_feedback_button',
    DocsPanelInteraction: 'docs_panel_interaction',
  },
}));

// Mock extension-sidebar docked-state storage
jest.mock('../../../lib/storage/extension-sidebar', () => ({
  clearExtensionSidebarDocked: jest.fn(),
}));

// Get mock reference after imports
const {
  __mockPublish: mockPublish,
  __mockPush: mockPush,
  __mockConfig: mockConfig,
} = jest.requireMock('@grafana/runtime');

function makeTab(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'tab-1',
    title: 'Tab',
    baseUrl: 'https://example.com/',
    currentUrl: 'https://example.com/page',
    content: { url: 'https://example.com/page', type: 'docs', metadata: {}, content: '' },
    isLoading: false,
    error: null,
    type: 'docs',
    ...overrides,
  };
}

describe('TabBarActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders menu button with correct aria-label', () => {
      render(<TabBarActions />);

      const menuButton = screen.getByRole('button', { name: 'More options' });
      expect(menuButton).toBeInTheDocument();
    });

    it('renders close button with correct test ID', () => {
      render(<TabBarActions />);

      const closeButton = screen.getByTestId(testIds.docsPanel.closeButton);
      expect(closeButton).toBeInTheDocument();
    });

    it('renders My learning button with correct test ID', () => {
      render(<TabBarActions />);

      const myLearningButton = screen.getByTestId(testIds.docsPanel.myLearningTab);
      expect(myLearningButton).toBeInTheDocument();
    });

    it('applies className prop to container', () => {
      const { container } = render(<TabBarActions className="custom-actions-class" />);

      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).toHaveClass('custom-actions-class');
    });
  });

  describe('close sidebar functionality', () => {
    it('publishes close-extension-sidebar event when close button is clicked', () => {
      render(<TabBarActions />);

      const closeButton = screen.getByTestId(testIds.docsPanel.closeButton);
      fireEvent.click(closeButton);

      expect(mockPublish).toHaveBeenCalledWith({
        type: 'close-extension-sidebar',
        payload: {},
      });
    });

    it('reports analytics when close button is clicked', () => {
      const { reportAppInteraction, UserInteraction } = require('../../../lib/analytics');

      render(<TabBarActions />);

      const closeButton = screen.getByTestId(testIds.docsPanel.closeButton);
      fireEvent.click(closeButton);

      expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.DocsPanelInteraction, {
        action: 'close_sidebar',
        source: 'header_close_button',
      });
    });

    it('clears the persisted docked state so the panel is not restored on the next load', () => {
      const { clearExtensionSidebarDocked } = jest.requireMock('../../../lib/storage/extension-sidebar');

      render(<TabBarActions />);

      fireEvent.click(screen.getByTestId(testIds.docsPanel.closeButton));

      expect(clearExtensionSidebarDocked).toHaveBeenCalled();
    });
  });

  describe('My learning button', () => {
    it('switches to the recommendations tab in place when an in-panel handler is provided', () => {
      const onNavigateToRecommendations = jest.fn();
      render(<TabBarActions onNavigateToRecommendations={onNavigateToRecommendations} />);

      fireEvent.click(screen.getByTestId(testIds.docsPanel.myLearningTab));

      expect(onNavigateToRecommendations).toHaveBeenCalledTimes(1);
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('falls back to full-page navigation when no in-panel handler is provided', () => {
      render(<TabBarActions />);

      fireEvent.click(screen.getByTestId(testIds.docsPanel.myLearningTab));

      expect(mockPush).toHaveBeenCalledWith(PLUGIN_BASE_URL);
    });
  });

  describe('Settings menu item permissions', () => {
    beforeEach(() => {
      // Reset mock config to Admin for each test
      mockConfig.bootData.user = { orgRole: 'Admin', isGrafanaAdmin: false };
    });

    it('enables Settings menu item for Admin users', () => {
      mockConfig.bootData.user = { orgRole: 'Admin', isGrafanaAdmin: false };
      render(<TabBarActions />);

      const menuButton = screen.getByRole('button', { name: 'More options' });
      fireEvent.click(menuButton);

      const settingsItem = screen.getByRole('menuitem', { name: 'Settings' });
      expect(settingsItem).toBeEnabled();
    });

    it('enables Settings menu item for Grafana Admin users', () => {
      mockConfig.bootData.user = { orgRole: 'Viewer', isGrafanaAdmin: true };
      render(<TabBarActions />);

      const menuButton = screen.getByRole('button', { name: 'More options' });
      fireEvent.click(menuButton);

      const settingsItem = screen.getByRole('menuitem', { name: 'Settings' });
      expect(settingsItem).toBeEnabled();
    });

    it('disables Settings menu item for Editor users', () => {
      mockConfig.bootData.user = { orgRole: 'Editor', isGrafanaAdmin: false };
      render(<TabBarActions />);

      const menuButton = screen.getByRole('button', { name: 'More options' });
      fireEvent.click(menuButton);

      const settingsItem = screen.getByRole('menuitem', { name: 'Settings' });
      expect(settingsItem).toBeDisabled();
    });

    it('disables Settings menu item for Viewer users', () => {
      mockConfig.bootData.user = { orgRole: 'Viewer', isGrafanaAdmin: false };
      render(<TabBarActions />);

      const menuButton = screen.getByRole('button', { name: 'More options' });
      fireEvent.click(menuButton);

      const settingsItem = screen.getByRole('menuitem', { name: 'Settings' });
      expect(settingsItem).toBeDisabled();
    });

    it('navigates to settings when enabled item is clicked', () => {
      mockConfig.bootData.user = { orgRole: 'Admin', isGrafanaAdmin: false };
      render(<TabBarActions />);

      const menuButton = screen.getByRole('button', { name: 'More options' });
      fireEvent.click(menuButton);

      const settingsItem = screen.getByRole('menuitem', { name: 'Settings' });
      fireEvent.click(settingsItem);

      expect(mockPush).toHaveBeenCalledWith('/plugins/grafana-pathfinder-app?page=configuration');
    });
  });

  describe('Refresh (dev) menu item', () => {
    const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'More options' }));

    it('is not rendered when isDevMode is false', () => {
      render(<TabBarActions activeTab={makeTab()} isDevMode={false} onReloadActiveTab={jest.fn()} />);
      openMenu();
      expect(screen.queryByRole('menuitem', { name: /refresh \(dev\)/i })).not.toBeInTheDocument();
    });

    it('is not rendered when there is no active content tab', () => {
      render(<TabBarActions activeTab={null} isDevMode onReloadActiveTab={jest.fn()} />);
      openMenu();
      expect(screen.queryByRole('menuitem', { name: /refresh \(dev\)/i })).not.toBeInTheDocument();
    });

    it('is not rendered for a permanent (non-content) tab', () => {
      render(<TabBarActions activeTab={makeTab({ id: 'recommendations' })} isDevMode onReloadActiveTab={jest.fn()} />);
      openMenu();
      expect(screen.queryByRole('menuitem', { name: /refresh \(dev\)/i })).not.toBeInTheDocument();
    });

    it('is rendered in dev mode for a content tab and reloads it when clicked', () => {
      const onReloadActiveTab = jest.fn();
      const tab = makeTab();
      render(<TabBarActions activeTab={tab} isDevMode onReloadActiveTab={onReloadActiveTab} />);
      openMenu();
      const item = screen.getByRole('menuitem', { name: /refresh \(dev\)/i });
      fireEvent.click(item);
      expect(onReloadActiveTab).toHaveBeenCalledWith(tab);
    });
  });

  describe('feedback analytics', () => {
    it('enriches the payload with content context for a content tab', () => {
      const { reportAppInteraction } = require('../../../lib/analytics');
      render(<TabBarActions activeTab={makeTab({ type: 'interactive' })} />);

      fireEvent.click(screen.getByRole('button', { name: 'More options' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Give feedback' }));

      expect(reportAppInteraction).toHaveBeenCalledWith(
        'general_plugin_feedback_button',
        expect.objectContaining({
          interaction_location: 'header_menu_feedback',
          panel_type: 'docs_panel',
          content_url: 'https://example.com/page',
          content_type: 'interactive-guide',
        })
      );
    });

    it('stays generic when there is no active content tab', () => {
      const { reportAppInteraction } = require('../../../lib/analytics');
      render(<TabBarActions activeTab={null} />);

      fireEvent.click(screen.getByRole('button', { name: 'More options' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Give feedback' }));

      const payload = reportAppInteraction.mock.calls[0][1];
      expect(payload).toEqual({
        interaction_location: 'header_menu_feedback',
        panel_type: 'docs_panel',
      });
    });
  });
});
