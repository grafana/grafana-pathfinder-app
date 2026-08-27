/**
 * Regression guard: full-screen surface reclassification used to happen
 * proactively in `loadDocsTabContent` the moment a newly-loaded milestone
 * turned out to need the live Grafana UI — before the user clicked anything.
 * That's been replaced by the click-triggered handoff in
 * `interactive-engine/interactive.hook.ts` (see
 * `interactive.hook.test.ts`); loading content in full screen must never, by
 * itself, dispatch a sidebar handoff anymore.
 */

// ---------------------------------------------------------------------------
// Mocks — must be declared before any import that triggers docs-panel.tsx
// ---------------------------------------------------------------------------

const mockLoadDocsTabContentResult = jest.fn();
const mockGetMode = jest.fn(() => 'sidebar');

jest.mock('../../lib/logging', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
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
  ...jest.requireActual('./utils/tab-state-transitions'),
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
import { REQUEST_SIDEBAR_HANDOFF_EVENT } from '../../lib/event-names';

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

const INTERACTIVE_GUIDE = {
  id: 'guide-1',
  title: 'Milestone',
  blocks: [{ type: 'interactive', action: 'button', reftarget: '#save', content: 'Do it' }],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CombinedLearningJourneyPanel — loading content in full screen no longer proactively hands off', () => {
  let dispatchEventSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMode.mockReturnValue('fullscreen');
    dispatchEventSpy = jest.spyOn(document, 'dispatchEvent');
  });

  afterEach(() => {
    dispatchEventSpy.mockRestore();
  });

  it('does not dispatch REQUEST_SIDEBAR_HANDOFF_EVENT merely from loading Grafana-UI-requiring content in full screen', async () => {
    mockLoadDocsTabContentResult.mockResolvedValue(makeContentResult(INTERACTIVE_GUIDE));
    const panel = new CombinedLearningJourneyPanel();

    await panel.openDocsPage('bundled:connections-guide', 'Test Guide');
    await new Promise((r) => setTimeout(r, 0));

    const handoffDispatches = dispatchEventSpy.mock.calls.filter(
      ([event]) => (event as Event).type === REQUEST_SIDEBAR_HANDOFF_EVENT
    );
    expect(handoffDispatches).toHaveLength(0);
  });
});
