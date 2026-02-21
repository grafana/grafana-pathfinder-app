/**
 * UserProfileBar Tests
 *
 * Tests rendering states, click handlers, loading, and all-complete scenarios.
 * Mocks useNextLearningAction at module level to isolate component behavior.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import { UserProfileBar } from './UserProfileBar';
import { useNextLearningAction, type LearningProfileSummary } from '../../learning-paths';
import { testIds } from '../../constants/testIds';

// ============================================================================
// MOCKS
// ============================================================================

jest.mock('../../learning-paths', () => ({
  useNextLearningAction: jest.fn(),
}));

const mockHook = useNextLearningAction as jest.MockedFunction<typeof useNextLearningAction>;

const mockSummary: LearningProfileSummary = {
  badgesEarned: 3,
  badgesTotal: 16,
  guidesCompleted: 7,
  streakDays: 3,
  isActiveToday: true,
  nextAction: {
    guideId: 'prometheus-101',
    guideTitle: 'Prometheus & Grafana 101',
    guideUrl: 'bundled:prometheus-101',
    pathTitle: 'Getting started with Grafana',
    pathProgress: 33,
  },
  isLoading: false,
};

// ============================================================================
// TESTS
// ============================================================================

describe('UserProfileBar', () => {
  const onOpenGuide = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockHook.mockReturnValue(mockSummary);
  });

  it('renders badge count', () => {
    render(<UserProfileBar onOpenGuide={onOpenGuide} />);

    expect(screen.getByText('3/16')).toBeInTheDocument();
  });

  it('renders guides completed count', () => {
    render(<UserProfileBar onOpenGuide={onOpenGuide} />);

    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('guides')).toBeInTheDocument();
  });

  it('renders streak when > 0', () => {
    render(<UserProfileBar onOpenGuide={onOpenGuide} />);

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('days')).toBeInTheDocument();
  });

  it('hides streak when 0', () => {
    mockHook.mockReturnValue({ ...mockSummary, streakDays: 0 });

    render(<UserProfileBar onOpenGuide={onOpenGuide} />);

    expect(screen.queryByText('days')).not.toBeInTheDocument();
  });

  it('renders next action link with correct title', () => {
    render(<UserProfileBar onOpenGuide={onOpenGuide} />);

    const nextButton = screen.getByTestId(testIds.contextPanel.userProfileBarNextAction);
    expect(nextButton).toBeInTheDocument();
    expect(screen.getByText('Next: Prometheus & Grafana 101')).toBeInTheDocument();
  });

  it('calls onOpenGuide with correct url and title when next action is clicked', () => {
    render(<UserProfileBar onOpenGuide={onOpenGuide} />);

    fireEvent.click(screen.getByTestId(testIds.contextPanel.userProfileBarNextAction));

    expect(onOpenGuide).toHaveBeenCalledTimes(1);
    expect(onOpenGuide).toHaveBeenCalledWith('bundled:prometheus-101', 'Prometheus & Grafana 101');
  });

  it('shows all-complete state when nextAction is null', () => {
    mockHook.mockReturnValue({ ...mockSummary, nextAction: null });

    render(<UserProfileBar onOpenGuide={onOpenGuide} />);

    expect(screen.getByTestId(testIds.contextPanel.userProfileBarAllComplete)).toBeInTheDocument();
    expect(screen.getByText('All paths complete!')).toBeInTheDocument();
    expect(screen.queryByTestId(testIds.contextPanel.userProfileBarNextAction)).not.toBeInTheDocument();
  });

  it('shows loading skeleton when isLoading is true', () => {
    mockHook.mockReturnValue({ ...mockSummary, isLoading: true });

    render(<UserProfileBar onOpenGuide={onOpenGuide} />);

    expect(screen.getByTestId(testIds.contextPanel.userProfileBarLoading)).toBeInTheDocument();
    expect(screen.queryByTestId(testIds.contextPanel.userProfileBar)).not.toBeInTheDocument();
  });

  it('provides aria-labels on stat spans for screen readers', () => {
    render(<UserProfileBar onOpenGuide={onOpenGuide} />);

    expect(screen.getByLabelText('3 of 16 badges earned')).toBeInTheDocument();
    expect(screen.getByLabelText('7 learning guides completed')).toBeInTheDocument();
    expect(screen.getByLabelText('3-day learning streak — keep it going!')).toBeInTheDocument();
  });

  it('renders star and fire emoji icons', () => {
    render(<UserProfileBar onOpenGuide={onOpenGuide} />);

    expect(screen.getByText('🏆')).toBeInTheDocument();
    expect(screen.getByText('🔥')).toBeInTheDocument();
  });
});
