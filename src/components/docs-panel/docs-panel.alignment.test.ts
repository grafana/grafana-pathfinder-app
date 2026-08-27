/**
 * Tests for CombinedLearningJourneyPanel implied-0th-step alignment behavior.
 *
 * The prompt is evaluated once at launch (in `loadDocsTabContent`) and
 * resolved by `confirmAlignment` / `dismissAlignment`. There is no reactive
 * re-evaluation on location changes — guides that step the user across
 * pages must not re-surface the prompt mid-flow.
 */

// ---------------------------------------------------------------------------
// Mocks — must be declared before any import that triggers docs-panel.tsx
// ---------------------------------------------------------------------------

const mockLoadDocsTabContentResult = jest.fn();
const mockLocationServicePush = jest.fn();
const mockGetLocation = jest.fn(() => ({ pathname: '/explore', search: '' }));
const mockReportAppInteraction = jest.fn();

jest.mock('@grafana/scenes', () => {
  class SceneObjectBase {
    state: Record<string, unknown>;
    constructor(state: Record<string, unknown>) {
      this.state = { ...state };
    }
    setState(partial: Record<string, unknown>) {
      this.state = { ...this.state, ...partial };
    }
    useState() {
      return this.state;
    }
  }
  return { SceneObjectBase, SceneComponentProps: {} };
});

jest.mock('@grafana/runtime', () => ({
  config: { bootData: { user: { id: 1 } } },
  getAppEvents: jest.fn(() => ({ publish: jest.fn(), subscribe: jest.fn() })),
  locationService: {
    push: (...args: unknown[]) => mockLocationServicePush(...args),
    getLocation: () => mockGetLocation(),
  },
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

jest.mock('../../docs-retrieval', () => ({
  fetchContent: jest.fn(),
  ContentRenderer: jest.fn(),
  getNextMilestoneUrlFromContent: jest.fn(),
  getPreviousMilestoneUrlFromContent: jest.fn(),
  getJourneyProgress: jest.fn(() => 0),
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

jest.mock('../../lib/user-storage', () => ({
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
  reportAppInteraction: (...args: unknown[]) => mockReportAppInteraction(...args),
  UserInteraction: {
    AlignmentPromptShown: 'alignment_prompt_shown',
    AlignmentPromptConfirmed: 'alignment_prompt_confirmed',
    AlignmentPromptDismissed: 'alignment_prompt_dismissed',
    OpenResourceClick: 'open_resource_click',
  },
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

// Pass-through that captures the loader's resolved outcome.
const mockWithGuideOpenAction = jest.fn(async (_url: string, work: () => Promise<unknown>) => work());
jest.mock('../../lib/telemetry', () => ({
  withGuideOpenAction: (...args: [string, () => Promise<unknown>]) => mockWithGuideOpenAction(...args),
  recordPanelReady: jest.fn(),
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
  AlignmentPrompt: 'AlignmentPrompt',
}));

jest.mock('./utils', () => ({
  isDocsLikeTab: jest.fn(),
  shouldUseDocsLoader: jest.fn(),
  getTranslatedTitle: jest.fn((t: string) => t),
  restoreTabsFromStorage: jest.fn(),
  restoreActiveTabFromStorage: jest.fn(),
  mergeRestoredTabsWithExisting: jest.requireActual('./utils/tab-storage-restore').mergeRestoredTabsWithExisting,
  isGrafanaDocsUrl: jest.fn(),
  cleanDocsUrl: jest.fn((url: string) => url),
  loadDocsTabContentResult: (...args: unknown[]) => mockLoadDocsTabContentResult(...args),
  ...jest.requireActual('./utils/tab-kinds'),
  ...jest.requireActual('./utils/tab-gates'),
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
  testIds: { docsPanel: {}, alignmentPrompt: {} },
}));

jest.mock('../../types/package.types', () => ({
  getPackageRenderType: jest.fn(() => 'interactive'),
}));

jest.mock('../../hooks', () => ({}));

// Mock the bundled index so the resolver fallback is deterministic.
jest.mock(
  '../../bundled-interactives/index.json',
  () => ({
    interactives: [{ id: 'connections-guide', url: ['/connections'] }, { id: 'no-url-guide' }],
  }),
  { virtual: true }
);

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import { CombinedLearningJourneyPanel } from './docs-panel';
import type { LaunchSource } from '../../recovery';
import type { RawContent } from '../../types/content.types';
import type { PackageOpenInfo } from '../../types/content-panel.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContentResult(overrides?: { startingLocation?: string }) {
  return {
    content: {
      url: 'bundled:connections-guide/content.json',
      type: 'interactive',
      content: [],
      metadata: {
        ...(overrides?.startingLocation ? { packageManifest: { startingLocation: overrides.startingLocation } } : {}),
      },
    },
  };
}

/**
 * A private App Platform guide as the `backend-guide:` loader shapes it: the
 * synthesized manifest spreads `spec.manifest` through, so `startingLocation`
 * arrives under `additionalFields` (the CRD prunes it at the top level).
 */
function makeAppPlatformContentResult(startingLocation?: string) {
  return {
    content: {
      url: 'backend-guide:my-private-guide',
      type: 'interactive',
      content: [],
      metadata: {
        packageManifest: {
          type: 'guide',
          repository: 'app-platform',
          ...(startingLocation ? { additionalFields: { startingLocation } } : {}),
        },
      },
    },
  };
}

async function openTabAndLoad(
  panel: CombinedLearningJourneyPanel,
  url: string,
  source: string | null,
  packageInfo?: { packageManifest?: Record<string, unknown> }
): Promise<string> {
  // The fixtures pass valid LaunchSource literals; we cast at the boundary
  // to keep the test helper signature ergonomic (`string | null`) while the
  // production API enforces the typed union.
  return panel.openDocsPage(url, 'Test Guide', {
    source: (source ?? undefined) as LaunchSource | undefined,
    packageInfo: packageInfo as PackageOpenInfo | undefined,
  });
}

function getTab(panel: CombinedLearningJourneyPanel, tabId: string) {
  return ((panel as any).state.tabs as Array<{ id: string }>).find((t) => t.id === tabId) as any;
}

function makeJourneyContent(url = 'bundled:fetched/content.json'): RawContent {
  return {
    content: '{"id":"guide","title":"Guide","blocks":[]}',
    type: 'interactive',
    url,
    lastFetched: '2026-08-27T00:00:00.000Z',
    metadata: {
      title: 'Fetched guide',
      learningJourney: {
        currentMilestone: 1,
        totalMilestones: 2,
        milestones: [],
        baseUrl: 'bundled:fetched',
      },
      packageManifest: { startingLocation: '/alerting' },
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CombinedLearningJourneyPanel — implied-0th-step alignment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLocation.mockReturnValue({ pathname: '/explore', search: '' });
    jest.requireMock('../../global-state/panel-mode').panelModeManager.getMode.mockReturnValue('sidebar');
    jest.requireMock('../../types/package.types').getPackageRenderType.mockReturnValue('interactive');
    // openDocsPage routes through loadTab → shouldUseDocsLoader; force the docs loader.
    jest.requireMock('./utils').shouldUseDocsLoader.mockReturnValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('loadDocsTabContent — pendingAlignment decision', () => {
    it('commits the complete prompted package journey once before reporting the prompt', async () => {
      const fetchedContent = makeJourneyContent();
      const packageInfo = {
        packageId: 'connections-guide',
        packageManifest: { type: 'path', startingLocation: '/connections' },
      };
      const events: string[] = [];
      jest.spyOn(Date, 'now').mockReturnValue(123);
      jest.requireMock('../../types/package.types').getPackageRenderType.mockReturnValue('learning-journey');
      mockLoadDocsTabContentResult.mockResolvedValue({ content: fetchedContent });
      mockReportAppInteraction.mockImplementation(() => events.push('telemetry'));
      const panel = new CombinedLearningJourneyPanel();
      const originalSetState = panel.setState.bind(panel);
      const setState = jest.spyOn(panel, 'setState').mockImplementation((patch) => {
        events.push('commit');
        originalSetState(patch);
      });
      const save = jest.spyOn(panel as any, 'saveTabsToStorage').mockImplementation(() => events.push('save'));

      const tabId = await openTabAndLoad(panel, 'bundled:launch/content.json', 'home_page', packageInfo);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(getTab(panel, tabId)).toEqual({
        id: tabId,
        title: 'Test Guide',
        baseUrl: 'bundled:launch/content.json',
        currentUrl: 'bundled:fetched/content.json',
        content: fetchedContent,
        isLoading: false,
        error: null,
        type: 'learning-journey',
        packageInfo,
        pathContext: { learningJourney: fetchedContent.metadata.learningJourney },
        pendingAlignment: {
          startingLocation: '/connections',
          currentPath: '/explore',
          launchSource: 'home_page',
          decidedAt: 123,
        },
      });
      expect(setState).toHaveBeenCalledTimes(3);
      expect(save).toHaveBeenCalledTimes(2);
      expect(mockReportAppInteraction).toHaveBeenCalledTimes(1);
      expect(mockReportAppInteraction).toHaveBeenCalledWith('alignment_prompt_shown', {
        guide_url: 'bundled:launch/content.json',
        guide_title: 'Test Guide',
        launch_source: 'home_page',
        current_path: '/explore',
        starting_location: '/connections',
      });
      expect(events).toEqual(['commit', 'save', 'commit', 'commit', 'save', 'telemetry']);
    });

    it('suppresses the pending decision and telemetry in full-screen mode', async () => {
      let resolveLoad: (value: unknown) => void = () => {};
      jest.requireMock('../../global-state/panel-mode').panelModeManager.getMode.mockReturnValueOnce('fullscreen');
      mockLoadDocsTabContentResult.mockReturnValue(
        new Promise((resolve) => {
          resolveLoad = resolve;
        })
      );
      const panel = new CombinedLearningJourneyPanel();

      const tabId = await openTabAndLoad(panel, 'bundled:launch/content.json', 'home_page', {
        packageManifest: { startingLocation: '/connections' },
      });
      const now = jest.spyOn(Date, 'now');
      resolveLoad({ content: makeJourneyContent() });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(getTab(panel, tabId).pendingAlignment).toBeUndefined();
      expect(now).not.toHaveBeenCalled();
      expect(mockReportAppInteraction).not.toHaveBeenCalledWith('alignment_prompt_shown', expect.anything());
    });

    it('preserves docs fallbacks when fetched content has no package, journey, or URL', async () => {
      const fetchedContent: RawContent = {
        content: 'documentation',
        type: 'single-doc',
        url: '',
        lastFetched: '2026-08-27T00:00:00.000Z',
        metadata: { title: 'Documentation' },
      };
      mockLoadDocsTabContentResult.mockResolvedValue({ content: fetchedContent });
      const panel = new CombinedLearningJourneyPanel();

      const tabId = await openTabAndLoad(panel, 'https://grafana.com/docs/grafana/latest/', 'home_page');
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(getTab(panel, tabId)).toEqual({
        id: tabId,
        title: 'Test Guide',
        baseUrl: 'https://grafana.com/docs/grafana/latest/',
        currentUrl: 'https://grafana.com/docs/grafana/latest/',
        content: fetchedContent,
        isLoading: false,
        error: null,
        type: 'docs',
        packageInfo: undefined,
        pathContext: undefined,
        pendingAlignment: undefined,
      });
    });

    it('resolves alignment before one atomic success commit and persistence request', async () => {
      let resolveLoad: (value: unknown) => void = () => {};
      mockLoadDocsTabContentResult.mockReturnValue(
        new Promise((resolve) => {
          resolveLoad = resolve;
        })
      );
      const events: string[] = [];
      const panel = new CombinedLearningJourneyPanel();
      const tabId = await openTabAndLoad(panel, 'bundled:launch/content.json', 'home_page', {
        packageManifest: { startingLocation: '/connections' },
      });
      panel.setState({
        tabs: (panel.state.tabs as any[]).map((tab) =>
          tab.id === tabId ? { ...tab, title: 'Latest title', baseUrl: 'bundled:latest-base' } : tab
        ),
      });
      mockGetLocation.mockImplementation(() => {
        events.push('alignment');
        return { pathname: '/explore', search: '' };
      });
      const originalSetState = panel.setState.bind(panel);
      const setState = jest.spyOn(panel, 'setState').mockImplementation((patch) => {
        events.push('commit');
        originalSetState(patch);
      });
      const save = jest.spyOn(panel as any, 'saveTabsToStorage').mockImplementation(() => events.push('save'));
      mockReportAppInteraction.mockImplementation(() => events.push('telemetry'));

      resolveLoad({ content: makeJourneyContent() });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(setState).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenCalledTimes(1);
      expect(mockReportAppInteraction).toHaveBeenCalledTimes(1);
      expect(events).toEqual(['alignment', 'commit', 'save', 'telemetry']);
      expect(getTab(panel, tabId).baseUrl).toBe('bundled:latest-base');
      expect(mockReportAppInteraction).toHaveBeenCalledWith(
        'alignment_prompt_shown',
        expect.objectContaining({ guide_title: 'Latest title' })
      );
    });

    it('sets pendingAlignment when manifest startingLocation differs and source is home_page', async () => {
      mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult({ startingLocation: '/connections' }));
      const panel = new CombinedLearningJourneyPanel();

      const tabId = await openTabAndLoad(panel, 'bundled:connections-guide', 'home_page', {
        packageManifest: { startingLocation: '/connections' },
      });
      // Allow the async loadDocsTabContent inside openDocsPage to settle
      await new Promise((r) => setTimeout(r, 0));

      const tab = getTab(panel, tabId);
      expect(tab.pendingAlignment).toBeDefined();
      expect(tab.pendingAlignment.startingLocation).toBe('/connections');
      expect(tab.pendingAlignment.currentPath).toBe('/explore');
      expect(tab.pendingAlignment.launchSource).toBe('home_page');
      expect(typeof tab.pendingAlignment.decidedAt).toBe('number');
    });

    it('does NOT set pendingAlignment when source is recommender', async () => {
      mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult({ startingLocation: '/connections' }));
      const panel = new CombinedLearningJourneyPanel();

      const tabId = await openTabAndLoad(panel, 'bundled:connections-guide', 'recommender', {
        packageManifest: { startingLocation: '/connections' },
      });
      await new Promise((r) => setTimeout(r, 0));

      expect(getTab(panel, tabId).pendingAlignment).toBeUndefined();
    });

    it('does NOT set pendingAlignment when source is browser_restore', async () => {
      mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult({ startingLocation: '/connections' }));
      const panel = new CombinedLearningJourneyPanel();

      const tabId = await openTabAndLoad(panel, 'bundled:connections-guide', 'browser_restore', {
        packageManifest: { startingLocation: '/connections' },
      });
      await new Promise((r) => setTimeout(r, 0));

      expect(getTab(panel, tabId).pendingAlignment).toBeUndefined();
    });

    // Regression for the "spurious alignment prompt on reset / retry" bug:
    // internal reloads (`useContentReset`, `reloadActiveTab` for error-retry
    // and dev-refresh) tag the loader call as `internal_reload`. Without
    // that tag, `_consumeAutoLaunchSource()` returns `null` → `launchSource:
    // undefined` → not aligned-by-construction → prompt appears on top of
    // the freshly reloaded guide when the user is on a non-matching path.
    it('does NOT set pendingAlignment when source is internal_reload', async () => {
      mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult({ startingLocation: '/connections' }));
      const panel = new CombinedLearningJourneyPanel();

      const tabId = await openTabAndLoad(panel, 'bundled:connections-guide', 'internal_reload', {
        packageManifest: { startingLocation: '/connections' },
      });
      await new Promise((r) => setTimeout(r, 0));

      expect(getTab(panel, tabId).pendingAlignment).toBeUndefined();
    });

    // Regression: `initializeRestoredActiveTab` must tag its loader call with
    // `browser_restore` so the alignment evaluator treats restored tabs as
    // aligned-by-construction. Without that tag, `_consumeAutoLaunchSource()`
    // returns `null` → `launchSource: undefined` → not in
    // `ALIGNED_BY_CONSTRUCTION_SOURCES` → prompt fires on every refresh whose
    // path no longer matches the guide's `startingLocation`.
    it('does NOT set pendingAlignment for restored tabs (initializeRestoredActiveTab path)', async () => {
      const utilsMock = jest.requireMock('./utils');
      utilsMock.shouldUseDocsLoader.mockReturnValue(true);
      utilsMock.restoreTabsFromStorage.mockResolvedValue([
        {
          id: 'tab-restored-1',
          title: 'Restored Guide',
          baseUrl: 'bundled:connections-guide',
          currentUrl: 'bundled:connections-guide',
          type: 'docs',
          content: null,
          isLoading: false,
          error: null,
          packageInfo: { packageManifest: { startingLocation: '/connections' } },
        },
      ]);
      utilsMock.restoreActiveTabFromStorage.mockResolvedValue('tab-restored-1');

      mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult({ startingLocation: '/connections' }));
      // User is somewhere unrelated when the page reloads.
      mockGetLocation.mockReturnValue({ pathname: '/explore', search: '' });

      const panel = new CombinedLearningJourneyPanel();
      await panel.restoreTabsAsync();
      await new Promise((r) => setTimeout(r, 0));

      const tab = getTab(panel, 'tab-restored-1');
      expect(tab.pendingAlignment).toBeUndefined();
      // Sanity check that the loader actually ran for this tab.
      expect(mockLoadDocsTabContentResult).toHaveBeenCalled();
    });

    it('does NOT set pendingAlignment when source is mcp_launch', async () => {
      mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult({ startingLocation: '/connections' }));
      const panel = new CombinedLearningJourneyPanel();

      const tabId = await openTabAndLoad(panel, 'bundled:connections-guide', 'mcp_launch', {
        packageManifest: { startingLocation: '/connections' },
      });
      await new Promise((r) => setTimeout(r, 0));

      expect(getTab(panel, tabId).pendingAlignment).toBeUndefined();
    });

    it('does NOT set pendingAlignment when current path matches startingLocation exactly', async () => {
      mockGetLocation.mockReturnValue({ pathname: '/connections', search: '' });
      mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult({ startingLocation: '/connections' }));
      const panel = new CombinedLearningJourneyPanel();

      const tabId = await openTabAndLoad(panel, 'bundled:connections-guide', 'home_page', {
        packageManifest: { startingLocation: '/connections' },
      });
      await new Promise((r) => setTimeout(r, 0));

      expect(getTab(panel, tabId).pendingAlignment).toBeUndefined();
    });

    it('does NOT set pendingAlignment when current path matches startingLocation by prefix', async () => {
      mockGetLocation.mockReturnValue({ pathname: '/connections/datasources', search: '' });
      mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult({ startingLocation: '/connections' }));
      const panel = new CombinedLearningJourneyPanel();

      const tabId = await openTabAndLoad(panel, 'bundled:connections-guide', 'home_page', {
        packageManifest: { startingLocation: '/connections' },
      });
      await new Promise((r) => setTimeout(r, 0));

      expect(getTab(panel, tabId).pendingAlignment).toBeUndefined();
    });

    it('falls back to bundled index.json url[0] when manifest has no startingLocation', async () => {
      // Result has no manifest startingLocation; resolver should consult the bundled index.
      mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult());
      const panel = new CombinedLearningJourneyPanel();

      const tabId = await openTabAndLoad(panel, 'bundled:connections-guide', 'home_page');
      await new Promise((r) => setTimeout(r, 0));

      const tab = getTab(panel, tabId);
      expect(tab.pendingAlignment).toBeDefined();
      expect(tab.pendingAlignment.startingLocation).toBe('/connections');
    });

    it('does NOT set pendingAlignment when there is no manifest and no bundled fallback (remote URL)', async () => {
      mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult());
      const panel = new CombinedLearningJourneyPanel();

      const tabId = await openTabAndLoad(
        panel,
        'https://interactive-learning.grafana.net/foo/content.json',
        'home_page'
      );
      await new Promise((r) => setTimeout(r, 0));

      expect(getTab(panel, tabId).pendingAlignment).toBeUndefined();
    });

    // A standalone private guide is opened from the custom guides list with no packageInfo at all,
    // so the fetched content's own manifest is the only place its startingLocation can come from.
    it('sets pendingAlignment from content metadata additionalFields when the launch carries no packageInfo', async () => {
      mockLoadDocsTabContentResult.mockResolvedValue(makeAppPlatformContentResult('/alerting'));
      const panel = new CombinedLearningJourneyPanel();

      const tabId = await openTabAndLoad(panel, 'backend-guide:my-private-guide', 'home_page');
      await new Promise((r) => setTimeout(r, 0));

      const tab = getTab(panel, tabId);
      expect(tab.pendingAlignment).toBeDefined();
      expect(tab.pendingAlignment.startingLocation).toBe('/alerting');
      expect(tab.pendingAlignment.currentPath).toBe('/explore');
    });

    it('does NOT set pendingAlignment when the private guide declares no startingLocation', async () => {
      mockLoadDocsTabContentResult.mockResolvedValue(makeAppPlatformContentResult());
      const panel = new CombinedLearningJourneyPanel();

      const tabId = await openTabAndLoad(panel, 'backend-guide:my-private-guide', 'home_page');
      await new Promise((r) => setTimeout(r, 0));

      expect(getTab(panel, tabId).pendingAlignment).toBeUndefined();
    });

    it('prefers an explicit packageInfo manifest over the fetched content metadata', async () => {
      mockLoadDocsTabContentResult.mockResolvedValue(makeAppPlatformContentResult('/alerting'));
      const panel = new CombinedLearningJourneyPanel();

      const tabId = await openTabAndLoad(panel, 'backend-guide:my-private-guide', 'home_page', {
        packageManifest: { startingLocation: '/connections' },
      });
      await new Promise((r) => setTimeout(r, 0));

      expect(getTab(panel, tabId).pendingAlignment.startingLocation).toBe('/connections');
    });

    // A manifest is authored data, and `confirmAlignment` pushes what the prompt
    // carries. A value that would not pass as an authored navigate target must
    // not become a prompt either.
    it.each([
      ['a protocol-relative value', '//evil.com'],
      ['an absolute external URL', 'https://evil.com/explore'],
      ['a backslash-smuggled authority', '/\\evil.com'],
      ['an encoded traversal', '/foo/..%2Fbar'],
      ['an always-denied route', '/logout'],
    ])('does NOT set pendingAlignment for %s', async (_label, startingLocation) => {
      mockLoadDocsTabContentResult.mockResolvedValue(makeAppPlatformContentResult(startingLocation));
      const panel = new CombinedLearningJourneyPanel();

      const tabId = await openTabAndLoad(panel, 'backend-guide:my-private-guide', 'home_page');
      await new Promise((r) => setTimeout(r, 0));

      expect(getTab(panel, tabId).pendingAlignment).toBeUndefined();
    });

    // config.bootData.user in this suite is a plain viewer.
    it('does NOT set pendingAlignment for an admin-only route when the reader is not an admin', async () => {
      mockLoadDocsTabContentResult.mockResolvedValue(makeAppPlatformContentResult('/admin/users'));
      const panel = new CombinedLearningJourneyPanel();

      const tabId = await openTabAndLoad(panel, 'backend-guide:my-private-guide', 'home_page');
      await new Promise((r) => setTimeout(r, 0));

      expect(getTab(panel, tabId).pendingAlignment).toBeUndefined();
    });

    it('fires AlignmentPromptShown telemetry when a prompt is set', async () => {
      mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult({ startingLocation: '/connections' }));
      const panel = new CombinedLearningJourneyPanel();

      await openTabAndLoad(panel, 'bundled:connections-guide', 'home_page', {
        packageManifest: { startingLocation: '/connections' },
      });
      await new Promise((r) => setTimeout(r, 0));

      const shown = mockReportAppInteraction.mock.calls.find(([type]) => type === 'alignment_prompt_shown');
      expect(shown).toBeDefined();
      expect(shown![1]).toEqual(
        expect.objectContaining({
          launch_source: 'home_page',
          current_path: '/explore',
          starting_location: '/connections',
        })
      );
    });

    it('does NOT fire AlignmentPromptShown telemetry when no prompt is set', async () => {
      mockGetLocation.mockReturnValue({ pathname: '/connections', search: '' });
      mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult({ startingLocation: '/connections' }));
      const panel = new CombinedLearningJourneyPanel();

      await openTabAndLoad(panel, 'bundled:connections-guide', 'home_page', {
        packageManifest: { startingLocation: '/connections' },
      });
      await new Promise((r) => setTimeout(r, 0));

      const shown = mockReportAppInteraction.mock.calls.find(([type]) => type === 'alignment_prompt_shown');
      expect(shown).toBeUndefined();
    });

    it('consumes _pendingLaunchSource on read so the next load is not contaminated', async () => {
      mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult({ startingLocation: '/connections' }));
      const panel = new CombinedLearningJourneyPanel();

      // First load: home_page → prompt expected
      const firstTabId = await openTabAndLoad(panel, 'bundled:connections-guide', 'home_page', {
        packageManifest: { startingLocation: '/connections' },
      });
      await new Promise((r) => setTimeout(r, 0));
      expect(getTab(panel, firstTabId).pendingAlignment).toBeDefined();

      // Second load: no source recorded — should not assume the previous home_page
      const secondTabId = await openTabAndLoad(panel, 'bundled:connections-guide', null, {
        packageManifest: { startingLocation: '/connections' },
      });
      await new Promise((r) => setTimeout(r, 0));

      // Source was null, but launchSource defaults to "needs check" so a prompt
      // can still appear. The important assertion is that the prompt's
      // launchSource on the second tab is NOT 'home_page' (carried over from
      // the first load).
      const secondTab = getTab(panel, secondTabId);
      if (secondTab.pendingAlignment) {
        expect(secondTab.pendingAlignment.launchSource).toBe('unknown');
      }
    });
  });

  describe('confirmAlignment', () => {
    it('navigates to startingLocation, fires telemetry, and clears pendingAlignment', async () => {
      mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult({ startingLocation: '/connections' }));
      const panel = new CombinedLearningJourneyPanel();

      const tabId = await openTabAndLoad(panel, 'bundled:connections-guide', 'home_page', {
        packageManifest: { startingLocation: '/connections' },
      });
      await new Promise((r) => setTimeout(r, 0));
      expect(getTab(panel, tabId).pendingAlignment).toBeDefined();

      await panel.confirmAlignment(tabId);

      expect(mockLocationServicePush).toHaveBeenCalledWith('/connections');
      expect(getTab(panel, tabId).pendingAlignment).toBeUndefined();

      const confirmed = mockReportAppInteraction.mock.calls.find(([type]) => type === 'alignment_prompt_confirmed');
      expect(confirmed).toBeDefined();
      expect(confirmed![1]).toEqual(
        expect.objectContaining({
          launch_source: 'home_page',
          current_path: '/explore',
          starting_location: '/connections',
        })
      );
      expect(typeof confirmed![1].latency_ms).toBe('number');
    });

    it('is a no-op when there is no pendingAlignment for the tab', async () => {
      mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult());
      const panel = new CombinedLearningJourneyPanel();

      const tabId = await openTabAndLoad(panel, 'bundled:no-url-guide', 'recommender');
      await new Promise((r) => setTimeout(r, 0));

      await panel.confirmAlignment(tabId);

      expect(mockLocationServicePush).not.toHaveBeenCalled();
      expect(
        mockReportAppInteraction.mock.calls.find(([type]) => type === 'alignment_prompt_confirmed')
      ).toBeUndefined();
    });
  });

  // Regression: a guide whose steps move the user across Grafana pages (e.g.
  // `/a/foo/fleet-management` -> `/a/foo/alloy`) must NOT re-surface the
  // alignment prompt after the launch decision was resolved.
  describe('alignment prompt is one-shot per launch', () => {
    it('does not expose a reevaluateAlignment method on the panel', () => {
      const panel = new CombinedLearningJourneyPanel();
      expect((panel as unknown as { reevaluateAlignment?: unknown }).reevaluateAlignment).toBeUndefined();
    });

    it('keeps pendingAlignment undefined after dismissal even if the user navigates away later', async () => {
      mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult({ startingLocation: '/connections' }));
      const panel = new CombinedLearningJourneyPanel();

      const tabId = await openTabAndLoad(panel, 'bundled:connections-guide', 'home_page', {
        packageManifest: { startingLocation: '/connections' },
      });
      await new Promise((r) => setTimeout(r, 0));
      expect(getTab(panel, tabId).pendingAlignment).toBeDefined();

      panel.dismissAlignment(tabId);
      expect(getTab(panel, tabId).pendingAlignment).toBeUndefined();

      // Simulate the user navigating to several unrelated pages mid-guide —
      // no path or hook exists to flip pendingAlignment back on.
      mockGetLocation.mockReturnValue({ pathname: '/dashboards', search: '' });
      mockGetLocation.mockReturnValue({ pathname: '/a/grafana-collector-app/alloy', search: '' });
      mockGetLocation.mockReturnValue({ pathname: '/explore/metrics', search: '' });

      expect(getTab(panel, tabId).pendingAlignment).toBeUndefined();
    });
  });

  describe('dismissAlignment', () => {
    it('clears pendingAlignment without navigating, and fires telemetry', async () => {
      mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult({ startingLocation: '/connections' }));
      const panel = new CombinedLearningJourneyPanel();

      const tabId = await openTabAndLoad(panel, 'bundled:connections-guide', 'home_page', {
        packageManifest: { startingLocation: '/connections' },
      });
      await new Promise((r) => setTimeout(r, 0));
      expect(getTab(panel, tabId).pendingAlignment).toBeDefined();

      panel.dismissAlignment(tabId);

      expect(mockLocationServicePush).not.toHaveBeenCalled();
      expect(getTab(panel, tabId).pendingAlignment).toBeUndefined();

      const dismissed = mockReportAppInteraction.mock.calls.find(([type]) => type === 'alignment_prompt_dismissed');
      expect(dismissed).toBeDefined();
      expect(dismissed![1]).toEqual(
        expect.objectContaining({
          launch_source: 'home_page',
          starting_location: '/connections',
        })
      );
    });

    it('is a no-op when there is no pendingAlignment for the tab', async () => {
      mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult());
      const panel = new CombinedLearningJourneyPanel();

      const tabId = await openTabAndLoad(panel, 'bundled:no-url-guide', 'recommender');
      await new Promise((r) => setTimeout(r, 0));

      panel.dismissAlignment(tabId);

      expect(
        mockReportAppInteraction.mock.calls.find(([type]) => type === 'alignment_prompt_dismissed')
      ).toBeUndefined();
    });
  });

  // The PR review asked for a property-style test that exercises the
  // explicit-source channel through every aligned-by-construction launch
  // path. Without per-source coverage, a regression that swallows source
  // (e.g. a refactor that drops options.source on the floor) would only be
  // caught by the one or two spot-check tests above and could land
  // silently.
  describe('openDocsPage — explicit source channel coverage', () => {
    const ALIGNED_SOURCES_TO_VERIFY = [
      'recommender',
      'browser_restore',
      'internal_reload',
      'mcp_launch',
      'navigate-action',
      'grot_guide_block',
      'auto_open',
      'floating_panel_dock',
      'live_session_attendee',
      'devtools',
    ] as const;

    it.each(ALIGNED_SOURCES_TO_VERIFY)(
      'does NOT set pendingAlignment when openDocsPage is called with options.source=%s',
      async (source) => {
        mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult({ startingLocation: '/connections' }));
        const panel = new CombinedLearningJourneyPanel();

        // Use the new options API directly (not the legacy flag pattern via
        // openTabAndLoad). This is the contract we want covered.
        const tabId = await panel.openDocsPage('bundled:connections-guide', 'Test Guide', {
          source,
          packageInfo: { packageManifest: { startingLocation: '/connections' } } as any,
        });
        await new Promise((r) => setTimeout(r, 0));

        expect(getTab(panel, tabId).pendingAlignment).toBeUndefined();
      }
    );

    const NEEDS_CHECK_SOURCES_TO_VERIFY = [
      'home_page',
      'url_param',
      'learning-hub',
      'command_palette',
      'external_suggestion',
      'link_interception',
      'queued_link',
      'content_link',
      'block_editor_preview',
      'custom_guide',
    ] as const;

    it.each(NEEDS_CHECK_SOURCES_TO_VERIFY)(
      'DOES set pendingAlignment when openDocsPage is called with options.source=%s on a misaligned path',
      async (source) => {
        mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult({ startingLocation: '/connections' }));
        const panel = new CombinedLearningJourneyPanel();

        const tabId = await panel.openDocsPage('bundled:connections-guide', 'Test Guide', {
          source,
          packageInfo: { packageManifest: { startingLocation: '/connections' } } as any,
        });
        await new Promise((r) => setTimeout(r, 0));

        const pending = getTab(panel, tabId).pendingAlignment;
        expect(pending).toBeDefined();
        expect(pending.launchSource).toBe(source);
      }
    );

    it('options.source overrides any value previously stashed via _recordAutoLaunchSource', async () => {
      mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult({ startingLocation: '/connections' }));
      const panel = new CombinedLearningJourneyPanel();

      // Stash a NEEDS_CHECK source first; the explicit aligned-by-construction
      // options.source must win — otherwise the explicit param's contract
      // ("at the call site, this is the source") is meaningless.
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- intentional: test verifies the legacy stash is overridden by options.source
      panel._recordAutoLaunchSource('home_page');

      const tabId = await panel.openDocsPage('bundled:connections-guide', 'Test Guide', {
        source: 'recommender',
        packageInfo: { packageManifest: { startingLocation: '/connections' } } as any,
      });
      await new Promise((r) => setTimeout(r, 0));

      expect(getTab(panel, tabId).pendingAlignment).toBeUndefined();
    });
  });

  describe('openDocsPage — routes the content load through loadTab', () => {
    it('reaches the docs loader and transitions loading → success', async () => {
      let resolveLoad: (value: unknown) => void = () => {};
      mockLoadDocsTabContentResult.mockReturnValue(
        new Promise((resolve) => {
          resolveLoad = resolve;
        })
      );
      const panel = new CombinedLearningJourneyPanel();

      const tabId = await panel.openDocsPage('bundled:connections-guide', 'Test Guide');

      expect(mockLoadDocsTabContentResult).toHaveBeenCalled();
      const loadingTab = getTab(panel, tabId);
      expect(loadingTab.isLoading).toBe(true);
      expect(loadingTab.error).toBe(null);
      expect(loadingTab.content).toBe(null);

      resolveLoad(makeContentResult());
      await new Promise((r) => setTimeout(r, 0));

      const loadedTab = getTab(panel, tabId);
      expect(loadedTab.isLoading).toBe(false);
      expect(loadedTab.error).toBe(null);
      expect(loadedTab.content).toBeDefined();
    });

    it('transitions loading → error when the docs loader returns an error', async () => {
      mockLoadDocsTabContentResult.mockResolvedValue({ content: null, error: 'Failed to load documentation' });
      const panel = new CombinedLearningJourneyPanel();

      const tabId = await panel.openDocsPage('bundled:connections-guide', 'Test Guide');
      await new Promise((r) => setTimeout(r, 0));

      const tab = getTab(panel, tabId);
      expect(tab.isLoading).toBe(false);
      expect(tab.error).toBe('Failed to load documentation');
    });

    it('reports a completed guide-open outcome for successful loads', async () => {
      mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult());
      const panel = new CombinedLearningJourneyPanel();

      await panel.openDocsPage('bundled:connections-guide', 'Test Guide');
      await new Promise((r) => setTimeout(r, 0));

      expect(mockWithGuideOpenAction).toHaveBeenCalledWith('bundled:connections-guide', expect.any(Function));
      await expect(mockWithGuideOpenAction.mock.results[0]!.value).resolves.toBe('completed');
    });

    it('reports an error guide-open outcome when the loader stores the failure and resolves', async () => {
      mockLoadDocsTabContentResult.mockResolvedValue({ content: null, error: 'boom' });
      const panel = new CombinedLearningJourneyPanel();

      const tabId = await panel.openDocsPage('bundled:connections-guide', 'Test Guide');
      await new Promise((r) => setTimeout(r, 0));

      expect(getTab(panel, tabId).error).toBe('boom');
      await expect(mockWithGuideOpenAction.mock.results[0]!.value).resolves.toBe('error');
    });

    it('reaches the docs loader via the packageInfo trigger when shouldUseDocsLoader is false', async () => {
      // Isolate loadTab's second dispatch arm: with shouldUseDocsLoader false,
      // reaching the docs loader proves `options.packageInfo != null` alone
      // routed it — openDocsPage is that arm's primary call site.
      jest.requireMock('./utils').shouldUseDocsLoader.mockReturnValue(false);
      mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult());
      const panel = new CombinedLearningJourneyPanel();

      const tabId = await panel.openDocsPage('bundled:connections-guide', 'Test Guide', {
        packageInfo: { packageManifest: { startingLocation: '/connections' } } as any,
      });
      await new Promise((r) => setTimeout(r, 0));

      expect(mockLoadDocsTabContentResult).toHaveBeenCalledWith(
        'bundled:connections-guide',
        expect.objectContaining({ packageInfo: { packageManifest: { startingLocation: '/connections' } } })
      );
      const tab = getTab(panel, tabId);
      expect(tab.isLoading).toBe(false);
      expect(tab.content).toBeDefined();
    });
  });
});

describe('CombinedLearningJourneyPanel — package resolver config source', () => {
  afterEach(() => {
    delete (window as any).__pathfinderPluginConfig;
  });

  it('seeds the resolver from the published global, not the constructor pluginConfig', () => {
    const globalConfig = { acceptedTermsAndConditions: true } as any;
    (window as any).__pathfinderPluginConfig = globalConfig;
    const constructorConfig = { acceptedTermsAndConditions: false } as any;

    new CombinedLearningJourneyPanel(constructorConfig);

    expect(jest.requireMock('../../package-engine').createCompositeResolver).toHaveBeenCalledWith(globalConfig);
  });

  it('falls back to the constructor pluginConfig when the global is not set', () => {
    delete (window as any).__pathfinderPluginConfig;
    const constructorConfig = { acceptedTermsAndConditions: true } as any;

    new CombinedLearningJourneyPanel(constructorConfig);

    expect(jest.requireMock('../../package-engine').createCompositeResolver).toHaveBeenCalledWith(constructorConfig);
  });
});
