/**
 * Tests for the full-screen sidebar handoff triggered by milestone-to-milestone
 * navigation (`loadDocsTabContent`) — reclassifying newly-loaded content and
 * handing off to the sidebar before the user ever clicks into it, rather than
 * relying solely on the click-triggered guard in the interactive engine.
 */

// ---------------------------------------------------------------------------
// Mocks — must be declared before any import that triggers docs-panel.tsx
// ---------------------------------------------------------------------------

const mockLoadDocsTabContentResult = jest.fn();
const mockGetMode = jest.fn(() => 'sidebar');
const mockRequestSidebarHandoff = jest.fn();
const mockLoggerWarn = jest.fn();

jest.mock('../../lib/logging', () => ({
  logger: { error: jest.fn(), warn: (...args: unknown[]) => mockLoggerWarn(...args), info: jest.fn() },
}));

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
    push: jest.fn(),
    getLocation: () => ({ pathname: '/explore', search: '' }),
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
  reportAppInteraction: jest.fn(),
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

const mockWithGuideOpenAction = jest.fn(async (_url: string, work: () => Promise<unknown>) => work());
jest.mock('../../lib/telemetry', () => ({
  withGuideOpenAction: (...args: [string, () => Promise<unknown>]) => mockWithGuideOpenAction(...args),
  recordPanelReady: jest.fn(),
}));

jest.mock('../../global-state/panel-mode', () => ({
  panelModeManager: { getMode: () => mockGetMode(), setMode: jest.fn() },
  requestSidebarHandoff: (...args: unknown[]) => mockRequestSidebarHandoff(...args),
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
  shouldUseDocsLoader: jest.fn(() => true),
  getTranslatedTitle: jest.fn((t: string) => t),
  restoreTabsFromStorage: jest.fn(),
  restoreActiveTabFromStorage: jest.fn(),
  mergeRestoredTabsWithExisting: jest.requireActual('./utils/tab-storage-restore').mergeRestoredTabsWithExisting,
  isGrafanaDocsUrl: jest.fn(),
  cleanDocsUrl: jest.fn((url: string) => url),
  loadDocsTabContentResult: (...args: unknown[]) => mockLoadDocsTabContentResult(...args),
  ...jest.requireActual('./utils/tab-kinds'),
  ...jest.requireActual('./utils/tab-gates'),
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

jest.mock(
  '../../bundled-interactives/index.json',
  () => ({
    interactives: [{ id: 'connections-guide', url: ['/connections'] }],
  }),
  { virtual: true }
);

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import { CombinedLearningJourneyPanel } from './docs-panel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContentResult(guide: { id: string; title: string; blocks: unknown[] }) {
  return {
    content: {
      url: 'bundled:connections-guide/content.json',
      type: 'interactive',
      content: JSON.stringify(guide),
      metadata: {},
      lastFetched: new Date().toISOString(),
    },
  };
}

const NON_INTERACTIVE_GUIDE = {
  id: 'guide-1',
  title: 'Milestone',
  blocks: [{ type: 'markdown', content: 'Just reading.' }],
};

const INTERACTIVE_GUIDE = {
  id: 'guide-1',
  title: 'Milestone',
  blocks: [{ type: 'interactive', action: 'button', reftarget: '#save', content: 'Do it' }],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CombinedLearningJourneyPanel — full-screen sidebar handoff on navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMode.mockReturnValue('sidebar');
  });

  it('hands off to the sidebar when a newly-loaded milestone is interactive and the surface is full screen', async () => {
    mockGetMode.mockReturnValue('fullscreen');
    mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult(INTERACTIVE_GUIDE));
    const panel = new CombinedLearningJourneyPanel();

    await panel.openDocsPage('bundled:connections-guide', 'Test Guide');
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRequestSidebarHandoff).toHaveBeenCalledTimes(1);
  });

  it('does NOT hand off when the newly-loaded milestone is non-interactive, even in full screen', async () => {
    mockGetMode.mockReturnValue('fullscreen');
    mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult(NON_INTERACTIVE_GUIDE));
    const panel = new CombinedLearningJourneyPanel();

    await panel.openDocsPage('bundled:connections-guide', 'Test Guide');
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRequestSidebarHandoff).not.toHaveBeenCalled();
  });

  it('does NOT hand off for interactive content when already in the sidebar', async () => {
    mockGetMode.mockReturnValue('sidebar');
    mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult(INTERACTIVE_GUIDE));
    const panel = new CombinedLearningJourneyPanel();

    await panel.openDocsPage('bundled:connections-guide', 'Test Guide');
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRequestSidebarHandoff).not.toHaveBeenCalled();
  });

  it('does not throw, does not hand off, and does not log when content is plain non-JSON (e.g. a legacy HTML doc)', async () => {
    mockGetMode.mockReturnValue('fullscreen');
    mockLoadDocsTabContentResult.mockResolvedValue({
      content: {
        url: 'https://grafana.com/docs/some-page/',
        type: 'docs',
        content: '<html><body>Not a guide</body></html>',
        metadata: {},
        lastFetched: new Date().toISOString(),
      },
    });
    const panel = new CombinedLearningJourneyPanel();

    await expect(panel.openDocsPage('https://grafana.com/docs/some-page/', 'Test Guide')).resolves.not.toThrow();
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRequestSidebarHandoff).not.toHaveBeenCalled();
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  // Regression: requiresGrafanaUi recurses through blocks/steps unguarded, so
  // classifying unvalidated JSON risks a thrown exception instead of a
  // classification — validateGuideFromString must gate it, same as
  // prepareGuideLaunch does for the initial-launch classification.
  it('does not throw, does not hand off, and logs a warning when content is JSON but fails guide validation', async () => {
    mockGetMode.mockReturnValue('fullscreen');
    mockLoadDocsTabContentResult.mockResolvedValue({
      content: {
        url: 'bundled:connections-guide/content.json',
        type: 'interactive',
        // Valid JSON, but not guide-shaped: no id/title, blocks is a string.
        content: JSON.stringify({ blocks: 'not-an-array' }),
        metadata: {},
        lastFetched: new Date().toISOString(),
      },
    });
    const panel = new CombinedLearningJourneyPanel();

    await expect(panel.openDocsPage('bundled:connections-guide', 'Test Guide')).resolves.not.toThrow();
    await new Promise((r) => setTimeout(r, 0));

    expect(mockRequestSidebarHandoff).not.toHaveBeenCalled();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      '[DocsPanel] Could not classify newly-loaded content for full-screen handoff',
      expect.objectContaining({ url: 'bundled:connections-guide' })
    );
  });
});
