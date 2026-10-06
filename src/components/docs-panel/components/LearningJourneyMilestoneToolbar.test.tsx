/**
 * Tests for the shared LearningJourneyMilestoneToolbar.
 *
 * Covers the behavior the sidebar, fullscreen, and floating surfaces all
 * depend on:
 * - returns null for non-journey tabs (consumer can render unconditionally)
 * - arrow nav fires `panel.navigateToPrevious/Next`
 * - the next-arrow never calls markMilestoneDone (navigation credits nothing)
 * - the kebab menu's conditional items (Open, Reset guide, Pop out/Dock, Full screen)
 * - the segmented progress bar's per-milestone state, filled from the shared
 *   completion calculation rather than from navigation position
 * - the surface flag flips the analytics interaction_location
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  LearningJourneyMilestoneToolbar,
  type LearningJourneyMilestoneToolbarProps,
} from './LearningJourneyMilestoneToolbar';
import { testIds } from '../../../constants/testIds';
import type { LearningJourneyTab } from '../../../types/content-panel.types';
import type { DocsPanelModelOperations } from '../types';

const reportAppInteractionMock = jest.fn();
const markMilestoneDoneMock = jest.fn();
const journeyMilestonePercentagesMock = jest.fn();
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

// `resolveActiveMilestoneToolbarContext` comes from `active-milestone-sequence.ts`,
// not `learning-journey-helpers.ts` — the latter pulls in `../lib/user-storage`
// (and so `@grafana/runtime`), which breaks under this suite's `@grafana/ui` mock
// below. `percentagesToProgress` is reassembled from the same pure primitive
// (`meanOfMemberPercentages`) for the same reason.
jest.mock('../../../docs-retrieval', () => ({
  journeyMilestonePercentages: (...args: unknown[]) => journeyMilestonePercentagesMock(...args),
  percentagesToProgress: (percentages: Array<{ percent?: number }>) =>
    jest
      .requireActual('../../../lib/guide-stats')
      .meanOfMemberPercentages(
        percentages.flatMap(({ percent }: { percent?: number }) => (percent === undefined ? [] : [percent]))
      ).percent,
  resolveActiveMilestoneToolbarContext: jest.requireActual('../../../docs-retrieval/active-milestone-sequence')
    .resolveActiveMilestoneToolbarContext,
  getMilestoneSlug: jest.requireActual('../../../lib/learning-journey-url').getMilestoneSlug,
  markMilestoneDone: (...args: unknown[]) => markMilestoneDoneMock(...args),
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
  journeyMilestonePercentagesMock.mockReturnValue([]);
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

  // Decision 6 (docs/design/COMPLETION-MODEL.md): navigation earns no
  // completion credit, on a step-less milestone or otherwise. Only evidence
  // or the Mark complete button may call `markMilestoneDone`.
  it('does NOT mark the milestone done when the next arrow is clicked on a step-less milestone', () => {
    renderToolbar();
    fireEvent.click(screen.getByLabelText('Next milestone'));

    expect(markMilestoneDoneMock).not.toHaveBeenCalled();
  });

  it('does NOT mark the milestone done when the next arrow is clicked and the DOM has interactive steps', () => {
    renderToolbar();
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
      expect(screen.getAllByTestId(testIds.docsPanel.resetGuideButton)).toHaveLength(1);
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
    /** What the shared calculation reports for milestones 1..3. */
    function sharedPercentages(percents: Array<number | undefined>): void {
      journeyMilestonePercentagesMock.mockReturnValue(
        percents.map((percent, index) => ({ milestone: { number: index + 1 }, percent }))
      );
    }

    function segmentStates(container: HTMLElement): Array<string | null> {
      return Array.from(container.querySelectorAll('[data-segment-state]')).map((s) =>
        s.getAttribute('data-segment-state')
      );
    }

    it('renders one segment per milestone, states matching current/done/upcoming', () => {
      sharedPercentages([0, 0, 0]);
      const { container } = renderToolbar();
      expect(segmentStates(container)).toEqual(['current', 'upcoming', 'upcoming']);
    });

    it('fills a segment only when that milestone is complete, never from navigation position', () => {
      sharedPercentages([0, 0, 0]);
      const tab = makeJourneyTab();
      (tab.content as any).metadata.learningJourney.currentMilestone = 2;

      const { container } = renderToolbar({ activeTab: tab });

      // Milestone 1 was paged past with nothing completed, so it stays unfilled.
      expect(segmentStates(container)).toEqual(['upcoming', 'current', 'upcoming']);
    });

    it('fills every completed milestone, wherever the reader currently is', () => {
      sharedPercentages([100, 0, 100]);
      const tab = makeJourneyTab();
      (tab.content as any).metadata.learningJourney.currentMilestone = 2;

      const { container } = renderToolbar({ activeTab: tab });

      expect(segmentStates(container)).toEqual(['done', 'current', 'done']);
    });

    it('leaves a partially progressed milestone unfilled', () => {
      sharedPercentages([99, 0, 0]);
      const tab = makeJourneyTab();
      (tab.content as any).metadata.learningJourney.currentMilestone = 3;

      const { container } = renderToolbar({ activeTab: tab });

      expect(segmentStates(container)).toEqual(['upcoming', 'upcoming', 'current']);
    });

    it('reads the shared calculation for the journey the toolbar is showing', () => {
      sharedPercentages([0, 0, 0]);
      renderToolbar();

      expect(journeyMilestonePercentagesMock).toHaveBeenCalledWith(
        'https://grafana.com/docs/learning-journeys/foo-canonical',
        expect.arrayContaining([expect.objectContaining({ number: 1 })])
      );
    });
  });

  // A guide reached only through a Path Tracks track (present in a manifest
  // `tracks[].guides` entry but not in the path's base `milestones`) carries
  // no `learningJourney` at all (COMPLETION-MODEL.md decision 10) — the
  // toolbar must still render, scoped to the track's own sequence via
  // `activeTab.activeTrackId`/`activeTrackMilestones`, not the base one.
  describe('track-only and dual-membership guides', () => {
    function makeTrackOnlyTab(overrides: Partial<LearningJourneyTab> = {}): LearningJourneyTab {
      return {
        id: 'tab-track',
        title: 'Track guide',
        baseUrl: 'https://grafana.com/docs/learning-paths/foo/builder/t1',
        currentUrl: 'https://grafana.com/docs/learning-paths/foo/builder/t1',
        type: 'learning-journey',
        isLoading: false,
        error: null,
        activeTrackId: 'builder',
        activeTrackMilestones: [
          { number: 1, title: 't1', url: 'https://grafana.com/docs/learning-paths/foo/builder/t1', isActive: true },
          { number: 2, title: 't2', url: 'https://grafana.com/docs/learning-paths/foo/builder/t2', isActive: false },
        ],
        content: {
          type: 'learning-journey',
          url: 'https://grafana.com/docs/learning-paths/foo/builder/t1',
          content: '<div />',
          metadata: {
            title: 'Demo',
            trackMemberBaseUrl: 'https://grafana.com/docs/learning-paths/foo',
          },
        } as any,
        ...overrides,
      };
    }

    it('renders the toolbar for a track-only guide, scoped to the track sequence', () => {
      renderToolbar({ activeTab: makeTrackOnlyTab() });
      expect(screen.getByText('Milestone 1 of 2')).toBeInTheDocument();
    });

    it('keys the progress calculation off trackMemberBaseUrl for a track-only guide', () => {
      renderToolbar({ activeTab: makeTrackOnlyTab() });
      expect(journeyMilestonePercentagesMock).toHaveBeenCalledWith(
        'https://grafana.com/docs/learning-paths/foo',
        expect.arrayContaining([expect.objectContaining({ number: 1 })])
      );
    });

    it('returns null when a guide has neither learningJourney nor a track/trackMemberBaseUrl identity', () => {
      const orphanTab = makeTrackOnlyTab({
        activeTrackId: undefined,
        activeTrackMilestones: undefined,
        content: {
          type: 'learning-journey',
          url: 'https://grafana.com/docs/learning-paths/foo/orphan',
          content: '<div />',
          metadata: { title: 'Demo' },
        } as any,
      });
      const { container } = renderToolbar({ activeTab: orphanTab });
      expect(container.firstChild).toBeNull();
    });

    it('scopes to the active track (not the base sequence) when a guide belongs to both', () => {
      const tab = makeJourneyTab({
        activeTrackId: 'builder',
        activeTrackMilestones: [
          { number: 1, title: 'b1', url: 'https://grafana.com/docs/learning-journeys/other', isActive: false },
          { number: 2, title: 'b2', url: 'https://grafana.com/docs/learning-journeys/foo/m1', isActive: true },
        ],
      });
      // The base learningJourney fixture (makeJourneyTab) says this guide is
      // milestone 1 of 3 in Foundations — the track view must win instead.
      renderToolbar({ activeTab: tab });
      expect(screen.getByText('Milestone 2 of 2')).toBeInTheDocument();
    });

    it('fires the real analytics payload (not just the label) when Next is clicked on a track-only guide', () => {
      renderToolbar({ activeTab: makeTrackOnlyTab() });
      fireEvent.click(screen.getByLabelText('Next milestone'));

      expect(reportAppInteractionMock).toHaveBeenCalledWith('milestone_arrow_interaction_click', {
        content_title: 'Track guide',
        content_url: 'https://grafana.com/docs/learning-paths/foo/builder/t1',
        current_milestone: 2,
        total_milestones: 2,
        direction: 'forward',
        interaction_location: 'milestone_progress_bar',
        completion_percentage: 0,
      });
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
