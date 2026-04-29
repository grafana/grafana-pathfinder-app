/**
 * Tests for EnableRecommenderBanner component.
 * Covers permission gating on the "Go to plugin configuration" button.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { EnableRecommenderBanner } from './EnableRecommenderBanner';

// Mock @grafana/runtime with mutable config
jest.mock('@grafana/runtime', () => {
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
    locationService: { push: mockPush },
    config: mockConfig,
    __mockPush: mockPush,
    __mockConfig: mockConfig,
  };
});

// Mock @grafana/data — acceptedTermsAndConditions must be false so the banner renders
jest.mock('@grafana/data', () => ({
  ...jest.requireActual('@grafana/data'),
  usePluginContext: () => ({ meta: { jsonData: {} } }),
}));

// Mock constants so acceptedTermsAndConditions is always false (banner visible)
jest.mock('../../constants', () => ({
  ...jest.requireActual('../../constants'),
  getConfigWithDefaults: jest.fn(() => ({ acceptedTermsAndConditions: false })),
}));

// Mock analytics
jest.mock('../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: {
    EnableRecommendationsBanner: 'enable_recommendations_banner',
  },
}));

const { __mockPush: mockPush, __mockConfig: mockConfig } = jest.requireMock('@grafana/runtime');

describe('EnableRecommenderBanner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('permission gating on "Go to plugin configuration" button', () => {
    it('enables the button for Org Admin users', () => {
      mockConfig.bootData.user = { orgRole: 'Admin', isGrafanaAdmin: false };
      render(<EnableRecommenderBanner />);

      const button = screen.getByRole('button', { name: /go to plugin configuration/i });
      expect(button).toBeEnabled();
    });

    it('enables the button for Grafana Admin users', () => {
      mockConfig.bootData.user = { orgRole: 'Viewer', isGrafanaAdmin: true };
      render(<EnableRecommenderBanner />);

      const button = screen.getByRole('button', { name: /go to plugin configuration/i });
      expect(button).toBeEnabled();
    });

    it('disables the button for Editor users', () => {
      mockConfig.bootData.user = { orgRole: 'Editor', isGrafanaAdmin: false };
      render(<EnableRecommenderBanner />);

      const button = screen.getByRole('button', { name: /go to plugin configuration/i });
      expect(button).toBeDisabled();
    });

    it('disables the button for Viewer users', () => {
      mockConfig.bootData.user = { orgRole: 'Viewer', isGrafanaAdmin: false };
      render(<EnableRecommenderBanner />);

      const button = screen.getByRole('button', { name: /go to plugin configuration/i });
      expect(button).toBeDisabled();
    });

    it('navigates to recommendations config when Admin clicks the button', () => {
      mockConfig.bootData.user = { orgRole: 'Admin', isGrafanaAdmin: false };
      render(<EnableRecommenderBanner />);

      const button = screen.getByRole('button', { name: /go to plugin configuration/i });
      fireEvent.click(button);

      expect(mockPush).toHaveBeenCalledWith('/plugins/grafana-pathfinder-app?page=recommendations-config');
    });

    it('does not navigate when Editor clicks the disabled button', () => {
      mockConfig.bootData.user = { orgRole: 'Editor', isGrafanaAdmin: false };
      render(<EnableRecommenderBanner />);

      const button = screen.getByRole('button', { name: /go to plugin configuration/i });
      fireEvent.click(button);

      expect(mockPush).not.toHaveBeenCalled();
    });

    it('does not navigate when Viewer clicks the disabled button', () => {
      mockConfig.bootData.user = { orgRole: 'Viewer', isGrafanaAdmin: false };
      render(<EnableRecommenderBanner />);

      const button = screen.getByRole('button', { name: /go to plugin configuration/i });
      fireEvent.click(button);

      expect(mockPush).not.toHaveBeenCalled();
    });
  });
});
