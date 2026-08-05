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
  isGrafanaDocsUrl: jest.fn(),
  cleanDocsUrl: jest.fn((url: string) => url),
  loadDocsTabContentResult: jest.fn(),
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
  testIds: { docsPanel: {} },
}));

jest.mock('../../types/package.types', () => ({
  getPackageRenderType: jest.fn(),
}));

jest.mock('../../hooks', () => ({}));

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import { config } from '@grafana/runtime';
import { isDevModeEnabled } from '../../utils/dev-mode';
import { CombinedLearningJourneyPanel } from './docs-panel';
import type { LearningJourneyTab } from '../../types/content-panel.types';
import {
  editorDraftFlushers,
  editorTabStorageKey,
  readEditorStoredState,
  writeEditorDraftState,
  writeEditorRemoteState,
} from '../block-editor/editor-tab-storage';
import { StorageKeys } from '../../lib/storage-keys';

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

function makeTab(id: string, type: LearningJourneyTab['type'] = 'recommendations'): LearningJourneyTab {
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
    localStorage.clear();
    (isDevModeEnabled as jest.Mock).mockReturnValue(false);
    const user = (config as { bootData: { user: { id: number; orgRole?: string } } }).bootData.user;
    delete user.orgRole;
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
    const panel = new CombinedLearningJourneyPanel();
    await panel.restoreTabsAsync();
    mockRestoreTabsFromStorage.mockResolvedValueOnce([makeTab('recommendations'), makeTab('tab-guide-2', 'docs')]);
    mockRestoreActiveTabFromStorage.mockResolvedValueOnce('tab-guide-2');

    await panel.restoreTabsAsync({ force: true });

    expect(mockRestoreTabsFromStorage).toHaveBeenCalledTimes(2);
    expect((panel as any).state.activeTabId).toBe('tab-guide-2');
    expect((panel as any).state.tabs.map((tab: LearningJourneyTab) => tab.id)).toContain('tab-guide-2');
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

  it('opens a recovered legacy editor independently of tab restoration', () => {
    const user = (config as { bootData: { user: { id: number; orgRole?: string } } }).bootData.user;
    user.orgRole = 'Editor';

    localStorage.setItem(
      StorageKeys.BLOCK_EDITOR_STATE,
      JSON.stringify({
        guide: { id: 'g1', title: 'Recovered draft', blocks: [{ type: 'markdown', content: 'hi' }] },
      })
    );

    const panel = new CombinedLearningJourneyPanel();
    panel.setState({ tabs: RESTORED_TABS, activeTabId: 'tab-guide-1' });
    panel.recoverLegacyEditorTab();

    expect((panel as any).state.activeTabId).toBe('editor');
    expect(
      (panel as any).state.tabs.some((t: { id: string; type?: string }) => t.id === 'editor' && t.type === 'editor')
    ).toBe(true);
    // Body lives at editorTabStorageKey('editor'); strip title syncs when BlockEditor mounts.
    expect(localStorage.getItem(editorTabStorageKey('editor'))).toContain('Recovered draft');
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
    localStorage.clear();
    (isDevModeEnabled as jest.Mock).mockReturnValue(false);
    const user = (config as { bootData: { user: { id: number; orgRole?: string } } }).bootData.user;
    delete user.orgRole;
    setupRestoreMocks();
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

  it('clears per-tab editor storage when the editor gate closes after being open', async () => {
    const user = (config as { bootData: { user: { id: number; orgRole?: string } } }).bootData.user;
    user.orgRole = 'Editor';

    const editorTab = {
      id: 'editor-a',
      title: 'My draft',
      baseUrl: '',
      currentUrl: '',
      content: null,
      isLoading: false,
      error: null,
      type: 'editor' as const,
    };
    mockRestoreTabsFromStorage.mockResolvedValue([...RESTORED_TABS, editorTab]);
    mockRestoreActiveTabFromStorage.mockResolvedValue('editor-a');

    const storageKey = editorTabStorageKey('editor-a');
    writeEditorDraftState(storageKey, {
      guide: { id: 'g1', title: 'My draft', blocks: [{ id: 'b1', type: 'markdown', content: 'x' }] },
    });
    writeEditorRemoteState(storageKey, {
      resourceName: 'g1',
      lastSyncedJson: '{}',
      status: 'draft',
    });
    const flush = jest.fn(() => {
      writeEditorDraftState(storageKey, {
        guide: { id: 'g1', title: 'Latest pending draft', blocks: [{ id: 'b2', type: 'markdown', content: 'y' }] },
      });
    });
    editorDraftFlushers.set(storageKey, flush);
    expect(readEditorStoredState(storageKey)).not.toBeNull();

    const { tabStorage } = require('../../lib/user-storage');
    const panel = new CombinedLearningJourneyPanel();
    await panel.restoreTabsAsync();
    expect((panel as any).state.tabs.some((t: { id: string }) => t.id === 'editor-a')).toBe(true);

    user.orgRole = 'Viewer';
    panel.syncPluginConfig({});
    editorDraftFlushers.delete(storageKey);

    expect(flush).toHaveBeenCalledTimes(1);
    expect((panel as any).state.tabs.some((t: { type?: string }) => t.type === 'editor')).toBe(false);
    expect(readEditorStoredState(storageKey)).toBeNull();
    expect(tabStorage.setTabs).toHaveBeenCalled();
  });
});

describe('CombinedLearningJourneyPanel — createEditorTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    const user = (config as { bootData: { user: { id: number; orgRole?: string } } }).bootData.user;
    delete user.orgRole;
    setupRestoreMocks();
  });

  it('creates a distinct tab per call and focuses the newest', () => {
    const panel = new CombinedLearningJourneyPanel();
    panel.setState({ tabs: [makeTab('recommendations')], activeTabId: 'recommendations' });

    panel.createEditorTab();
    panel.createEditorTab();

    const editorTabs = (panel as any).state.tabs.filter((t: LearningJourneyTab) => t.type === 'editor');
    expect(editorTabs).toHaveLength(2);
    expect(editorTabs[0].id).not.toBe(editorTabs[1].id);
    expect((panel as any).state.activeTabId).toBe(editorTabs[1].id);
  });

  it('focuses an existing editor when createEditorTab is given that tabId', () => {
    const panel = new CombinedLearningJourneyPanel();
    panel.setState({
      tabs: [makeTab('recommendations'), makeTab('editor-older', 'editor'), makeTab('editor-newer', 'editor')],
      activeTabId: 'recommendations',
    });

    panel.createEditorTab({ tabId: 'editor-older' });

    expect((panel as any).state.tabs).toHaveLength(3);
    expect((panel as any).state.activeTabId).toBe('editor-older');
  });
});

describe('CombinedLearningJourneyPanel — focusEditorTabForResource', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupRestoreMocks();
    localStorage.clear();
  });

  it('focuses the editor tab already bound to the resource and skips the active tab when excluded', () => {
    writeEditorRemoteState(editorTabStorageKey('editor-a'), {
      resourceName: 'shared-guide',
      lastSyncedJson: '{}',
    });
    writeEditorRemoteState(editorTabStorageKey('editor-b'), {
      resourceName: 'other-guide',
      lastSyncedJson: '{}',
    });

    const panel = new CombinedLearningJourneyPanel();
    panel.setState({
      tabs: [makeTab('recommendations'), makeTab('editor-a', 'editor'), makeTab('editor-b', 'editor')],
      activeTabId: 'editor-b',
    });

    expect(panel.focusEditorTabForResource('shared-guide', { excludeTabId: 'editor-b' })).toBe(true);
    expect((panel as any).state.activeTabId).toBe('editor-a');

    expect(panel.focusEditorTabForResource('shared-guide', { excludeTabId: 'editor-a' })).toBe(false);
    expect((panel as any).state.activeTabId).toBe('editor-a');
  });
});

describe('CombinedLearningJourneyPanel — local guide ID collisions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupRestoreMocks();
    localStorage.clear();
  });

  it('finds and destructively discards a sibling draft using the same guide ID', () => {
    writeEditorDraftState(editorTabStorageKey('editor-a'), {
      guide: { id: 'shared-guide', title: 'First guide', blocks: [{ type: 'markdown', content: 'unsaved' }] },
    });
    const panel = new CombinedLearningJourneyPanel();
    panel.setState({
      tabs: [
        makeTab('recommendations'),
        { ...makeTab('editor-a', 'editor'), title: 'First guide' },
        makeTab('editor-b', 'editor'),
      ],
      activeTabId: 'editor-b',
    });

    expect(panel.findEditorTabForGuideId('shared-guide', { excludeTabId: 'editor-b' })).toEqual({
      tabId: 'editor-a',
      title: 'First guide',
    });

    panel.discardEditorTab('editor-a');

    expect((panel as any).state.tabs.map((tab: { id: string }) => tab.id)).toEqual(['recommendations', 'editor-b']);
    expect(localStorage.getItem(editorTabStorageKey('editor-a'))).toBeNull();
  });
});
