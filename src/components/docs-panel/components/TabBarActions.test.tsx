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
  });

  describe('My learning button', () => {
    it('navigates to my learning home page when clicked', () => {
      render(<TabBarActions />);

      const myLearningButton = screen.getByTestId(testIds.docsPanel.myLearningTab);
      fireEvent.click(myLearningButton);

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
});
