// Empty or corrupted tab URLs must fail the tab and report an error.

// ---------------------------------------------------------------------------
// Mocks — must be declared before any import that triggers docs-panel.tsx
// ---------------------------------------------------------------------------

jest.mock('@grafana/scenes', () => {
  class SceneObjectBase {
    state: Record<string, unknown>;
    constructor(state: Record<string, unknown>) {
      this.state = { ...state };
    }
    setState(partial: Record<string, unknown>) {
      this.state = { ...this.state, ...partial };
    }
  }
  return { SceneObjectBase, SceneComponentProps: {} };
});

jest.mock('@grafana/runtime', () => ({
  config: { bootData: { user: { id: 1 } } },
  getAppEvents: jest.fn(() => ({ publish: jest.fn(), subscribe: jest.fn() })),
  locationService: { push: jest.fn(), getLocation: jest.fn(() => ({ pathname: '/', search: '' })) },
}));

jest.mock('@grafana/data', () => ({
  GrafanaTheme2: {},
  usePluginContext: jest.fn(() => ({ meta: { jsonData: {} } })),
}));

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string) => fallback,
}));

jest.mock('@grafana/ui', () => ({
  IconButton: 'IconButton',
  Alert: 'Alert',
  Icon: 'Icon',
  useStyles2: jest.fn(() => ({})),
  Button: 'Button',
  ButtonGroup: 'ButtonGroup',
  Dropdown: 'Dropdown',
  Menu: 'Menu',
}));

jest.mock('./context-panel', () => ({
  ContextPanel: class MockContextPanel {},
}));

const mockFetchContent = jest.fn();
jest.mock('../../docs-retrieval', () => ({
  fetchContent: (...args: unknown[]) => mockFetchContent(...args),
  ContentRenderer: jest.fn(),
  getNextMilestoneUrlFromContent: jest.fn(),
  getPreviousMilestoneUrlFromContent: jest.fn(),
  getNextMilestoneIdFromContent: jest.fn(),
  getPreviousMilestoneIdFromContent: jest.fn(),
  getJourneyProgress: jest.fn(),
  journeyProgressFromMilestones: jest.fn(() => 0),
  setJourneyCompletionPercentage: jest.fn(),
  getMilestoneSlug: jest.fn(),
  markMilestoneDone: jest.fn(),
  isLastMilestone: jest.fn(),
  setPackageResolver: jest.fn(),
  injectJourneyExtrasIntoJsonGuide: jest.fn(),
  isPackageContentUrl: jest.fn(() => false),
  fetchPackageInfoFromUrl: jest.fn(async () => undefined),
}));

jest.mock('../../package-engine', () => ({
  createCompositeResolver: jest.fn(),
}));

jest.mock('../completion-panel/CompletionPanel', () => ({
  CompletionPanel: ({ nextModule, onContinue }: import('../completion-panel/CompletionPanel').CompletionPanelProps) =>
    nextModule
      ? require('react').createElement('button', { onClick: onContinue }, `Continue to ${nextModule.title}`)
      : null,
}));

jest.mock('../../lib/user-storage', () => ({
  interactiveCompletionStorage: { getAll: jest.fn(async () => ({})) },
  tabStorage: {
    getTabs: jest.fn(),
    setTabs: jest.fn(),
    getActiveTab: jest.fn(),
    setActiveTab: jest.fn(),
    clear: jest.fn(),
  },
  useUserStorage: jest.fn(() => ({ value: null, setValue: jest.fn() })),
  interactiveStepStorage: { get: jest.fn(), set: jest.fn() },
}));

jest.mock('../../lib/analytics', () => ({
  setupScrollTracking: jest.fn(),
  reportAppInteraction: jest.fn(),
  createInteractionName: jest.fn((type: string) => `pathfinder_${type}`),
  UserInteraction: { DocsPanelInteraction: 'docs_panel_interaction', OpenResourceClick: 'open_resource_click' },
  AnalyticsContentType: { LearningJourney: 'learning-journey' },
  getContentTypeForAnalytics: jest.fn(),
}));

jest.mock('../../interactive-engine', () => ({
  useInteractiveElements: jest.fn(() => ({ elements: [], cleanup: jest.fn() })),
  NavigationManager: class {},
}));

jest.mock('./keyboard-shortcuts.hook', () => ({
  useKeyboardShortcuts: jest.fn(),
}));

jest.mock('./link-handler.hook', () => ({
  useLinkClickHandler: jest.fn(() => jest.fn()),
}));

jest.mock('../../security', () => ({
  parseUrlSafely: jest.fn((url: string) => {
    try {
      return new URL(url);
    } catch {
      return null;
    }
  }),
}));

jest.mock('../../global-state/link-interception', () => ({
  linkInterceptionState: { addToQueue: jest.fn() },
}));

jest.mock('../../global-state/panel-mode', () => ({
  panelModeManager: { getMode: jest.fn(() => 'sidebar'), setMode: jest.fn() },
}));

jest.mock('../LearningPaths', () => ({
  BadgeUnlockedToast: 'BadgeUnlockedToast',
  getBadgeById: jest.fn(),
}));

jest.mock('../../learning-paths', () => ({
  getBadgeById: jest.fn(),
}));

jest.mock('../../styles/docs-panel.styles', () => ({
  getStyles: jest.fn(() => ({})),
  addGlobalModalStyles: jest.fn(),
}));

jest.mock('../../styles/content-html.styles', () => ({
  journeyContentHtml: jest.fn(() => ''),
  docsContentHtml: jest.fn(() => ''),
}));

jest.mock('../../styles/interactive.styles', () => ({
  getInteractiveStyles: jest.fn(() => ({})),
}));

jest.mock('../../styles/prism.styles', () => ({
  getPrismStyles: jest.fn(() => ''),
}));

jest.mock('../LiveSession', () => ({
  PresenterControls: 'PresenterControls',
  AttendeeJoin: 'AttendeeJoin',
  HandRaiseButton: 'HandRaiseButton',
  HandRaiseIndicator: 'HandRaiseIndicator',
  HandRaiseQueue: 'HandRaiseQueue',
}));

jest.mock('../../integrations/workshop', () => ({
  SessionProvider: 'SessionProvider',
  useSession: jest.fn(() => ({})),
  ActionReplaySystem: 'ActionReplaySystem',
  ActionCaptureSystem: 'ActionCaptureSystem',
}));

jest.mock('../../integrations/workshop/flags', () => ({
  FOLLOW_MODE_ENABLED: false,
}));

jest.mock('./components', () => ({
  LoadingIndicator: 'LoadingIndicator',
  ErrorDisplay: 'ErrorDisplay',
  TabBarActions: 'TabBarActions',
  ModalBackdrop: 'ModalBackdrop',
}));

jest.mock('./utils', () => ({
  ...jest.requireActual('./utils/tab-gates'),
  isDocsLikeTab: jest.fn(),
  shouldUseDocsLoader: jest.fn(() => false),
  getTranslatedTitle: jest.fn((t: string) => t),
  restoreTabsFromStorage: jest.fn(),
  restoreActiveTabFromStorage: jest.fn(),
  mergeRestoredTabsWithExisting: jest.requireActual('./utils/tab-storage-restore').mergeRestoredTabsWithExisting,
  isGrafanaDocsUrl: jest.fn(),
  cleanDocsUrl: jest.fn((url: string) => url),
  loadDocsTabContentResult: jest.fn(),
  ...jest.requireActual('./utils/tab-kinds'),
  ...jest.requireActual('./utils/tab-state-transitions'),
  ...jest.requireActual('./utils/docs-load-finalizer'),
}));

jest.mock('./hooks', () => ({
  useBadgeCelebrationQueue: jest.fn(() => []),
  useTabOverflow: jest.fn(() => ({ showLeft: false, showRight: false })),
  useScrollPositionPreservation: jest.fn(),
  useContentReset: jest.fn(),
}));

jest.mock('../../utils/dev-mode', () => ({
  isDevModeEnabled: jest.fn(() => false),
}));

jest.mock('../SkeletonLoader', () => ({
  SkeletonLoader: 'SkeletonLoader',
}));

jest.mock('../../constants/testIds', () => ({
  testIds: { docsPanel: {} },
}));

jest.mock('../../types/package.types', () => ({
  getPackageRenderType: jest.fn(),
}));

jest.mock('../../hooks', () => ({}));

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import ReaderCompletionPanel from '../completion-panel/ReaderCompletionPanel';
import { CombinedLearningJourneyPanel } from './docs-panel';
import { loadDocsTabContentResult, shouldUseDocsLoader } from './utils';
import {
  getJourneyProgress,
  setJourneyCompletionPercentage,
  getNextMilestoneUrlFromContent,
  getPreviousMilestoneUrlFromContent,
  getNextMilestoneIdFromContent,
  getPreviousMilestoneIdFromContent,
} from '../../docs-retrieval';
import type { PreparedRawContent } from '../../types/content.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeTab = (id: string) => ({
  id,
  type: 'docs' as const,
  title: id,
  baseUrl: '',
  currentUrl: '',
  content: null,
  isLoading: false,
  error: null,
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const preparedContent: PreparedRawContent = {
  content: '{"id":"g","title":"g","blocks":[]}',
  countingSource: { kind: 'pre-inlining', guideJson: '{"id":"g","title":"g","blocks":[]}' },
  metadata: { title: 'g' },
  type: 'interactive',
  url: 'bundled:prepared',
  lastFetched: '2026-07-28T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.each([false, true])('milestone navigation failure with docs loader %s', (useDocsLoader) => {
  beforeEach(() => {
    jest.clearAllMocks();
    (shouldUseDocsLoader as jest.Mock).mockReturnValue(useDocsLoader);
    (getNextMilestoneUrlFromContent as jest.Mock).mockReturnValue('bundled:next');
  });

  const makePanel = () => {
    const panel = new CombinedLearningJourneyPanel();
    panel.setState({
      tabs: [{ ...makeTab('journey-tab'), content: preparedContent }],
      activeTabId: 'journey-tab',
    });
    return panel;
  };

  it('rejects a failed next-module load while keeping the panel mounted, then allows retry', async () => {
    const panel = makePanel();
    const fetch = useDocsLoader ? (loadDocsTabContentResult as jest.Mock) : mockFetchContent;
    let finish!: (result: unknown) => void;
    fetch.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));

    const navigation = panel.navigateToNextMilestone({ rejectOnError: true });
    const rejected = expect(navigation).rejects.toThrow('Failed to load');
    expect(panel.getActiveTab()).toMatchObject({ content: preparedContent, isLoading: false, error: null });

    finish({ content: null, error: 'Network unavailable', errorType: 'other' });
    await rejected;
    expect(panel.getActiveTab()).toMatchObject({ content: preparedContent, isLoading: false, error: null });

    const nextContent = { ...preparedContent, url: 'bundled:next' };
    fetch.mockResolvedValueOnce({ content: nextContent });
    await expect(panel.navigateToNextMilestone({ rejectOnError: true })).resolves.toBeUndefined();
    expect(panel.getActiveTab()).toMatchObject({
      content: nextContent,
      currentUrl: 'bundled:next',
      isLoading: false,
      error: null,
    });
  });

  it('rejects thrown fetch failures without replacing the current content with a tab error', async () => {
    const panel = makePanel();
    const fetch = useDocsLoader ? (loadDocsTabContentResult as jest.Mock) : mockFetchContent;
    fetch.mockRejectedValueOnce(new Error('Offline'));

    await expect(panel.navigateToNextMilestone({ rejectOnError: true })).rejects.toThrow('Failed to load');
    expect(panel.getActiveTab()).toMatchObject({ content: preparedContent, isLoading: false, error: null });
  });

  it('preserves non-rejecting tab-error behavior for existing navigation and load callers', async () => {
    const panel = makePanel();
    const fetch = useDocsLoader ? (loadDocsTabContentResult as jest.Mock) : mockFetchContent;
    fetch.mockResolvedValue({ content: null, error: 'Network unavailable', errorType: 'other' });

    await expect(panel.navigateToNextMilestone()).resolves.toBeUndefined();
    expect(panel.getActiveTab()).toMatchObject({ error: 'Network unavailable', isLoading: false });
    await expect(panel.loadTab('journey-tab', 'bundled:next')).resolves.toBeUndefined();
    expect(panel.getActiveTab()).toMatchObject({ error: 'Network unavailable', isLoading: false });
  });
});

describe('completion card destination agrees with real milestone navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (shouldUseDocsLoader as jest.Mock).mockReturnValue(false);
    const helpers = jest.requireActual('../../docs-retrieval/learning-journey-helpers');
    (getNextMilestoneUrlFromContent as jest.Mock).mockImplementation(helpers.getNextMilestoneUrl);
    (getNextMilestoneIdFromContent as jest.Mock).mockImplementation(helpers.getNextMilestoneId);
  });

  afterEach(() => {
    (getNextMilestoneUrlFromContent as jest.Mock).mockReset();
    (getNextMilestoneIdFromContent as jest.Mock).mockReset();
  });

  it.each([false, true])(
    'loads the advertised unlocked destination after consecutive placeholders (track-only %s)',
    async (trackOnly) => {
      const milestones = [
        { id: 'one', title: 'One', url: 'bundled:one', number: 1, isActive: true },
        { title: 'Two', url: '', number: 2, isActive: false, isLocked: true },
        { title: 'Three', url: '', number: 3, isActive: false, isLocked: true },
        { id: 'four', title: 'Four', url: 'bundled:four', number: 4, isActive: false },
      ];
      const content: PreparedRawContent = {
        ...preparedContent,
        type: trackOnly ? 'interactive' : 'learning-journey',
        url: 'bundled:one',
        metadata: trackOnly
          ? { title: 'One', trackMemberBaseUrl: 'bundled:path' }
          : {
              title: 'One',
              learningJourney: {
                baseUrl: 'bundled:path',
                currentMilestone: 1,
                totalMilestones: milestones.length,
                milestones,
              },
            },
      };
      const panel = new CombinedLearningJourneyPanel();
      panel.setState({
        tabs: [
          {
            ...makeTab('journey-tab'),
            content,
            ...(trackOnly && { activeTrackId: 'selected', activeTrackMilestones: milestones }),
          },
        ],
        activeTabId: 'journey-tab',
      });
      const nextContent = { ...preparedContent, url: 'bundled:four' };
      mockFetchContent.mockResolvedValueOnce({ content: nextContent });
      const load = jest.spyOn(panel, 'loadTab');
      render(
        React.createElement(ReaderCompletionPanel, {
          content,
          sequence: { currentMilestone: 1, milestones },
          celebrating: false,
          onContinue: () => panel.navigateToNextMilestone({ rejectOnError: true }),
        })
      );

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Continue to Four' }));
      });

      expect(load).toHaveBeenCalledWith('journey-tab', 'bundled:four', {
        rejectOnError: true,
        explicitGuideId: 'four',
      });
      expect(mockFetchContent).toHaveBeenCalledWith('bundled:four', expect.anything());
      expect(panel.getActiveTab()).toMatchObject({ content: nextContent, currentUrl: 'bundled:four' });
    }
  );
});

describe('CombinedLearningJourneyPanel.loadTab — empty tab URL', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fails the tab and never calls fetchContent when the URL is empty', async () => {
    const panel = new CombinedLearningJourneyPanel();
    panel.setState({ tabs: [makeTab('broken-tab')], activeTabId: 'broken-tab' });

    await panel.loadTab('broken-tab', '');

    expect(mockFetchContent).not.toHaveBeenCalled();
    const tab = (panel as any).state.tabs.find((t: any) => t.id === 'broken-tab');
    expect(tab.error).toBeTruthy();
    expect(tab.isLoading).toBe(false);
  });

  it('fails the tab for a whitespace-only URL the same way', async () => {
    const panel = new CombinedLearningJourneyPanel();
    panel.setState({ tabs: [makeTab('broken-tab')], activeTabId: 'broken-tab' });

    await panel.loadTab('broken-tab', '   ');

    const tab = (panel as any).state.tabs.find((t: any) => t.id === 'broken-tab');
    expect(tab.error).toBeTruthy();
  });
});

// The toolbar's Next/Previous arrows and Alt+arrow shortcuts are a click
// just like GuideList's row or the cover CTA — the target milestone's id is
// already known at the call site, so it must reach loadTab's
// explicitGuideId.
describe('CombinedLearningJourneyPanel — milestone toolbar navigation threads explicitGuideId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps next-module navigation pending until the loader settles', async () => {
    const panel = new CombinedLearningJourneyPanel();
    const content = { url: 'bundled:one', metadata: {} };
    jest
      .spyOn(panel, 'getActiveTab')
      .mockReturnValue({ id: 'guide', content } as ReturnType<typeof panel.getActiveTab>);
    jest.requireMock('../../docs-retrieval').getNextMilestoneUrlFromContent.mockReturnValue('bundled:two');
    let finish!: () => void;
    jest.spyOn(panel, 'loadTab').mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      })
    );
    let settled = false;
    const navigation = panel.navigateToNextMilestone().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    finish();
    await navigation;
    expect(settled).toBe(true);
  });

  it('navigateToNextMilestone passes the next milestone id as explicitGuideId', async () => {
    const panel = new CombinedLearningJourneyPanel();
    const tab = { ...makeTab('journey-tab'), content: { url: 'x', metadata: {} } };
    panel.setState({ tabs: [tab as any], activeTabId: 'journey-tab' });

    (getNextMilestoneUrlFromContent as jest.Mock).mockReturnValue('https://example.com/next/');
    (getNextMilestoneIdFromContent as jest.Mock).mockReturnValue('milestone-two');
    const loadTabSpy = jest.spyOn(panel, 'loadTab').mockResolvedValue(undefined);

    await panel.navigateToNextMilestone();

    expect(loadTabSpy).toHaveBeenCalledWith('journey-tab', 'https://example.com/next/', {
      explicitGuideId: 'milestone-two',
    });
  });

  it('navigateToPreviousMilestone passes the previous milestone id as explicitGuideId', async () => {
    const panel = new CombinedLearningJourneyPanel();
    const tab = { ...makeTab('journey-tab'), content: { url: 'x', metadata: {} } };
    panel.setState({ tabs: [tab as any], activeTabId: 'journey-tab' });

    (getPreviousMilestoneUrlFromContent as jest.Mock).mockReturnValue('https://example.com/prev/');
    (getPreviousMilestoneIdFromContent as jest.Mock).mockReturnValue('milestone-one');
    const loadTabSpy = jest.spyOn(panel, 'loadTab').mockResolvedValue(undefined);

    await panel.navigateToPreviousMilestone();

    expect(loadTabSpy).toHaveBeenCalledWith('journey-tab', 'https://example.com/prev/', {
      explicitGuideId: 'milestone-one',
    });
  });

  // Previous falling back to the cover page has no guide id of its own
  // (getPreviousMilestoneIdFromContent returns undefined) — explicitGuideId
  // must be forwarded as undefined, not omitted, so the load still lands on
  // the correct no-explicit-id cover-page default.
  it('navigateToPreviousMilestone forwards an undefined explicitGuideId when falling back to the cover page', async () => {
    const panel = new CombinedLearningJourneyPanel();
    const tab = { ...makeTab('journey-tab'), content: { url: 'x', metadata: {} } };
    panel.setState({ tabs: [tab as any], activeTabId: 'journey-tab' });

    (getPreviousMilestoneUrlFromContent as jest.Mock).mockReturnValue('https://example.com/cover/');
    (getPreviousMilestoneIdFromContent as jest.Mock).mockReturnValue(undefined);
    const loadTabSpy = jest.spyOn(panel, 'loadTab').mockResolvedValue(undefined);

    await panel.navigateToPreviousMilestone();

    expect(loadTabSpy).toHaveBeenCalledWith('journey-tab', 'https://example.com/cover/', {
      explicitGuideId: undefined,
    });
  });
});

// A track-only guide is only ever reached by clicking it FROM its own
// path's cover, in the same tab — so the tab's OUTGOING content, right up
// until this load overwrites it, is that cover's own learningJourney (or,
// for a track guide clicked from another track guide, that guide's own
// trackMemberBaseUrl). Carrying it forward as knownBaseUrl lets
// fetchPackageContent recover a track-only guide's completion identity
// even if THIS load's own independent re-resolve of the path's id
// transiently fails.
describe('CombinedLearningJourneyPanel.loadDocsTabContent — knownBaseUrl fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (loadDocsTabContentResult as jest.Mock).mockResolvedValue({ content: null, error: 'x', errorType: 'other' });
  });

  it("carries the outgoing cover content's learningJourney.baseUrl forward as knownBaseUrl", async () => {
    const panel = new CombinedLearningJourneyPanel();
    const coverTab = {
      ...makeTab('journey-tab'),
      content: {
        url: 'bundled:the-path/content.json',
        metadata: {
          learningJourney: {
            baseUrl: 'bundled:the-path/content.json',
            currentMilestone: 0,
            totalMilestones: 1,
            milestones: [],
          },
        },
      },
    };
    panel.setState({ tabs: [coverTab as any], activeTabId: 'journey-tab' });

    await panel.loadTab('journey-tab', 'bundled:t-only/content.json', {
      packageInfo: { packageManifest: { id: 'the-path', type: 'path' } },
      explicitGuideId: 't-only',
    });

    expect(loadDocsTabContentResult as jest.Mock).toHaveBeenCalledWith(
      'bundled:t-only/content.json',
      expect.objectContaining({ knownBaseUrl: 'bundled:the-path/content.json' })
    );
  });

  it("carries the outgoing track-only content's trackMemberBaseUrl forward as knownBaseUrl", async () => {
    const panel = new CombinedLearningJourneyPanel();
    const trackOnlyTab = {
      ...makeTab('journey-tab'),
      content: {
        url: 'bundled:t-only-a/content.json',
        metadata: { trackMemberBaseUrl: 'bundled:the-path/content.json' },
      },
    };
    panel.setState({ tabs: [trackOnlyTab as any], activeTabId: 'journey-tab' });

    await panel.loadTab('journey-tab', 'bundled:t-only-b/content.json', {
      packageInfo: { packageManifest: { id: 'the-path', type: 'path' } },
      explicitGuideId: 't-only-b',
    });

    expect(loadDocsTabContentResult as jest.Mock).toHaveBeenCalledWith(
      'bundled:t-only-b/content.json',
      expect.objectContaining({ knownBaseUrl: 'bundled:the-path/content.json' })
    );
  });
});

describe('CombinedLearningJourneyPanel.openDocsPage — prepared (one-fetch) launch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('commits prepared content with no second fetch on the journey loader path', async () => {
    (shouldUseDocsLoader as jest.Mock).mockReturnValue(false);
    const panel = new CombinedLearningJourneyPanel();
    panel.setState({ tabs: [], activeTabId: 'recommendations' });

    const tabId = await panel.openDocsPage('bundled:prepared', 'Prepared', {
      source: 'home_page',
      preparedContent,
    });
    await flush();

    expect(mockFetchContent).not.toHaveBeenCalled();
    expect(loadDocsTabContentResult as jest.Mock).not.toHaveBeenCalled();

    const tab = (panel as any).state.tabs.find((t: any) => t.id === tabId);
    expect(tab.content).toEqual({
      ...preparedContent,
      loadContext: expect.objectContaining({ loadId: expect.any(String), source: 'bundled' }),
    });
    expect(tab.isLoading).toBe(false);
    expect(tab.error).toBeNull();
  });

  it('commits prepared content with no second fetch on the docs/package loader path', async () => {
    (shouldUseDocsLoader as jest.Mock).mockReturnValue(true);
    const panel = new CombinedLearningJourneyPanel();
    panel.setState({ tabs: [], activeTabId: 'recommendations' });

    const tabId = await panel.openDocsPage('bundled:prepared', 'Prepared', {
      source: 'home_page',
      preparedContent,
    });
    await flush();

    expect(mockFetchContent).not.toHaveBeenCalled();
    expect(loadDocsTabContentResult as jest.Mock).not.toHaveBeenCalled();

    const tab = (panel as any).state.tabs.find((t: any) => t.id === tabId);
    expect(tab.content).toEqual({
      ...preparedContent,
      loadContext: expect.objectContaining({ loadId: expect.any(String), source: 'bundled' }),
    });
    expect(tab.isLoading).toBe(false);
    expect(tab.error).toBeNull();
  });

  it('opens a path cover on the assigned track when packageInfo carries a trackId', async () => {
    (shouldUseDocsLoader as jest.Mock).mockReturnValue(true);
    const panel = new CombinedLearningJourneyPanel();
    panel.setState({ tabs: [], activeTabId: 'recommendations' });

    const tabId = await panel.openDocsPage('bundled:prepared', 'Prepared', {
      source: 'home_page',
      preparedContent,
      packageInfo: { packageId: 'path-1', packageManifest: { type: 'path', id: 'path-1' }, trackId: 'ops' },
    });
    await flush();

    const tab = (panel as any).state.tabs.find((t: any) => t.id === tabId);
    expect(tab).toMatchObject({ activeTrackId: 'ops', activeTrackPathId: 'path-1' });
  });
});

describe('CombinedLearningJourneyPanel.loadTab — learning-journey completion seam', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('records journey completion as never attempt-eligible', async () => {
    (shouldUseDocsLoader as jest.Mock).mockReturnValue(false);
    (getJourneyProgress as jest.Mock).mockReturnValue(100);
    mockFetchContent.mockResolvedValue({
      content: {
        content: '<p>cover</p>',
        metadata: { title: 'Journey', learningJourney: { baseUrl: 'bundled:journey' } },
        type: 'learning-journey',
        url: 'bundled:journey',
        lastFetched: '2026-07-28T00:00:00.000Z',
      },
    });
    const panel = new CombinedLearningJourneyPanel();
    panel.setState({
      tabs: [{ ...makeTab('journey-tab'), type: 'learning-journey' as const, title: 'Journey' }],
      activeTabId: 'journey-tab',
    });

    await panel.loadTab('journey-tab', 'bundled:journey');

    expect(setJourneyCompletionPercentage).toHaveBeenCalledWith(
      'bundled:journey',
      100,
      expect.objectContaining({ guideTitle: 'Journey' }),
      { attemptEligible: false }
    );
  });
});
