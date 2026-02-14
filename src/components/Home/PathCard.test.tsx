/**
 * Tests for PathCard.
 * Verifies card rendering, progress display, and guide item interactions.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { PathCard } from './PathCard';
import type { LearningPath, PathGuide } from '../../types/learning-paths.types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock @grafana/ui — provide simple stand-ins for Icon
jest.mock('@grafana/ui', () => ({
  Icon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const samplePath: LearningPath = {
  id: 'getting-started',
  title: 'Getting started with Grafana',
  description: 'Learn the essentials.',
  guides: ['welcome-to-grafana', 'first-dashboard'],
  badgeId: 'grafana-fundamentals',
  targetPlatform: 'oss',
  estimatedMinutes: 25,
  icon: 'grafana',
};

const sampleGuides: PathGuide[] = [
  { id: 'welcome-to-grafana', title: 'Welcome to Grafana', completed: true, isCurrent: false },
  { id: 'first-dashboard', title: 'Create your first dashboard', completed: false, isCurrent: true },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PathCard', () => {
  const defaultProps = {
    path: samplePath,
    guides: sampleGuides,
    progress: 50,
    completed: false,
    onOpenGuide: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders the path title and description', () => {
      render(<PathCard {...defaultProps} />);
      expect(screen.getByText('Getting started with Grafana')).toBeInTheDocument();
      expect(screen.getByText('Learn the essentials.')).toBeInTheDocument();
    });

    it('renders guide items', () => {
      render(<PathCard {...defaultProps} />);
      expect(screen.getByTestId('guide-item-welcome-to-grafana')).toBeInTheDocument();
      expect(screen.getByTestId('guide-item-first-dashboard')).toBeInTheDocument();
      expect(screen.getByText('Welcome to Grafana')).toBeInTheDocument();
      expect(screen.getByText('Create your first dashboard')).toBeInTheDocument();
    });

    it('shows progress percentage and guide count', () => {
      render(<PathCard {...defaultProps} />);
      expect(screen.getByText('50%')).toBeInTheDocument();
      expect(screen.getByText('1/2 guides')).toBeInTheDocument();
    });

    it('shows estimated time for the path', () => {
      render(<PathCard {...defaultProps} />);
      expect(screen.getByText('25 min')).toBeInTheDocument();
    });

    it('uses the path-card data-testid', () => {
      render(<PathCard {...defaultProps} />);
      expect(screen.getByTestId('path-card-getting-started')).toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('calls onOpenGuide with guide id and title when a guide is clicked', () => {
      const onOpenGuide = jest.fn();
      render(<PathCard {...defaultProps} onOpenGuide={onOpenGuide} />);
      fireEvent.click(screen.getByTestId('guide-item-first-dashboard'));

      expect(onOpenGuide).toHaveBeenCalledWith('first-dashboard', 'Create your first dashboard');
    });
  });
});
