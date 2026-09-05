/**
 * Tests for CombinedLearningJourneyPanel.loadTabContent's empty-URL handling.
 *
 * An empty/corrupted tab URL previously returned 'completed' without loading
 * or failing the tab, which withGuideOpenAction then mapped to a successful
 * `pathfinder_guide_open` outcome. Fixed to fail the tab and report 'error'.
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

const mockFetchContent = jest.fn();
jest.mock('../../docs-retrieval', () => ({
  fetchContent: (...args: unknown[]) => mockFetchContent(...args),
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

import { CombinedLearningJourneyPanel } from './docs-panel';
import { loadDocsTabContentResult, shouldUseDocsLoader } from './utils';
import type { RawContent } from '../../types/content.types';

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

const preparedContent: RawContent = {
  content: '{"id":"g","title":"g","blocks":[]}',
  metadata: { title: 'g' },
  type: 'interactive',
  url: 'bundled:prepared',
  lastFetched: '2026-07-28T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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
    expect(tab.content).toBe(preparedContent);
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
    expect(tab.content).toBe(preparedContent);
    expect(tab.isLoading).toBe(false);
    expect(tab.error).toBeNull();
  });
});
