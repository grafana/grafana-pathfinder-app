/**
 * Tests for CombinedLearningJourneyPanel implied-0th-step alignment behavior.
 *
 * Verifies that `loadDocsTabContent` sets `pendingAlignment` when the user's
 * current path doesn't match the guide's `startingLocation` AND the launch
 * source isn't aligned-by-construction; that `confirmAlignment` navigates
 * and clears state; and that `dismissAlignment` clears state without
 * navigating.
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

jest.mock('../../global-state/panel-mode', () => ({
  panelModeManager: { getMode: jest.fn(() => 'sidebar'), setMode: jest.fn(), snapshotSidebarTabs: jest.fn() },
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
  isGrafanaDocsUrl: jest.fn(),
  cleanDocsUrl: jest.fn((url: string) => url),
  loadDocsTabContentResult: (...args: unknown[]) => mockLoadDocsTabContentResult(...args),
  PERMANENT_TAB_IDS: new Set(['recommendations', 'devtools', 'editor']),
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

jest.mock('../../hooks', () => ({
  usePendingGuideLaunch: jest.fn(),
}));

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CombinedLearningJourneyPanel — implied-0th-step alignment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLocation.mockReturnValue({ pathname: '/explore', search: '' });
  });

  describe('loadDocsTabContent — pendingAlignment decision', () => {
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

  describe('reevaluateAlignment', () => {
    it('sets pendingAlignment when the user navigates away from a previously aligned start', async () => {
      mockGetLocation.mockReturnValue({ pathname: '/connections', search: '' });
      mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult({ startingLocation: '/connections' }));
      const panel = new CombinedLearningJourneyPanel();

      // Initial load while already aligned — no prompt.
      const tabId = await openTabAndLoad(panel, 'bundled:connections-guide', 'home_page', {
        packageManifest: { startingLocation: '/connections' },
      });
      await new Promise((r) => setTimeout(r, 0));
      expect(getTab(panel, tabId).pendingAlignment).toBeUndefined();
      mockReportAppInteraction.mockClear();

      // User navigates somewhere unrelated — re-evaluator should surface a prompt.
      panel.reevaluateAlignment(tabId, '/dashboards');

      const tab = getTab(panel, tabId);
      expect(tab.pendingAlignment).toBeDefined();
      expect(tab.pendingAlignment.startingLocation).toBe('/connections');
      expect(tab.pendingAlignment.currentPath).toBe('/dashboards');
      expect(tab.pendingAlignment.launchSource).toBe('location_change');

      const shown = mockReportAppInteraction.mock.calls.find(([type]) => type === 'alignment_prompt_shown');
      expect(shown).toBeDefined();
      expect(shown![1]).toEqual(
        expect.objectContaining({
          launch_source: 'location_change',
          current_path: '/dashboards',
          starting_location: '/connections',
        })
      );
    });

    it('clears pendingAlignment when the user navigates back into the starting location', async () => {
      mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult({ startingLocation: '/connections' }));
      const panel = new CombinedLearningJourneyPanel();

      const tabId = await openTabAndLoad(panel, 'bundled:connections-guide', 'home_page', {
        packageManifest: { startingLocation: '/connections' },
      });
      await new Promise((r) => setTimeout(r, 0));
      expect(getTab(panel, tabId).pendingAlignment).toBeDefined();

      panel.reevaluateAlignment(tabId, '/connections/datasources');

      expect(getTab(panel, tabId).pendingAlignment).toBeUndefined();
    });

    it('is a no-op when the tab does not exist', () => {
      const panel = new CombinedLearningJourneyPanel();
      panel.reevaluateAlignment('does-not-exist', '/anywhere');
      expect(mockReportAppInteraction.mock.calls.find(([type]) => type === 'alignment_prompt_shown')).toBeUndefined();
    });

    it('is a no-op when the guide has no resolvable startingLocation', async () => {
      mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult());
      const panel = new CombinedLearningJourneyPanel();

      const tabId = await openTabAndLoad(
        panel,
        'https://interactive-learning.grafana.net/foo/content.json',
        'home_page'
      );
      await new Promise((r) => setTimeout(r, 0));

      mockReportAppInteraction.mockClear();
      panel.reevaluateAlignment(tabId, '/anywhere');

      expect(getTab(panel, tabId).pendingAlignment).toBeUndefined();
      expect(mockReportAppInteraction.mock.calls.find(([type]) => type === 'alignment_prompt_shown')).toBeUndefined();
    });

    it('does not re-fire telemetry when the tab is already pending and still misaligned', async () => {
      mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult({ startingLocation: '/connections' }));
      const panel = new CombinedLearningJourneyPanel();

      const tabId = await openTabAndLoad(panel, 'bundled:connections-guide', 'home_page', {
        packageManifest: { startingLocation: '/connections' },
      });
      await new Promise((r) => setTimeout(r, 0));
      mockReportAppInteraction.mockClear();

      // Move from one misaligned path to another — still pending, no new prompt.
      panel.reevaluateAlignment(tabId, '/dashboards');

      expect(mockReportAppInteraction.mock.calls.find(([type]) => type === 'alignment_prompt_shown')).toBeUndefined();
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

  // F3 regression: confirmAlignment must wrap its `locationService.push` with
  // begin/endInteractiveNavigation so the reactive `useAlignmentReevaluation`
  // listener (which fires synchronously during `push`) skips itself instead
  // of clearing `pendingAlignment` ahead of `confirmAlignment`'s own clear
  // (a race that surfaces a "Fix this" flash on the next step).
  describe('confirmAlignment — interactive-navigation guard', () => {
    let interactiveNav: typeof import('../../global-state/interactive-navigation');

    beforeAll(() => {
      // Imported lazily so the mock setup at the top of the file doesn't
      // intercept it (it isn't in any of the jest.mock(...) calls above).
      interactiveNav = jest.requireActual('../../global-state/interactive-navigation');
    });

    afterEach(() => {
      interactiveNav.__resetInteractiveNavigationForTesting();
    });

    it('marks the navigation as interactive while pushing the new location', async () => {
      mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult({ startingLocation: '/connections' }));
      const panel = new CombinedLearningJourneyPanel();

      const tabId = await openTabAndLoad(panel, 'bundled:connections-guide', 'home_page', {
        packageManifest: { startingLocation: '/connections' },
      });
      await new Promise((r) => setTimeout(r, 0));

      let inProgressDuringPush = false;
      mockLocationServicePush.mockImplementationOnce(() => {
        // Capture the flag state at the precise moment a `history.listen`
        // callback would fire. The fix relies on this being true.
        inProgressDuringPush = interactiveNav.isInteractiveNavigationInProgress();
      });

      await panel.confirmAlignment(tabId);

      expect(inProgressDuringPush).toBe(true);
      // And after confirmAlignment returns, the counter must be back to 0
      // (otherwise subsequent genuine user navigations would be silently
      // suppressed forever).
      expect(interactiveNav.isInteractiveNavigationInProgress()).toBe(false);
    });

    it('still clears pendingAlignment AND balances the nav counter when locationService.push throws', async () => {
      // Defensive test for two finally-block invariants:
      //   1. The interactive-navigation counter must be balanced even on the
      //      failure path (a leak would silently suppress every later user
      //      navigation in `useAlignmentReevaluation`).
      //   2. `pendingAlignment` must be cleared even on the failure path —
      //      `AlignmentPromptConfirmed` telemetry has already fired (above
      //      the try/finally), so leaving the prompt visible would be
      //      inconsistent with the recorded event and force the user to
      //      click "Continue here" to dismiss a prompt for an action they
      //      already confirmed.
      mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult({ startingLocation: '/connections' }));
      const panel = new CombinedLearningJourneyPanel();

      const tabId = await openTabAndLoad(panel, 'bundled:connections-guide', 'home_page', {
        packageManifest: { startingLocation: '/connections' },
      });
      await new Promise((r) => setTimeout(r, 0));
      // Sanity: the prompt is up before we attempt the (failing) confirm.
      expect(getTab(panel, tabId).pendingAlignment).toBeDefined();

      mockLocationServicePush.mockImplementationOnce(() => {
        throw new Error('simulated push failure');
      });

      await expect(panel.confirmAlignment(tabId)).rejects.toThrow('simulated push failure');

      // Counter balanced via the try/finally pair.
      expect(interactiveNav.isInteractiveNavigationInProgress()).toBe(false);
      // Prompt cleared via the same finally — UI now matches the
      // AlignmentPromptConfirmed event we already fired.
      expect(getTab(panel, tabId).pendingAlignment).toBeUndefined();
      // And the telemetry was indeed fired before the throw.
      const confirmed = mockReportAppInteraction.mock.calls.find(([type]) => type === 'alignment_prompt_confirmed');
      expect(confirmed).toBeDefined();
    });
  });

  // F4 regression: when the user wanders between misaligned pages while the
  // prompt is already showing, `currentPath` and `decidedAt` must update so
  // a subsequent confirm/dismiss telemetry payload reflects where the user
  // actually was when they decided — not where they were when the prompt
  // first appeared (potentially minutes ago).
  describe('reevaluateAlignment — stale currentPath refresh', () => {
    it('refreshes currentPath and decidedAt on misaligned-and-already-pending re-evaluation', async () => {
      mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult({ startingLocation: '/connections' }));
      const panel = new CombinedLearningJourneyPanel();

      const tabId = await openTabAndLoad(panel, 'bundled:connections-guide', 'home_page', {
        packageManifest: { startingLocation: '/connections' },
      });
      await new Promise((r) => setTimeout(r, 0));
      const initialPending = getTab(panel, tabId).pendingAlignment;
      expect(initialPending).toBeDefined();
      expect(initialPending.currentPath).toBe('/explore');
      const initialDecidedAt = initialPending.decidedAt;

      // Force a clock advance so decidedAt change is observable.
      const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(initialDecidedAt + 1000);
      try {
        panel.reevaluateAlignment(tabId, '/dashboards');
      } finally {
        dateSpy.mockRestore();
      }

      const updated = getTab(panel, tabId).pendingAlignment;
      expect(updated).toBeDefined();
      expect(updated.currentPath).toBe('/dashboards'); // refreshed
      expect(updated.startingLocation).toBe('/connections'); // unchanged
      expect(updated.launchSource).toBe('home_page'); // unchanged
      expect(updated.decidedAt).toBe(initialDecidedAt + 1000); // refreshed
    });

    it('does not refresh decidedAt if the user re-evaluates against the same misaligned path', async () => {
      mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult({ startingLocation: '/connections' }));
      const panel = new CombinedLearningJourneyPanel();

      const tabId = await openTabAndLoad(panel, 'bundled:connections-guide', 'home_page', {
        packageManifest: { startingLocation: '/connections' },
      });
      await new Promise((r) => setTimeout(r, 0));
      const initialDecidedAt = getTab(panel, tabId).pendingAlignment.decidedAt;

      const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(initialDecidedAt + 5000);
      try {
        // Same path the prompt was originally pinned to (`/explore`); should be a no-op.
        panel.reevaluateAlignment(tabId, '/explore');
      } finally {
        dateSpy.mockRestore();
      }

      // Unchanged: no setState, no telemetry
      expect(getTab(panel, tabId).pendingAlignment.decidedAt).toBe(initialDecidedAt);
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
});
