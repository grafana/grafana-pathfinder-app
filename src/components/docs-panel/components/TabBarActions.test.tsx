/**
 * Tests for TabBarActions component.
 * Tests menu rendering, sidebar close, and tab switching functionality.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { TabBarActions, TabBarActionsProps } from './TabBarActions';
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
  UserInteraction: {
    GeneralPluginFeedbackButton: 'general_plugin_feedback_button',
    DocsPanelInteraction: 'docs_panel_interaction',
  },
}));

// Get mock reference after imports
const {
  __mockPublish: mockPublish,
  __mockPush: mockPush,
  __mockConfig: mockConfig,
} = jest.requireMock('@grafana/runtime');

const defaultRightProps: TabBarActionsProps = {
  position: 'right',
  activeTabId: 'recommendations',
  iconTabClass: 'icon-tab',
  iconTabActiveClass: 'icon-tab-active',
  onSetActiveTab: jest.fn(),
};

const defaultLeftProps: TabBarActionsProps = {
  position: 'left',
  activeTabId: 'recommendations',
  iconTabClass: 'icon-tab',
  iconTabActiveClass: 'icon-tab-active',
  onSetActiveTab: jest.fn(),
};

describe('TabBarActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('right position rendering', () => {
    it('renders menu button with correct aria-label', () => {
      render(<TabBarActions {...defaultRightProps} />);

      const menuButton = screen.getByTitle('More options');
      expect(menuButton).toBeInTheDocument();
    });

    it('renders close button with correct test ID', () => {
      render(<TabBarActions {...defaultRightProps} />);

      const closeButton = screen.getByTestId(testIds.docsPanel.closeButton);
      expect(closeButton).toBeInTheDocument();
    });

    it('renders my learning button with correct test ID', () => {
      render(<TabBarActions {...defaultRightProps} />);

      const myLearningButton = screen.getByTestId(testIds.docsPanel.myLearningTab);
      expect(myLearningButton).toBeInTheDocument();
    });

    it('renders editor button with correct test ID', () => {
      render(<TabBarActions {...defaultRightProps} />);

      const editorButton = screen.getByTestId(testIds.docsPanel.tab('editor'));
      expect(editorButton).toBeInTheDocument();
    });

    it('applies className prop to container', () => {
      const { container } = render(<TabBarActions {...defaultRightProps} className="custom-actions-class" />);

      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).toHaveClass('custom-actions-class');
    });

    it('applies active class to editor button when editor tab is active', () => {
      render(<TabBarActions {...defaultRightProps} activeTabId="editor" />);

      const editorButton = screen.getByTestId(testIds.docsPanel.tab('editor'));
      expect(editorButton).toHaveClass('icon-tab-active');
    });

    it('does not apply active class to editor button when another tab is active', () => {
      render(<TabBarActions {...defaultRightProps} activeTabId="recommendations" />);

      const editorButton = screen.getByTestId(testIds.docsPanel.tab('editor'));
      expect(editorButton).not.toHaveClass('icon-tab-active');
    });
  });

  describe('left position rendering', () => {
    it('renders recommendations button with correct test ID', () => {
      render(<TabBarActions {...defaultLeftProps} />);

      const recsButton = screen.getByTestId(testIds.docsPanel.recommendationsTab);
      expect(recsButton).toBeInTheDocument();
    });

    it('applies active class to recommendations button when active', () => {
      render(<TabBarActions {...defaultLeftProps} activeTabId="recommendations" />);

      const recsButton = screen.getByTestId(testIds.docsPanel.recommendationsTab);
      expect(recsButton).toHaveClass('icon-tab-active');
    });

    it('does not apply active class when another tab is active', () => {
      render(<TabBarActions {...defaultLeftProps} activeTabId="editor" />);

      const recsButton = screen.getByTestId(testIds.docsPanel.recommendationsTab);
      expect(recsButton).not.toHaveClass('icon-tab-active');
    });

    it('calls onSetActiveTab with recommendations when clicked', () => {
      const onSetActiveTab = jest.fn();
      render(<TabBarActions {...defaultLeftProps} onSetActiveTab={onSetActiveTab} />);

      const recsButton = screen.getByTestId(testIds.docsPanel.recommendationsTab);
      fireEvent.click(recsButton);

      expect(onSetActiveTab).toHaveBeenCalledWith('recommendations');
    });
  });

  describe('close sidebar functionality', () => {
    it('publishes close-extension-sidebar event when close button is clicked', () => {
      render(<TabBarActions {...defaultRightProps} />);

      const closeButton = screen.getByTestId(testIds.docsPanel.closeButton);
      fireEvent.click(closeButton);

      expect(mockPublish).toHaveBeenCalledWith({
        type: 'close-extension-sidebar',
        payload: {},
      });
    });

    it('reports analytics when close button is clicked', () => {
      const { reportAppInteraction, UserInteraction } = require('../../../lib/analytics');

      render(<TabBarActions {...defaultRightProps} />);

      const closeButton = screen.getByTestId(testIds.docsPanel.closeButton);
      fireEvent.click(closeButton);

      expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.DocsPanelInteraction, {
        action: 'close_sidebar',
        source: 'header_close_button',
      });
    });
  });

  describe('my learning button', () => {
    it('navigates to my learning home page when clicked', () => {
      render(<TabBarActions {...defaultRightProps} />);

      const myLearningButton = screen.getByTestId(testIds.docsPanel.myLearningTab);
      fireEvent.click(myLearningButton);

      expect(mockPush).toHaveBeenCalledWith(PLUGIN_BASE_URL);
    });
  });

  describe('editor button', () => {
    it('calls onSetActiveTab with editor when clicked', () => {
      const onSetActiveTab = jest.fn();
      render(<TabBarActions {...defaultRightProps} onSetActiveTab={onSetActiveTab} />);

      const editorButton = screen.getByTestId(testIds.docsPanel.tab('editor'));
      fireEvent.click(editorButton);

      expect(onSetActiveTab).toHaveBeenCalledWith('editor');
    });
  });

  describe('settings menu item permissions', () => {
    beforeEach(() => {
      mockConfig.bootData.user = { orgRole: 'Admin', isGrafanaAdmin: false };
    });

    it('enables Settings menu item for Admin users', () => {
      mockConfig.bootData.user = { orgRole: 'Admin', isGrafanaAdmin: false };
      render(<TabBarActions {...defaultRightProps} />);

      const menuButton = screen.getByTitle('More options');
      fireEvent.click(menuButton);

      const settingsItem = screen.getByRole('menuitem', { name: 'Settings' });
      expect(settingsItem).toBeEnabled();
    });

    it('enables Settings menu item for Grafana Admin users', () => {
      mockConfig.bootData.user = { orgRole: 'Viewer', isGrafanaAdmin: true };
      render(<TabBarActions {...defaultRightProps} />);

      const menuButton = screen.getByTitle('More options');
      fireEvent.click(menuButton);

      const settingsItem = screen.getByRole('menuitem', { name: 'Settings' });
      expect(settingsItem).toBeEnabled();
    });

    it('disables Settings menu item for Editor users', () => {
      mockConfig.bootData.user = { orgRole: 'Editor', isGrafanaAdmin: false };
      render(<TabBarActions {...defaultRightProps} />);

      const menuButton = screen.getByTitle('More options');
      fireEvent.click(menuButton);

      const settingsItem = screen.getByRole('menuitem', { name: 'Settings' });
      expect(settingsItem).toBeDisabled();
    });

    it('disables Settings menu item for Viewer users', () => {
      mockConfig.bootData.user = { orgRole: 'Viewer', isGrafanaAdmin: false };
      render(<TabBarActions {...defaultRightProps} />);

      const menuButton = screen.getByTitle('More options');
      fireEvent.click(menuButton);

      const settingsItem = screen.getByRole('menuitem', { name: 'Settings' });
      expect(settingsItem).toBeDisabled();
    });

    it('navigates to settings when enabled item is clicked', () => {
      mockConfig.bootData.user = { orgRole: 'Admin', isGrafanaAdmin: false };
      render(<TabBarActions {...defaultRightProps} />);

      const menuButton = screen.getByTitle('More options');
      fireEvent.click(menuButton);

      const settingsItem = screen.getByRole('menuitem', { name: 'Settings' });
      fireEvent.click(settingsItem);

      expect(mockPush).toHaveBeenCalledWith('/plugins/grafana-pathfinder-app?page=configuration');
    });
  });
});
