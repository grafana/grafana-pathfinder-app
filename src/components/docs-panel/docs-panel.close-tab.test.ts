/**
 * Tests for CombinedLearningJourneyPanel.closeTab focus adjacency.
 *
 * The panel's `tabs` array is wider than the rendered strip: Dev Tools lives in
 * tab state for routing but claims no strip slot. Adjacency must therefore walk
 * strip-visible tabs, otherwise closing a guide can hand focus to Dev Tools and
 * leave no visible tab marked active.
 */

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

jest.mock('../../docs-retrieval', () => ({
  fetchContent: jest.fn(),
  ContentRenderer: jest.fn(),
  getNextMilestoneUrlFromContent: jest.fn(),
  getPreviousMilestoneUrlFromContent: jest.fn(),
  getJourneyProgress: jest.fn(),
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
  createInteractionName: jest.fn((type: string) => `pathfinder_${type}`),
  UserInteraction: { DocsPanelInteraction: 'docs_panel_interaction' },
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

jest.mock('../../lib/telemetry', () => ({
  withGuideOpenAction: jest.fn(async (_url: string, work: () => Promise<unknown>) => work()),
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
}));

jest.mock('./utils', () => ({
  isDocsLikeTab: jest.fn(),
  shouldUseDocsLoader: jest.fn(),
  getTranslatedTitle: jest.fn((t: string) => t),
  restoreTabsFromStorage: jest.fn(),
  restoreActiveTabFromStorage: jest.fn(),
  isGrafanaDocsUrl: jest.fn(),
  cleanDocsUrl: jest.fn((url: string) => url),
  loadDocsTabContentResult: jest.fn(),
  ...jest.requireActual('./utils/tab-kinds'),
}));

jest.mock('./hooks', () => ({
  useBadgeCelebrationQueue: jest.fn(() => []),
  useTabOverflow: jest.fn(() => ({ showLeft: false, showRight: false })),
  useScrollPositionPreservation: jest.fn(),
  useContentReset: jest.fn(),
}));

jest.mock('../../utils/dev-mode', () => ({
  isDevModeEnabled: jest.fn(() => true),
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

import { CombinedLearningJourneyPanel } from './docs-panel';
import type { LearningJourneyTab } from '../../types/content-panel.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tab(id: string, type: LearningJourneyTab['type']): LearningJourneyTab {
  return {
    id,
    type,
    title: id,
    baseUrl: '',
    currentUrl: '',
    content: null,
    isLoading: false,
    error: null,
  };
}

/**
 * Seeds tab state directly. Tabs are always appended in open order with
 * recommendations first, so the arrays below are reachable orderings.
 */
function panelWith(tabs: LearningJourneyTab[], activeTabId: string) {
  const panel = new CombinedLearningJourneyPanel();
  (panel as any).setState({ tabs, activeTabId });
  return panel;
}

function stateOf(panel: CombinedLearningJourneyPanel) {
  const { tabs, activeTabId, pendingCloseTabId } = (panel as any).state as {
    tabs: LearningJourneyTab[];
    activeTabId: string;
    pendingCloseTabId: string | null;
  };
  return { tabIds: tabs.map((t) => t.id), activeTabId, pendingCloseTabId };
}

const RECOMMENDATIONS = tab('recommendations', 'recommendations');
const DEVTOOLS = tab('devtools', 'devtools');
const EDITOR = tab('editor', 'editor');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CombinedLearningJourneyPanel.closeTab — focus adjacency', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('skips Dev Tools when inheriting focus from the tab on the right', () => {
    // Open order: guide, Dev Tools, editor.
    const panel = panelWith([RECOMMENDATIONS, tab('guide-1', 'learning-journey'), DEVTOOLS, EDITOR], 'guide-1');

    panel.closeTab('guide-1');

    expect(stateOf(panel)).toEqual({
      tabIds: ['recommendations', 'devtools', 'editor'],
      activeTabId: 'editor',
      pendingCloseTabId: null,
    });
  });

  it('falls back to recommendations when the last strip tab closes while Dev Tools remains', () => {
    const panel = panelWith([RECOMMENDATIONS, DEVTOOLS, tab('guide-1', 'learning-journey')], 'guide-1');

    panel.closeTab('guide-1');

    expect(stateOf(panel)).toEqual({
      tabIds: ['recommendations', 'devtools'],
      activeTabId: 'recommendations',
      pendingCloseTabId: null,
    });
  });

  it('leaves focus alone when a background tab closes', () => {
    // Closing a guide from the overflow menu while Dev Tools is open must not
    // yank the user out of the view they are actually looking at.
    const panel = panelWith([RECOMMENDATIONS, DEVTOOLS, tab('guide-1', 'learning-journey')], 'devtools');

    panel.closeTab('guide-1');

    expect(stateOf(panel)).toEqual({
      tabIds: ['recommendations', 'devtools'],
      activeTabId: 'devtools',
      pendingCloseTabId: null,
    });
  });

  it('inherits the last strip tab when the active strip-excluded tab is closed via Ctrl+W', () => {
    const panel = panelWith(
      [RECOMMENDATIONS, tab('guide-1', 'learning-journey'), tab('guide-2', 'learning-journey'), DEVTOOLS],
      'devtools'
    );

    panel.closeTab('devtools');

    expect(stateOf(panel)).toEqual({
      tabIds: ['recommendations', 'guide-1', 'guide-2'],
      activeTabId: 'guide-2',
      pendingCloseTabId: null,
    });
  });
});

describe('CombinedLearningJourneyPanel.closeTab — editor discard confirmation', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  it('closes an empty editor tab immediately', () => {
    const panel = panelWith([RECOMMENDATIONS, EDITOR], 'editor');

    panel.closeTab('editor');

    expect(stateOf(panel)).toEqual({
      tabIds: ['recommendations'],
      activeTabId: 'recommendations',
      pendingCloseTabId: null,
    });
  });

  it('holds an editor tab with unsaved work until confirmed', () => {
    localStorage.setItem(
      'pathfinder-block-editor-state:editor',
      JSON.stringify({
        guide: { id: 'g', title: 'Draft', blocks: [{ type: 'markdown', content: 'hi' }] },
      })
    );
    const panel = panelWith([RECOMMENDATIONS, EDITOR], 'editor');

    panel.closeTab('editor');

    expect(stateOf(panel)).toEqual({
      tabIds: ['recommendations', 'editor'],
      activeTabId: 'editor',
      pendingCloseTabId: 'editor',
    });
    expect(localStorage.getItem('pathfinder-block-editor-state:editor')).not.toBeNull();

    panel.confirmPendingClose();

    expect(stateOf(panel)).toEqual({
      tabIds: ['recommendations'],
      activeTabId: 'recommendations',
      pendingCloseTabId: null,
    });
    expect(localStorage.getItem('pathfinder-block-editor-state:editor')).toBeNull();
  });

  it('dismisses without closing or clearing draft storage', () => {
    localStorage.setItem(
      'pathfinder-block-editor-state:editor',
      JSON.stringify({
        guide: { id: 'g', title: 'Draft', blocks: [{ type: 'markdown', content: 'hi' }] },
      })
    );
    const panel = panelWith([RECOMMENDATIONS, EDITOR], 'editor');

    panel.closeTab('editor');
    panel.dismissPendingClose();

    expect(stateOf(panel)).toEqual({
      tabIds: ['recommendations', 'editor'],
      activeTabId: 'editor',
      pendingCloseTabId: null,
    });
    expect(localStorage.getItem('pathfinder-block-editor-state:editor')).not.toBeNull();
  });
});
