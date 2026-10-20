import React from 'react';
import { act, render, screen } from '@testing-library/react';

let mockBrowseFlag = true;
const mockFlagListeners = new Set<() => void>();

function setBrowseFlag(value: boolean) {
  mockBrowseFlag = value;
  mockFlagListeners.forEach((listener) => listener());
}

// One value for both readers: the model reads getFeatureFlagValue, the renderer useBooleanFlag.
jest.mock('../../utils/openfeature', () => {
  const { useSyncExternalStore } = jest.requireActual('react');
  const subscribe = (listener: () => void) => {
    mockFlagListeners.add(listener);
    return () => mockFlagListeners.delete(listener);
  };
  return {
    getFeatureFlagValue: jest.fn(() => mockBrowseFlag),
    useBooleanFlag: jest.fn(() => useSyncExternalStore(subscribe, () => mockBrowseFlag)),
  };
});

jest.mock('@grafana/scenes', () => {
  const { useSyncExternalStore } = jest.requireActual('react');
  class SceneObjectBase {
    state: Record<string, unknown>;
    private listeners = new Set<() => void>();
    constructor(state: Record<string, unknown>) {
      this.state = { ...state };
    }
    setState(partial: Record<string, unknown>) {
      this.state = { ...this.state, ...partial };
      this.listeners.forEach((listener) => listener());
    }
    subscribe = (listener: () => void) => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    };
  }
  Object.assign(SceneObjectBase.prototype, {
    useState(this: SceneObjectBase) {
      return useSyncExternalStore(this.subscribe, () => this.state);
    },
  });
  return { SceneObjectBase };
});

jest.mock('@grafana/runtime', () => ({
  config: { bootData: { user: { id: 1 } } },
  getAppEvents: jest.fn(() => ({ publish: jest.fn(), subscribe: jest.fn() })),
  locationService: { push: jest.fn(), getLocation: jest.fn(() => ({ pathname: '/', search: '' })) },
}));

jest.mock('@grafana/ui', () => ({
  useStyles2: jest.fn(() => ({})),
  useTheme2: jest.fn(() => ({})),
}));

jest.mock('./context-panel', () => ({
  ContextPanel: class MockContextPanel {
    useState() {
      return {};
    }
  },
}));

jest.mock('./AiFixOrchestrator', () => ({ __esModule: true, default: () => null }));

jest.mock('../../integrations/coda', () => ({
  TerminalPanel: () => null,
  TerminalProvider: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../../integrations/coda/useCodaAvailability.hook', () => ({
  useCodaPluginAvailable: () => false,
}));

jest.mock('../../integrations/workshop', () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
  useSession: () => ({}),
  ActionReplaySystem: class {},
  ActionCaptureSystem: class {},
}));

jest.mock('../../docs-retrieval', () => ({
  setPackageResolver: jest.fn(),
  isPackageContentUrl: jest.fn(() => false),
}));

jest.mock('../../package-engine', () => ({
  createCompositeResolver: jest.fn(),
}));

jest.mock('../../lib/user-storage', () => ({
  tabStorage: {
    getTabs: jest.fn(),
    setTabs: jest.fn(async () => undefined),
    getActiveTab: jest.fn(),
    setActiveTab: jest.fn(async () => undefined),
    clear: jest.fn(),
  },
  useUserStorage: jest.fn(),
}));

jest.mock('../../lib/faro', () => ({
  setFaroView: jest.fn(),
  setFaroViewName: jest.fn(),
}));

jest.mock('../../interactive-engine', () => ({
  useInteractiveElements: jest.fn(),
  NavigationManager: class {},
}));

jest.mock('./keyboard-shortcuts.hook', () => ({ useKeyboardShortcuts: jest.fn() }));
jest.mock('./link-handler.hook', () => ({ useLinkClickHandler: jest.fn() }));
jest.mock('./hooks/usePanelReadyMeasurement', () => ({ usePanelReadyMeasurement: jest.fn() }));

jest.mock('../../hooks', () => {
  // Must stay referentially stable: a fresh object re-runs the sync effect on every render.
  const pluginConfigState = { config: {}, isResolved: true, hasError: false };
  const progressState = { hasInteractiveProgress: false, progressKey: '' };
  return {
    usePathfinderPluginConfig: () => pluginConfigState,
    useGuideProgressState: () => progressState,
    useAutoLaunchTutorial: jest.fn(),
  };
});

jest.mock('./hooks', () => {
  const noop = () => undefined;
  const overflow = { visibleTabs: [], overflowedTabs: [], isDropdownOpen: false, setIsDropdownOpen: noop };
  const panelMode = { panelMode: 'sidebar', isFullScreenActive: false };
  return {
    useBadgeCelebrationQueue: () => ({}),
    useTabOverflow: () => overflow,
    useScrollPositionPreservation: () => ({ restoreScrollPosition: noop }),
    useContentReset: () => noop,
    useE2EResetGuideCapability: noop,
    useCustomGuideCatalogueOnOpen: noop,
    useDevModeLogger: () => noop,
    usePanelMode: () => panelMode,
    useSessionJoinUrlCheck: noop,
    useScrollTracking: noop,
    useGlobalActiveTabExposure: jest.requireActual('./hooks/useGlobalActiveTabExposure').useGlobalActiveTabExposure,
    useAutoOpenListener: noop,
    useCatalogBrowserListener: noop,
    usePopOutHandoff: noop,
    useFullScreenHandoff: noop,
    useTabRestoration: noop,
  };
});

jest.mock('./components', () => ({
  ModalBackdrop: () => null,
  LiveSessionTopBar: () => null,
  LiveSessionModals: () => null,
  DocsPanelContentArea: () => null,
  DocsPanelTabBar: ({ tabs, activeTabId }: { tabs: Array<{ id: string; title: string }>; activeTabId: string }) => (
    <div role="tablist">
      {tabs.map((tab) => (
        <button key={tab.id} role="tab" aria-selected={tab.id === activeTabId}>
          {tab.title}
        </button>
      ))}
    </div>
  ),
}));

import { tabStorage } from '../../lib/user-storage';
import { CombinedLearningJourneyPanel } from './docs-panel';

function renderPanel(panel: CombinedLearningJourneyPanel) {
  const Renderer = CombinedLearningJourneyPanel.Component;
  return render(<Renderer model={panel} />);
}

describe('Browse flag synchronization through the renderer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBrowseFlag = true;
  });

  it('drops an active Browse tab and falls back to Recommendations when the flag resolves off', async () => {
    const panel = new CombinedLearningJourneyPanel();
    panel.setActiveTab('browse');
    renderPanel(panel);
    expect(await screen.findByRole('tab', { name: 'Browse', selected: true })).toBeInTheDocument();
    jest.mocked(tabStorage.setActiveTab).mockClear();

    act(() => setBrowseFlag(false));

    expect(screen.queryByRole('tab', { name: 'Browse' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Recommendations', selected: true })).toBeInTheDocument();
    expect(panel.state.activeTabId).toBe('recommendations');
    expect(window.__DocsPluginActiveTabId).toBe('recommendations');
    expect(tabStorage.setActiveTab).toHaveBeenCalledWith('recommendations');
  });

  it('adds the Browse tab without activating it when the flag turns on after mount', async () => {
    mockBrowseFlag = false;
    const panel = new CombinedLearningJourneyPanel();
    renderPanel(panel);
    expect(await screen.findByRole('tab', { name: 'Recommendations', selected: true })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Browse' })).not.toBeInTheDocument();

    act(() => setBrowseFlag(true));

    expect(screen.getByRole('tab', { name: 'Browse', selected: false })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Recommendations', selected: true })).toBeInTheDocument();
  });
});
