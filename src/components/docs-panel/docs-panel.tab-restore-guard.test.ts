/**
 * Tests for CombinedLearningJourneyPanel tab restoration guard.
 *
 * Verifies that the _hasRestoredTabs guard allows each new panel instance
 * to restore tabs independently (e.g., after sidebar toggle off → on),
 * while still preventing double-restore within the same instance lifecycle
 * (React StrictMode).
 *
 * Refs: #782
 */

// ---------------------------------------------------------------------------
// Mocks — must be declared before any import that triggers docs-panel.tsx
// ---------------------------------------------------------------------------

const mockRestoreTabsFromStorage = jest.fn();
const mockRestoreActiveTabFromStorage = jest.fn();

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
  UserInteraction: {},
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
}));

jest.mock('./utils', () => ({
  isDocsLikeTab: jest.fn(),
  shouldUseDocsLoader: jest.fn(),
  getTranslatedTitle: jest.fn((t: string) => t),
  restoreTabsFromStorage: (...args: unknown[]) => mockRestoreTabsFromStorage(...args),
  restoreActiveTabFromStorage: (...args: unknown[]) => mockRestoreActiveTabFromStorage(...args),
  isGrafanaDocsUrl: jest.fn(),
  cleanDocsUrl: jest.fn((url: string) => url),
  loadDocsTabContentResult: jest.fn(),
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
  testIds: { docsPanel: {} },
}));

jest.mock('../../types/package.types', () => ({
  getPackageRenderType: jest.fn(),
}));

jest.mock('../../hooks', () => ({
  usePendingGuideLaunch: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import { CombinedLearningJourneyPanel } from './docs-panel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RESTORED_TABS = [
  {
    id: 'recommendations',
    title: 'Recommendations',
    baseUrl: '',
    currentUrl: '',
    content: null,
    isLoading: false,
    error: null,
  },
  {
    id: 'tab-guide-1',
    title: 'My Active Guide',
    baseUrl: 'https://grafana.com/docs/grafana/latest/test/',
    currentUrl: 'https://grafana.com/docs/grafana/latest/test/page2/',
    content: null,
    isLoading: false,
    error: null,
    type: 'learning-journey' as const,
  },
];

function setupRestoreMocks() {
  mockRestoreTabsFromStorage.mockResolvedValue(RESTORED_TABS);
  mockRestoreActiveTabFromStorage.mockResolvedValue('tab-guide-1');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CombinedLearningJourneyPanel — tab restoration guard (#782)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupRestoreMocks();
  });

  it('should restore tabs on the first call to restoreTabsAsync', async () => {
    const panel = new CombinedLearningJourneyPanel();

    await panel.restoreTabsAsync();

    expect(mockRestoreTabsFromStorage).toHaveBeenCalledTimes(1);
    expect((panel as any).state.activeTabId).toBe('tab-guide-1');
    expect((panel as any).state.tabs).toHaveLength(2);
    expect((panel as any).state.tabs[1].id).toBe('tab-guide-1');
  });

  it('should prevent double-restore on the same instance (StrictMode protection)', async () => {
    const panel = new CombinedLearningJourneyPanel();

    await panel.restoreTabsAsync();
    await panel.restoreTabsAsync();

    expect(mockRestoreTabsFromStorage).toHaveBeenCalledTimes(1);
  });

  it('should allow a NEW instance to restore tabs after the first instance already restored', async () => {
    // Simulate: sidebar mounts, panel A restores tabs
    const panelA = new CombinedLearningJourneyPanel();
    await panelA.restoreTabsAsync();
    expect(mockRestoreTabsFromStorage).toHaveBeenCalledTimes(1);

    // Simulate: sidebar unmounts (toggle off) then remounts (toggle on)
    // A new panel instance is created by SidebarContent's useMemo
    const panelB = new CombinedLearningJourneyPanel();

    await panelB.restoreTabsAsync();

    // BUG: with a static guard, panelB.restoreTabsAsync() bails out
    // because _hasRestoredTabs is still true from panelA.
    // The fix (instance-level guard) lets panelB restore independently.
    expect(mockRestoreTabsFromStorage).toHaveBeenCalledTimes(2);
    expect((panelB as any).state.activeTabId).toBe('tab-guide-1');
    expect((panelB as any).state.tabs).toHaveLength(2);
    expect((panelB as any).state.tabs[1].id).toBe('tab-guide-1');
  });

  it('should restore the previously active guide instead of leaving a remounted instance on recommendations', async () => {
    // Regression test for #782:
    // after sidebar toggle off → on, a newly created panel instance
    // should restore the user's active guide rather than staying
    // on the default "recommendations" tab.
    const panelA = new CombinedLearningJourneyPanel();
    await panelA.restoreTabsAsync();

    const panelB = new CombinedLearningJourneyPanel();
    await panelB.restoreTabsAsync();

    // Verify the remounted instance reflects restored state,
    // not the default single-tab recommendations state.
    const panelBTabs = (panelB as any).state.tabs;
    const panelBActiveTab = (panelB as any).state.activeTabId;
    expect(panelBActiveTab).not.toBe('recommendations');
    expect(panelBTabs.length).toBeGreaterThan(1);
  });
});
