/**
 * Tests for the shared LearningJourneyMilestoneToolbar.
 *
 * Covers the behavior the sidebar and fullscreen surfaces both depend on:
 * - returns null for non-journey tabs (consumer can render unconditionally)
 * - arrow nav fires `panel.navigateToPrevious/Next`
 * - the next-arrow auto-completes step-less milestones via markMilestoneDone
 * - the trailing slot renders (sidebar's PanelModeActionButtons + Dropdown)
 * - the surface flag flips the analytics interaction_location
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  LearningJourneyMilestoneToolbar,
  type LearningJourneyMilestoneToolbarProps,
} from './LearningJourneyMilestoneToolbar';
import type { LearningJourneyTab } from '../../../types/content-panel.types';
import type { CombinedLearningJourneyPanel } from '../docs-panel';

const reportAppInteractionMock = jest.fn();
const markMilestoneDoneMock = jest.fn();

jest.mock('../../../lib/analytics', () => ({
  reportAppInteraction: (...args: unknown[]) => reportAppInteractionMock(...args),
  UserInteraction: {
    MilestoneArrowInteractionClick: 'milestone_arrow_interaction_click',
    OpenExtraResource: 'open_extra_resource',
  },
  getContentTypeForAnalytics: () => 'learning-journey',
}));

jest.mock('../../../docs-retrieval', () => ({
  getJourneyProgress: () => 0,
  getMilestoneSlug: (url: string) => url.split('/').filter(Boolean).pop() ?? null,
  markMilestoneDone: (...args: unknown[]) => markMilestoneDoneMock(...args),
}));

jest.mock('../utils', () => ({
  cleanDocsUrl: (url: string) => url,
}));

jest.mock('@grafana/ui', () => {
  const Real = jest.requireActual('react');
  return {
    Icon: ({ name }: { name: string }) => Real.createElement('span', { 'data-icon': name }, name),
    IconButton: ({ name, onClick, disabled, tooltip, tooltipPlacement, ...rest }: any) => {
      // Drop Grafana-specific props that aren't valid DOM attributes; keep
      // only what's needed for the test to query/click the button.
      void tooltipPlacement;
      const ariaLabel = rest['aria-label'] || tooltip;
      return Real.createElement(
        'button',
        { onClick, disabled, 'aria-label': ariaLabel, className: rest.className, name },
        name
      );
    },
    useStyles2: () => ({
      milestoneProgress: 'milestoneProgress',
      progressInfo: 'progressInfo',
      progressHeader: 'progressHeader',
      milestoneText: 'milestoneText',
      milestoneActions: 'milestoneActions',
      navButton: 'navButton',
      progressBar: 'progressBar',
      progressFill: 'progressFill',
    }),
  };
});

function makePanel() {
  return {
    navigateToPreviousMilestone: jest.fn(),
    navigateToNextMilestone: jest.fn(),
    canNavigatePrevious: jest.fn(() => true),
    canNavigateNext: jest.fn(() => true),
  } as unknown as CombinedLearningJourneyPanel & {
    navigateToPreviousMilestone: jest.Mock;
    navigateToNextMilestone: jest.Mock;
    canNavigatePrevious: jest.Mock;
    canNavigateNext: jest.Mock;
  };
}

function makeJourneyTab(overrides: Partial<LearningJourneyTab> = {}): LearningJourneyTab {
  return {
    id: 'tab-1',
    title: 'My journey',
    baseUrl: 'https://grafana.com/docs/learning-journeys/foo',
    currentUrl: 'https://grafana.com/docs/learning-journeys/foo/m1',
    type: 'learning-journey',
    isLoading: false,
    error: null,
    content: {
      type: 'learning-journey',
      url: 'https://grafana.com/docs/learning-journeys/foo/m1',
      content: '<div />',
      metadata: {
        learningJourney: {
          currentMilestone: 1,
          totalMilestones: 3,
          milestones: [
            { number: 1, title: 'm1', duration: '', url: 'm1', isActive: true, websiteUrl: 'https://grafana.com/m1' },
            { number: 2, title: 'm2', duration: '', url: 'm2', isActive: false },
            { number: 3, title: 'm3', duration: '', url: 'm3', isActive: false },
          ],
          websiteUrl: 'https://grafana.com/journey',
        },
      },
    } as any,
    ...overrides,
  };
}

function renderToolbar(props: Partial<LearningJourneyMilestoneToolbarProps> = {}) {
  const panel = props.panel ?? makePanel();
  const activeTab = props.activeTab ?? makeJourneyTab();
  const merged: LearningJourneyMilestoneToolbarProps = {
    panel,
    activeTab,
    surface: 'sidebar',
    actionButtonClassName: 'secondary',
    hasInteractiveProgress: false,
    progressKey: null,
    onResetGuide: jest.fn(),
    ...props,
  };
  return { ...render(<LearningJourneyMilestoneToolbar {...merged} />), panel: merged.panel, props: merged };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('LearningJourneyMilestoneToolbar', () => {
  it('returns null when the active tab is not a learning-journey (consumer renders unconditionally)', () => {
    const docsTab = makeJourneyTab({ type: 'docs', content: null });
    const { container } = renderToolbar({ activeTab: docsTab });
    expect(container.firstChild).toBeNull();
  });

  it('returns null when the journey content has not loaded the metadata yet', () => {
    const loadingTab = makeJourneyTab({ content: null });
    const { container } = renderToolbar({ activeTab: loadingTab });
    expect(container.firstChild).toBeNull();
  });

  it('renders the milestone label with current/total counts', () => {
    renderToolbar();
    expect(screen.getByText('Milestone 1 of 3')).toBeInTheDocument();
  });

  it('renders the introduction label when currentMilestone === 0', () => {
    const tab = makeJourneyTab();
    (tab.content as any).metadata.learningJourney.currentMilestone = 0;
    renderToolbar({ activeTab: tab });
    expect(screen.getByText('Introduction (3 milestones)')).toBeInTheDocument();
  });

  it('fires panel.navigateToPreviousMilestone on the back arrow', () => {
    const { panel } = renderToolbar();
    fireEvent.click(screen.getByLabelText('Previous milestone'));
    expect((panel as any).navigateToPreviousMilestone).toHaveBeenCalledTimes(1);
  });

  it('fires panel.navigateToNextMilestone on the forward arrow', () => {
    const { panel } = renderToolbar();
    fireEvent.click(screen.getByLabelText('Next milestone'));
    expect((panel as any).navigateToNextMilestone).toHaveBeenCalledTimes(1);
  });

  it('disables the back arrow when canNavigatePrevious returns false', () => {
    const panel = makePanel();
    (panel as any).canNavigatePrevious = jest.fn(() => false);
    renderToolbar({ panel });
    expect(screen.getByLabelText('Previous milestone')).toBeDisabled();
  });

  it('marks the current milestone done when the next arrow is clicked on a step-less milestone', () => {
    const contentRoot: React.RefObject<HTMLElement | null> = { current: document.createElement('div') };
    // No `[data-step-id]` descendants → step-less milestone.

    renderToolbar({ contentRoot });
    fireEvent.click(screen.getByLabelText('Next milestone'));

    expect(markMilestoneDoneMock).toHaveBeenCalledWith('https://grafana.com/docs/learning-journeys/foo', 'm1', 3);
  });

  it('does NOT mark the milestone done when the rendered DOM has interactive steps', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div data-step-id="step-1"></div>';
    const contentRoot: React.RefObject<HTMLElement | null> = { current: root };

    renderToolbar({ contentRoot });
    fireEvent.click(screen.getByLabelText('Next milestone'));

    expect(markMilestoneDoneMock).not.toHaveBeenCalled();
  });

  it('renders the trailing slot (sidebar uses this for PanelModeActionButtons + Dropdown)', () => {
    renderToolbar({ trailingActions: <button data-testid="trailing-extra">extra</button> });
    expect(screen.getByTestId('trailing-extra')).toBeInTheDocument();
  });

  it('shows the Reset guide button when interactive progress exists', () => {
    renderToolbar({ hasInteractiveProgress: true, progressKey: 'progress-1' });
    expect(screen.getByLabelText('Reset guide')).toBeInTheDocument();
  });

  it('hides the Reset guide button when there is no interactive progress and the tab is not interactive', () => {
    renderToolbar({ hasInteractiveProgress: false });
    expect(screen.queryByLabelText('Reset guide')).not.toBeInTheDocument();
  });

  it('uses the surface-specific analytics interaction_location for the Open button', () => {
    renderToolbar({ surface: 'fullscreen' });
    fireEvent.click(screen.getByLabelText('Open this page in new tab'));

    expect(reportAppInteractionMock).toHaveBeenCalledWith(
      'open_extra_resource',
      expect.objectContaining({ interaction_location: 'full_screen_milestone_progress_bar' })
    );
  });

  it('uses the sidebar interaction_location when surface=sidebar', () => {
    renderToolbar({ surface: 'sidebar' });
    fireEvent.click(screen.getByLabelText('Open this page in new tab'));

    expect(reportAppInteractionMock).toHaveBeenCalledWith(
      'open_extra_resource',
      expect.objectContaining({ interaction_location: 'milestone_progress_bar' })
    );
  });
});
