/**
 * Tests for HomePanelRenderer (composition root).
 * Verifies page shell rendering, loading state, and guide-open interaction.
 * Card-specific rendering tests live in PathCard.test.tsx.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { HomePanelRenderer } from './HomePanel';
import type { UseLearningPathsReturn } from '../../types/learning-paths.types';
import { sidebarState } from '../../global-state/sidebar';
import { linkInterceptionState } from '../../global-state/link-interception';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock @grafana/scenes to avoid transitive @grafana/runtime dependency
jest.mock('@grafana/scenes', () => ({
  SceneObjectBase: class SceneObjectBase {},
}));

// Mock @grafana/ui - provide simple stand-ins for Icon and Spinner
jest.mock('@grafana/ui', () => ({
  Icon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
  Spinner: () => <span data-testid="spinner" />,
  useStyles2: (fn: any) => fn(mockTheme),
}));

// Minimal GrafanaTheme2-shaped object for style functions
const mockTheme = {
  isDark: false,
  spacing: (n: number) => `${n * 8}px`,
  shape: { radius: { default: '4px', pill: '9999px' } },
  colors: {
    text: { primary: '#000', secondary: '#666', disabled: '#aaa' },
    background: { primary: '#fff', secondary: '#f5f5f5' },
    border: { weak: '#ddd' },
    action: { hover: '#eee' },
    primary: { shade: '#333' },
    error: { text: '#f00' },
  },
  typography: {
    h3: { fontSize: '24px' },
    h5: { fontSize: '16px' },
    body: { fontSize: '14px' },
    bodySmall: { fontSize: '12px' },
    fontWeightMedium: 500,
  },
  zIndex: { modal: 1000 },
};

// Mock @grafana/i18n (required by some transitive Grafana UI deps)
jest.mock('@grafana/i18n', () => ({
  t: jest.fn((_key: string, fallback: string) => fallback),
}));

// Mock the learning-paths hook
const mockUseLearningPaths = jest.fn<UseLearningPathsReturn, []>();
jest.mock('../../learning-paths', () => ({
  useLearningPaths: () => mockUseLearningPaths(),
}));

// Mock global state
jest.mock('../../global-state/sidebar', () => ({
  sidebarState: {
    getIsSidebarMounted: jest.fn(),
    setPendingOpenSource: jest.fn(),
    openSidebar: jest.fn(),
  },
}));

jest.mock('../../global-state/link-interception', () => ({
  linkInterceptionState: {
    addToQueue: jest.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseLearningPathsReturn: UseLearningPathsReturn = {
  paths: [
    {
      id: 'getting-started',
      title: 'Getting started with Grafana',
      description: 'Learn the essentials.',
      guides: ['welcome-to-grafana', 'first-dashboard'],
      badgeId: 'grafana-fundamentals',
      targetPlatform: 'oss',
      estimatedMinutes: 25,
      icon: 'grafana',
    },
  ],
  allBadges: [],
  badgesWithStatus: [],
  progress: { completedGuides: [], earnedBadges: [], streakDays: 0, lastActivityDate: '', pendingCelebrations: [] },
  getPathGuides: jest.fn((pathId: string) => {
    if (pathId === 'getting-started') {
      return [
        { id: 'welcome-to-grafana', title: 'Welcome to Grafana', completed: true, isCurrent: false },
        { id: 'first-dashboard', title: 'Create your first dashboard', completed: false, isCurrent: true },
      ];
    }
    return [];
  }),
  getPathProgress: jest.fn(() => 50),
  isPathCompleted: jest.fn(() => false),
  markGuideCompleted: jest.fn(),
  dismissCelebration: jest.fn(),
  streakInfo: { days: 0, isActiveToday: false, isAtRisk: false },
  isLoading: false,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HomePanelRenderer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLearningPaths.mockReturnValue(baseLearningPathsReturn);
  });

  // ---------- Page shell ---------------------------------------------------

  describe('page shell', () => {
    it('shows a spinner while loading', () => {
      mockUseLearningPaths.mockReturnValue({ ...baseLearningPathsReturn, isLoading: true });
      render(<HomePanelRenderer />);
      expect(screen.getByTestId('spinner')).toBeInTheDocument();
    });

    it('renders the page title and subtitle', () => {
      render(<HomePanelRenderer />);
      expect(screen.getByText('Pathfinder')).toBeInTheDocument();
      expect(screen.getByText(/Interactive learning paths/)).toBeInTheDocument();
    });

    it('renders a card for each learning path', () => {
      render(<HomePanelRenderer />);
      expect(screen.getByTestId('path-card-getting-started')).toBeInTheDocument();
    });
  });

  // ---------- Guide opening -----------------------------------------------

  describe('opening a guide', () => {
    it('dispatches pathfinder-auto-open-docs when sidebar is mounted', () => {
      (sidebarState.getIsSidebarMounted as jest.Mock).mockReturnValue(true);
      const dispatchSpy = jest.spyOn(document, 'dispatchEvent');

      render(<HomePanelRenderer />);
      fireEvent.click(screen.getByTestId('guide-item-first-dashboard'));

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'pathfinder-auto-open-docs',
          detail: { url: 'bundled:first-dashboard', title: 'Create your first dashboard' },
        })
      );

      dispatchSpy.mockRestore();
    });

    it('opens sidebar and queues link when sidebar is NOT mounted', () => {
      (sidebarState.getIsSidebarMounted as jest.Mock).mockReturnValue(false);

      render(<HomePanelRenderer />);
      fireEvent.click(screen.getByTestId('guide-item-first-dashboard'));

      expect(sidebarState.setPendingOpenSource).toHaveBeenCalledWith('home_page');
      expect(sidebarState.openSidebar).toHaveBeenCalledWith(
        'Interactive learning',
        expect.objectContaining({ url: 'bundled:first-dashboard', title: 'Create your first dashboard' })
      );
      expect(linkInterceptionState.addToQueue).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'bundled:first-dashboard', title: 'Create your first dashboard' })
      );
    });
  });
});
