/**
 * Tests for the shared LearningJourneyMilestoneToolbar.
 *
 * Covers the behavior the sidebar, fullscreen, and floating surfaces all
 * depend on:
 * - returns null for non-journey tabs (consumer can render unconditionally)
 * - arrow nav fires `panel.navigateToPrevious/Next`
 * - the next-arrow auto-completes step-less milestones via markMilestoneDone
 * - the kebab menu's conditional items (Open, Reset guide, Pop out/Dock, Full screen)
 * - the segmented progress bar's per-milestone state
 * - the surface flag flips the analytics interaction_location
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  LearningJourneyMilestoneToolbar,
  type LearningJourneyMilestoneToolbarProps,
} from './LearningJourneyMilestoneToolbar';
import type { LearningJourneyTab } from '../../../types/content-panel.types';
import type { DocsPanelModelOperations } from '../types';

const reportAppInteractionMock = jest.fn();
const markMilestoneDoneMock = jest.fn();
const usePanelModeControlsMock = jest.fn();

jest.mock('../../../lib/analytics', () => ({
  reportAppInteraction: (...args: unknown[]) => reportAppInteractionMock(...args),
  UserInteraction: {
    MilestoneArrowInteractionClick: 'milestone_arrow_interaction_click',
    OpenExtraResource: 'open_extra_resource',
  },
  getContentTypeForAnalytics: () => 'learning-journey',
  tabTypeToContentType: (type?: string) => (type === 'interactive' ? 'interactive-guide' : type || 'docs'),
  AnalyticsLinkType: {
    ExternalBrowser: 'external_browser',
  },
}));

jest.mock('../../../docs-retrieval', () => ({
  getJourneyProgress: () => 0,
  getMilestoneSlug: jest.requireActual('../../../lib/learning-journey-url').getMilestoneSlug,
  markMilestoneDone: (...args: unknown[]) => markMilestoneDoneMock(...args),
  resolveExpectedMilestoneIds: (lj?: { milestones?: Array<{ url: string }> }) =>
    lj?.milestones?.map((m) => m.url.split('/').filter(Boolean).pop() ?? '') ?? [],
}));

jest.mock('../utils', () => ({
  cleanDocsUrl: (url: string) => url,
}));

jest.mock('../../../global-state/use-panel-mode', () => ({
  usePanelModeControls: () => usePanelModeControlsMock(),
}));

jest.mock('@grafana/ui', () => {
  const Real = jest.requireActual('react');
  const MenuItem = ({ label, ariaLabel, onClick, testId }: any) =>
    Real.createElement('button', { onClick, 'aria-label': ariaLabel || label, 'data-testid': testId }, label);
  const Menu = ({ children }: any) => Real.createElement('div', { role: 'menu' }, children);
  Menu.Item = MenuItem;
  Menu.Divider = () => Real.createElement('hr');

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
    Button: ({ children, icon, tooltip, onClick, disabled, ...rest }: any) => {
      const ariaLabel = rest['aria-label'] || tooltip;
      return Real.createElement(
        'button',
        { onClick, disabled, 'aria-label': ariaLabel, 'data-testid': rest['data-testid'] },
        children ?? icon
      );
    },
    // Renders the overlay inline alongside the trigger — these tests assert
    // menu contents/behavior directly, not open/close interaction mechanics.
    Dropdown: ({ children, overlay }: any) => Real.createElement(Real.Fragment, null, children, overlay),
    Menu,
    useStyles2: () => ({
      milestoneProgress: 'milestoneProgress',
      progressInfo: 'progressInfo',
      progressHeader: 'progressHeader',
      titleBlock: 'titleBlock',
      milestoneTitle: 'milestoneTitle',
      milestoneSubtitle: 'milestoneSubtitle',
      moreButton: 'moreButton',
      progressSegments: 'progressSegments',
      progressSegment: 'progressSegment',
    }),
  };
});

function makePanel() {
  return {
    navigateToPreviousMilestone: jest.fn(),
    navigateToNextMilestone: jest.fn(),
    canNavigatePrevious: jest.fn(() => true),
    canNavigateNext: jest.fn(() => true),
  } as unknown as DocsPanelModelOperations & {
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
          baseUrl: 'https://grafana.com/docs/learning-journeys/foo-canonical',
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
    hasInteractiveProgress: false,
    progressKey: null,
    onResetGuide: jest.fn(),
    ...props,
  };
  return { ...render(<LearningJourneyMilestoneToolbar {...merged} />), panel: merged.panel, props: merged };
}

beforeEach(() => {
  jest.clearAllMocks();
  usePanelModeControlsMock.mockReturnValue({
    panelMode: 'sidebar',
    handleTogglePanelMode: jest.fn(),
    handleGoFullScreen: jest.fn(),
  });
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

  it('renders the title and the milestone label with current/total counts', () => {
    renderToolbar();
    expect(screen.getByTitle('My journey')).toBeInTheDocument();
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

    expect(markMilestoneDoneMock).toHaveBeenCalledWith(
      'https://grafana.com/docs/learning-journeys/foo-canonical',
      'm1',
      expect.any(Array),
      expect.objectContaining({ packageManifest: undefined })
    );
  });

  it('does NOT mark the milestone done when the rendered DOM has interactive steps', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div data-step-id="step-1"></div>';
    const contentRoot: React.RefObject<HTMLElement | null> = { current: root };

    renderToolbar({ contentRoot });
    fireEvent.click(screen.getByLabelText('Next milestone'));

    expect(markMilestoneDoneMock).not.toHaveBeenCalled();
  });

  describe('kebab menu', () => {
    it('hides the whole kebab in compact mode', () => {
      renderToolbar({ compact: true, hasInteractiveProgress: true });
      expect(screen.queryByLabelText('More actions')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Reset guide')).not.toBeInTheDocument();
    });

    it('renders Open when an external URL is resolvable', () => {
      renderToolbar();
      expect(screen.getByLabelText('Open')).toBeInTheDocument();
    });

    it('shows Reset guide when interactive progress exists', () => {
      renderToolbar({ hasInteractiveProgress: true, progressKey: 'progress-1' });
      expect(screen.getByLabelText('Reset guide')).toBeInTheDocument();
    });

    it('hides Reset guide when there is no interactive progress and the tab is not interactive', () => {
      renderToolbar({ hasInteractiveProgress: false });
      expect(screen.queryByLabelText('Reset guide')).not.toBeInTheDocument();
    });

    it('calls onResetGuide with the progress key when Reset guide is clicked', () => {
      const onResetGuide = jest.fn();
      renderToolbar({ hasInteractiveProgress: true, progressKey: 'progress-1', onResetGuide });
      fireEvent.click(screen.getByLabelText('Reset guide'));
      expect(onResetGuide).toHaveBeenCalledWith('progress-1', expect.objectContaining({ id: 'tab-1' }));
    });

    it('labels the mode item "Pop out" when panelMode is sidebar', () => {
      usePanelModeControlsMock.mockReturnValue({
        panelMode: 'sidebar',
        handleTogglePanelMode: jest.fn(),
        handleGoFullScreen: jest.fn(),
      });
      renderToolbar();
      expect(screen.getByLabelText('Pop out to floating panel')).toBeInTheDocument();
    });

    it('labels the mode item "Dock" and calls handleTogglePanelMode when panelMode is floating', () => {
      const handleTogglePanelMode = jest.fn();
      usePanelModeControlsMock.mockReturnValue({
        panelMode: 'floating',
        handleTogglePanelMode,
        handleGoFullScreen: jest.fn(),
      });
      renderToolbar();
      fireEvent.click(screen.getByLabelText('Dock guide'));
      expect(handleTogglePanelMode).toHaveBeenCalledTimes(1);
    });

    it('shows Full screen when not already fullscreen', () => {
      usePanelModeControlsMock.mockReturnValue({
        panelMode: 'sidebar',
        handleTogglePanelMode: jest.fn(),
        handleGoFullScreen: jest.fn(),
      });
      renderToolbar();
      expect(screen.getByLabelText('Open in full screen')).toBeInTheDocument();
    });

    it('hides Full screen when panelMode is already fullscreen', () => {
      usePanelModeControlsMock.mockReturnValue({
        panelMode: 'fullscreen',
        handleTogglePanelMode: jest.fn(),
        handleGoFullScreen: jest.fn(),
      });
      renderToolbar();
      expect(screen.queryByLabelText('Open in full screen')).not.toBeInTheDocument();
    });
  });

  describe('segmented progress bar', () => {
    it('renders one segment per milestone, states matching current/done/upcoming', () => {
      const { container } = renderToolbar();
      const segments = container.querySelectorAll('[data-segment-state]');
      expect(Array.from(segments).map((s) => s.getAttribute('data-segment-state'))).toEqual([
        'current',
        'upcoming',
        'upcoming',
      ]);
    });

    it('marks earlier milestones done and later ones upcoming relative to currentMilestone', () => {
      const tab = makeJourneyTab();
      (tab.content as any).metadata.learningJourney.currentMilestone = 2;
      const { container } = renderToolbar({ activeTab: tab });
      const segments = container.querySelectorAll('[data-segment-state]');
      expect(Array.from(segments).map((s) => s.getAttribute('data-segment-state'))).toEqual([
        'done',
        'current',
        'upcoming',
      ]);
    });
  });

  it('uses the surface-specific analytics interaction_location for the Open button', () => {
    renderToolbar({ surface: 'fullscreen' });
    fireEvent.click(screen.getByLabelText('Open'));

    expect(reportAppInteractionMock).toHaveBeenCalledWith(
      'open_extra_resource',
      expect.objectContaining({ interaction_location: 'full_screen_milestone_progress_bar' })
    );
  });

  it('uses the sidebar interaction_location when surface=sidebar', () => {
    renderToolbar({ surface: 'sidebar' });
    fireEvent.click(screen.getByLabelText('Open'));

    expect(reportAppInteractionMock).toHaveBeenCalledWith(
      'open_extra_resource',
      expect.objectContaining({ interaction_location: 'milestone_progress_bar' })
    );
  });

  // ===========================================================================
  // Milestone-arrow analytics: destination semantic
  // ===========================================================================
  //
  // The arrow-click events log the milestone the user is heading TO, not the
  // one they clicked from. For a 6-milestone journey, a forward click from M5
  // logs `current_milestone: 6` — so the analytics agrees with the toolbar's
  // "Milestone 6 of 6" on the end milestone (the previous origin semantic
  // topped out at `N - 1` and never surfaced the end-milestone landing).
  describe('milestone arrow click analytics', () => {
    it('forward click logs the destination milestone (current + 1), not the origin', () => {
      // currentMilestone = 1, totalMilestones = 3 → forward click should log 2.
      renderToolbar();
      fireEvent.click(screen.getByLabelText('Next milestone'));

      expect(reportAppInteractionMock).toHaveBeenCalledWith(
        'milestone_arrow_interaction_click',
        expect.objectContaining({
          current_milestone: 2,
          total_milestones: 3,
          direction: 'forward',
          interaction_location: 'milestone_progress_bar',
        })
      );
    });

    it('backward click logs the destination milestone (current - 1), not the origin', () => {
      const tab = makeJourneyTab();
      (tab.content as any).metadata.learningJourney.currentMilestone = 2;
      renderToolbar({ activeTab: tab });
      fireEvent.click(screen.getByLabelText('Previous milestone'));

      expect(reportAppInteractionMock).toHaveBeenCalledWith(
        'milestone_arrow_interaction_click',
        expect.objectContaining({
          current_milestone: 1,
          total_milestones: 3,
          direction: 'backward',
          interaction_location: 'milestone_progress_bar',
        })
      );
    });

    it('forward click from the last content milestone logs current_milestone = totalMilestones (the end-journey value)', () => {
      // currentMilestone = 3 of 3 → forward click lands on M3 (clamped).
      // In practice `canNavigateNext()` returns false here, but the Math.min
      // clamp is defence-in-depth and we still document the contract.
      const tab = makeJourneyTab();
      (tab.content as any).metadata.learningJourney.currentMilestone = 3;
      renderToolbar({ activeTab: tab });
      fireEvent.click(screen.getByLabelText('Next milestone'));

      expect(reportAppInteractionMock).toHaveBeenCalledWith(
        'milestone_arrow_interaction_click',
        expect.objectContaining({
          current_milestone: 3,
          total_milestones: 3,
          direction: 'forward',
        })
      );
    });

    it('backward click from M1 logs current_milestone = 0 (heading back to the cover overview)', () => {
      // The cover is `currentMilestone: 0` in the data model and is the
      // legitimate destination of a backward click from M1.
      const tab = makeJourneyTab();
      (tab.content as any).metadata.learningJourney.currentMilestone = 1;
      renderToolbar({ activeTab: tab });
      fireEvent.click(screen.getByLabelText('Previous milestone'));

      expect(reportAppInteractionMock).toHaveBeenCalledWith(
        'milestone_arrow_interaction_click',
        expect.objectContaining({
          current_milestone: 0,
          total_milestones: 3,
          direction: 'backward',
        })
      );
    });

    it('OpenExtraResource (Open in new tab) keeps the origin semantic — the user is reading this milestone, not navigating', () => {
      // currentMilestone = 1 → the Open button logs `current_milestone: 1`
      // (the page the user is currently viewing). This event is intentionally
      // unchanged by the destination-semantic flip on the arrow clicks.
      renderToolbar();
      fireEvent.click(screen.getByLabelText('Open'));

      expect(reportAppInteractionMock).toHaveBeenCalledWith(
        'open_extra_resource',
        expect.objectContaining({
          current_milestone: 1,
          total_milestones: 3,
        })
      );
    });
  });
});
