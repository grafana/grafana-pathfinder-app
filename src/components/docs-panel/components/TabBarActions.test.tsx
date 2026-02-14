/**
 * Tests for TabBarActions component.
 * Tests menu rendering and sidebar close functionality.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { TabBarActions } from './TabBarActions';
import { testIds } from '../../testIds';

// Mock @grafana/runtime - all mock values defined inline for hoisting compatibility
jest.mock('@grafana/runtime', () => {
  const mockPublish = jest.fn();
  return {
    getAppEvents: jest.fn(() => ({ publish: mockPublish })),
    locationService: { push: jest.fn() },
    __mockPublish: mockPublish, // Export for test access
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
const { __mockPublish: mockPublish } = jest.requireMock('@grafana/runtime');

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
    it('invokes click handler (jsdom does not support location.assign; navigation covered by e2e)', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      render(<TabBarActions />);

      const myLearningButton = screen.getByTestId(testIds.docsPanel.myLearningTab);
      fireEvent.click(myLearningButton);

      expect(consoleSpy).toHaveBeenCalled(); // jsdom logs "Not implemented: navigation"
      consoleSpy.mockRestore();
    });
  });
});
