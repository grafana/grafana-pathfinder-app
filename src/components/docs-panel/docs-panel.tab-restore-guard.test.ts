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
  restoreTabsFromStorage: (...args: unknown[]) => mockRestoreTabsFromStorage(...args),
  restoreActiveTabFromStorage: (...args: unknown[]) => mockRestoreActiveTabFromStorage(...args),
  mergeRestoredTabsWithExisting: jest.requireActual('./utils/tab-storage-restore').mergeRestoredTabsWithExisting,
  isGrafanaDocsUrl: jest.fn(),
  cleanDocsUrl: jest.fn((url: string) => url),
  loadDocsTabContentResult: jest.fn(),
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
  testIds: { docsPanel: {} },
}));

jest.mock('../../types/package.types', () => ({
  getPackageRenderType: jest.fn(),
}));

jest.mock('../../hooks', () => ({}));

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import { isDevModeEnabled } from '../../utils/dev-mode';
import { tabStorage } from '../../lib/user-storage';
import { CombinedLearningJourneyPanel } from './docs-panel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RESTORED_TABS = [
  {
    id: 'recommendations',
    type: 'recommendations' as const,
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
    (isDevModeEnabled as jest.Mock).mockReturnValue(false);
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

  it('force-refreshes an existing model after another surface updates storage', async () => {
    // Fullscreen/floating own separate models. Without the force escape hatch
    // the returning sidebar keeps its pre-handoff snapshot and their tab work
    // looks discarded.
    const panel = new CombinedLearningJourneyPanel();
    await panel.restoreTabsAsync();
    mockRestoreTabsFromStorage.mockResolvedValueOnce([
      RESTORED_TABS[0],
      { ...RESTORED_TABS[1], id: 'tab-guide-2', title: 'Opened in full screen' },
    ]);
    mockRestoreActiveTabFromStorage.mockResolvedValueOnce('tab-guide-2');

    await panel.restoreTabsAsync({ force: true });

    expect(mockRestoreTabsFromStorage).toHaveBeenCalledTimes(2);
    expect((panel as any).state.activeTabId).toBe('tab-guide-2');
    expect((panel as any).state.tabs.map((tab: { id: string }) => tab.id)).toContain('tab-guide-2');
  });

  it('keeps loaded content on force restore when id and currentUrl still match', async () => {
    // Storage never persists content. Without a merge, every fullscreen/floating
    // round trip would blank the strip and refetch — same cost as a reload.
    const panel = new CombinedLearningJourneyPanel();
    await panel.restoreTabsAsync();

    const loadedContent = { content: '# still here', meta: {}, type: 'html' as const };
    (panel as any).setState({
      tabs: (panel as any).state.tabs.map((tab: { id: string }) =>
        tab.id === 'tab-guide-1'
          ? {
              ...tab,
              content: loadedContent,
              pathContext: { learningJourney: { milestones: [] } },
            }
          : tab
      ),
    });

    mockRestoreTabsFromStorage.mockResolvedValueOnce([
      RESTORED_TABS[0],
      { ...RESTORED_TABS[1], title: 'Renamed in full screen' },
    ]);
    mockRestoreActiveTabFromStorage.mockResolvedValueOnce('tab-guide-1');

    await panel.restoreTabsAsync({ force: true });

    const guide = (panel as any).state.tabs.find((tab: { id: string }) => tab.id === 'tab-guide-1');
    expect(guide.title).toBe('Renamed in full screen');
    expect(guide.content).toBe(loadedContent);
    expect(guide.pathContext).toEqual({ learningJourney: { milestones: [] } });
  });

  it('drops in-memory content on force restore when currentUrl changed in storage', async () => {
    const panel = new CombinedLearningJourneyPanel();
    await panel.restoreTabsAsync();

    (panel as any).setState({
      tabs: (panel as any).state.tabs.map((tab: { id: string }) =>
        tab.id === 'tab-guide-1' ? { ...tab, content: { content: '# stale page', meta: {}, type: 'html' } } : tab
      ),
    });

    mockRestoreTabsFromStorage.mockResolvedValueOnce([
      RESTORED_TABS[0],
      {
        ...RESTORED_TABS[1],
        currentUrl: 'https://grafana.com/docs/grafana/latest/test/other-page/',
      },
    ]);
    mockRestoreActiveTabFromStorage.mockResolvedValueOnce('tab-guide-1');

    await panel.restoreTabsAsync({ force: true });

    const guide = (panel as any).state.tabs.find((tab: { id: string }) => tab.id === 'tab-guide-1');
    expect(guide.content).toBeNull();
    expect(guide.currentUrl).toBe('https://grafana.com/docs/grafana/latest/test/other-page/');
  });

  it('waits for an in-flight save before restoring, so return paths that cannot flush still see the latest strip', async () => {
    // Covers fire-and-forget returns (Return to sidebar notice; auto-dock):
    // restore waits for the newest write already pending when the await
    // starts, not for a save issued after that.
    let writeLanded = false;
    let resolveWrite!: () => void;
    (tabStorage.setTabs as jest.Mock).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveWrite = () => {
          writeLanded = true;
          resolve();
        };
      })
    );
    mockRestoreTabsFromStorage.mockImplementation(async () =>
      writeLanded ? [RESTORED_TABS[0], { ...RESTORED_TABS[1], id: 'tab-from-fullscreen' }] : [RESTORED_TABS[0]]
    );
    mockRestoreActiveTabFromStorage.mockImplementation(async () =>
      writeLanded ? 'tab-from-fullscreen' : 'recommendations'
    );

    const outgoing = new CombinedLearningJourneyPanel();
    void outgoing.saveTabsToStorage();

    const sidebar = new CombinedLearningJourneyPanel();
    // Land the write a macrotask later so restore's own microtask-resolved
    // storage reads would win the race if the barrier were removed.
    const restore = sidebar.restoreTabsAsync({ force: true });
    setTimeout(resolveWrite, 0);
    await restore;

    expect((sidebar as any).state.tabs.map((tab: { id: string }) => tab.id)).toContain('tab-from-fullscreen');
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

  it('strips restored gated tabs when the user lacks access, without rewriting storage', async () => {
    mockRestoreTabsFromStorage.mockResolvedValue([
      ...RESTORED_TABS,
      {
        id: 'editor',
        title: 'New Guide',
        baseUrl: '',
        currentUrl: '',
        content: null,
        isLoading: false,
        error: null,
        type: 'editor',
      },
      {
        id: 'devtools',
        title: 'Dev Tools',
        baseUrl: '',
        currentUrl: '',
        content: null,
        isLoading: false,
        error: null,
        type: 'devtools',
      },
    ]);
    mockRestoreActiveTabFromStorage.mockResolvedValue('editor');

    const { tabStorage } = require('../../lib/user-storage');
    const panel = new CombinedLearningJourneyPanel();
    await panel.restoreTabsAsync();

    const tabs = (panel as any).state.tabs;
    expect(tabs.some((t: { type?: string }) => t.type === 'editor')).toBe(false);
    expect(tabs.some((t: { type?: string }) => t.type === 'devtools')).toBe(false);
    expect((panel as any).state.activeTabId).toBe('recommendations');
    // Rendering fails closed, but the first gate read cannot tell "denied"
    // from "config not resolved yet", so it must not delete from storage.
    expect(tabStorage.setTabs).not.toHaveBeenCalled();
  });

  it('keeps restored Dev Tools when pluginConfig enables pathfinder-dev-mode', async () => {
    // Pins finding 3: empty construction config used to make prune drop an
    // authorized Dev Tools tab and persist the loss. Construction with real
    // config + isDevModeEnabled true must keep the tab.
    (isDevModeEnabled as jest.Mock).mockReturnValue(true);
    mockRestoreTabsFromStorage.mockResolvedValue([
      ...RESTORED_TABS,
      {
        id: 'devtools',
        title: 'Dev Tools',
        baseUrl: '',
        currentUrl: '',
        content: null,
        isLoading: false,
        error: null,
        type: 'devtools',
      },
    ]);
    mockRestoreActiveTabFromStorage.mockResolvedValue('devtools');

    const { tabStorage } = require('../../lib/user-storage');
    const panel = new CombinedLearningJourneyPanel({ devMode: true });
    await panel.restoreTabsAsync();

    const tabs = (panel as any).state.tabs as Array<{ type?: string }>;
    expect(tabs.some((t) => t.type === 'devtools')).toBe(true);
    expect((panel as any).state.activeTabId).toBe('devtools');
    expect(tabStorage.setTabs).not.toHaveBeenCalled();
  });
});

describe('CombinedLearningJourneyPanel — tab gate sync', () => {
  const DEVTOOLS_TAB = {
    id: 'devtools',
    title: 'Dev Tools',
    baseUrl: '',
    currentUrl: '',
    content: null,
    isLoading: false,
    error: null,
    type: 'devtools',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (isDevModeEnabled as jest.Mock).mockReturnValue(false);
    setupRestoreMocks();
  });

  it('does not commit or persist when pruning is a no-op', () => {
    const panel = new CombinedLearningJourneyPanel();
    const setState = jest.spyOn(panel as any, 'setState');
    const saveTabs = jest.spyOn(panel, 'saveTabsToStorage');

    panel.pruneGatedTabs();

    expect(setState).not.toHaveBeenCalled();
    expect(saveTabs).not.toHaveBeenCalled();
  });

  it('commits once without persisting on the first unauthorized observation', () => {
    const panel = new CombinedLearningJourneyPanel();
    (panel as any).setState({ tabs: [...RESTORED_TABS, DEVTOOLS_TAB], activeTabId: 'devtools' });
    const setState = jest.spyOn(panel as any, 'setState');
    const saveTabs = jest.spyOn(panel, 'saveTabsToStorage');

    panel.pruneGatedTabs();

    expect(setState).toHaveBeenCalledTimes(1);
    expect(saveTabs).not.toHaveBeenCalled();
  });

  it('commits and persists once when an observed open gate closes', async () => {
    (isDevModeEnabled as jest.Mock).mockReturnValue(true);
    mockRestoreTabsFromStorage.mockResolvedValue([...RESTORED_TABS, DEVTOOLS_TAB]);
    mockRestoreActiveTabFromStorage.mockResolvedValue('devtools');
    const panel = new CombinedLearningJourneyPanel({ devMode: true, devModeUserIds: [1] });
    await panel.restoreTabsAsync();

    (isDevModeEnabled as jest.Mock).mockReturnValue(false);
    (panel as any).setState({ pluginConfig: { devMode: false } });
    const setState = jest.spyOn(panel as any, 'setState');
    const saveTabs = jest.spyOn(panel, 'saveTabsToStorage');

    panel.pruneGatedTabs();

    expect(setState).toHaveBeenCalledTimes(1);
    expect(saveTabs).toHaveBeenCalledTimes(1);
  });

  it('keeps Dev Tools when the renderer reports an unresolved plugin context', async () => {
    // The regression: an unresolved context produced getConfigWithDefaults({}),
    // which reads as "dev mode off" and stripped an authorized Dev Tools tab.
    (isDevModeEnabled as jest.Mock).mockReturnValue(true);
    mockRestoreTabsFromStorage.mockResolvedValue([...RESTORED_TABS, DEVTOOLS_TAB]);
    mockRestoreActiveTabFromStorage.mockResolvedValue('devtools');

    const panel = new CombinedLearningJourneyPanel({ devMode: true, devModeUserIds: [1] });
    await panel.restoreTabsAsync();

    panel.syncPluginConfig(null);

    const tabs = (panel as any).state.tabs as Array<{ type?: string }>;
    expect(tabs.some((t) => t.type === 'devtools')).toBe(true);
    expect((panel as any).state.pluginConfig).toEqual({ devMode: true, devModeUserIds: [1] });
  });

  it('persists the prune when a gate the model already observed as open closes', async () => {
    (isDevModeEnabled as jest.Mock).mockReturnValue(true);
    mockRestoreTabsFromStorage.mockResolvedValue([...RESTORED_TABS, DEVTOOLS_TAB]);
    mockRestoreActiveTabFromStorage.mockResolvedValue('devtools');

    const { tabStorage } = require('../../lib/user-storage');
    const panel = new CombinedLearningJourneyPanel({ devMode: true, devModeUserIds: [1] });
    await panel.restoreTabsAsync();
    expect((panel as any).state.tabs.some((t: { type?: string }) => t.type === 'devtools')).toBe(true);

    // Admin revokes dev mode mid-session; plugin meta refreshes.
    (isDevModeEnabled as jest.Mock).mockReturnValue(false);
    panel.syncPluginConfig({ devMode: false });

    const tabs = (panel as any).state.tabs as Array<{ type?: string }>;
    expect(tabs.some((t) => t.type === 'devtools')).toBe(false);
    expect((panel as any).state.activeTabId).toBe('recommendations');
    expect(tabStorage.setTabs).toHaveBeenCalled();
  });
});
