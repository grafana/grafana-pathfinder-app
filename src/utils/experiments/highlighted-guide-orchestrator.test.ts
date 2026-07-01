/**
 * Tests for highlighted-guide-orchestrator
 *
 * - initializeHighlightedGuideExperiment: flag read + resetCache state machine
 * - setupHighlightedGuideAutoOpen: guard order, sidebar auto-open, nav-listener
 *   arming, and `auto-launch-tutorial` mount-then-dispatch wiring.
 */

jest.mock('../../plugin.json', () => ({
  id: 'grafana-pathfinder-app',
}));

const mockGetLocation = jest.fn().mockReturnValue({ pathname: '/dashboards' });
const mockHistoryListen = jest.fn();

jest.mock('@grafana/runtime', () => ({
  locationService: {
    getLocation: () => mockGetLocation(),
    getHistory: () => ({ listen: mockHistoryListen }),
  },
}));

jest.mock('../../lib/storage-keys', () => ({
  StorageKeys: {
    HIGHLIGHTED_GUIDE_AUTO_OPEN_PREFIX: 'grafana-pathfinder-highlighted-guide-auto-open-',
    HIGHLIGHTED_GUIDE_RESET_PROCESSED_PREFIX: 'grafana-pathfinder-highlighted-guide-reset-processed-',
  },
}));

const mockSetPendingOpenSource = jest.fn();
const mockGetIsSidebarMounted = jest.fn().mockReturnValue(false);
jest.mock('../../global-state/sidebar', () => ({
  sidebarState: {
    setPendingOpenSource: (source: string, action: string) => mockSetPendingOpenSource(source, action),
    getIsSidebarMounted: () => mockGetIsSidebarMounted(),
  },
}));

const mockFindDocPage = jest.fn();
jest.mock('../find-doc-page', () => ({
  findDocPage: (id: string) => mockFindDocPage(id),
}));

// Regression mock: the previous orchestrator pinned `recommendations` via
// `tabStorage.setActiveTab` before auto-open so the user landed on the
// Featured slot. The new auto-launch flow opens the guide as its own tab,
// so pinning would flicker between tabs. This mock lets us assert it's
// NEVER called — if anyone re-introduces `tabStorage.setActiveTab` in the
// orchestrator, the assertion will fail.
const mockSetActiveTab = jest.fn().mockResolvedValue(undefined);
jest.mock('../../lib/user-storage', () => ({
  tabStorage: {
    setActiveTab: (tabId: string) => mockSetActiveTab(tabId),
  },
}));

const mockAttemptAutoOpen = jest.fn();
jest.mock('../sidebar-auto-open', () => ({
  attemptAutoOpen: () => mockAttemptAutoOpen(),
}));

const mockGetHighlightedGuideConfig = jest.fn();
jest.mock('../openfeature', () => ({
  getHighlightedGuideConfig: () => mockGetHighlightedGuideConfig(),
  matchPathPattern: (pattern: string, path: string) => {
    if (pattern.endsWith('*')) {
      return path.startsWith(pattern.slice(0, -1));
    }
    return path === pattern || path === pattern + '/';
  },
}));

const mockIsExtensionSidebarOwnedByOther = jest.fn().mockReturnValue(false);
jest.mock('../../lib/storage/extension-sidebar', () => ({
  isExtensionSidebarOwnedByOther: (id: string) => mockIsExtensionSidebarOwnedByOther(id),
}));

import { initializeHighlightedGuideExperiment, setupHighlightedGuideAutoOpen } from './highlighted-guide-orchestrator';

const HOSTNAME = 'stack-a.grafana.net';

const baseConfig = {
  variant: 'treatment' as const,
  pages: ['/connections/datasources*'],
  guideId: 'bundled:onboarding',
  autoOpen: true,
  resetCache: false,
};

describe('initializeHighlightedGuideExperiment', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    mockIsExtensionSidebarOwnedByOther.mockReturnValue(false);
  });

  it('returns the config from the flag and does not touch storage when resetCache is false', () => {
    mockGetHighlightedGuideConfig.mockReturnValue({ ...baseConfig, resetCache: false });
    const result = initializeHighlightedGuideExperiment(HOSTNAME);
    expect(result.variant).toBe('treatment');
    expect(localStorage.getItem(`grafana-pathfinder-highlighted-guide-reset-processed-${HOSTNAME}`)).toBeNull();
  });

  it('clears existing markers and sets sentinel to true on a false→true resetCache transition', () => {
    localStorage.setItem(`grafana-pathfinder-highlighted-guide-auto-open-${HOSTNAME}:bundled:onboarding`, 'true');
    mockGetHighlightedGuideConfig.mockReturnValue({ ...baseConfig, resetCache: true });

    initializeHighlightedGuideExperiment(HOSTNAME);

    expect(
      localStorage.getItem(`grafana-pathfinder-highlighted-guide-auto-open-${HOSTNAME}:bundled:onboarding`)
    ).toBeNull();
    expect(localStorage.getItem(`grafana-pathfinder-highlighted-guide-reset-processed-${HOSTNAME}`)).toBe('true');
  });

  it('does not re-clear markers when resetCache stays true across reloads (sentinel already set)', () => {
    localStorage.setItem(`grafana-pathfinder-highlighted-guide-reset-processed-${HOSTNAME}`, 'true');
    localStorage.setItem(`grafana-pathfinder-highlighted-guide-auto-open-${HOSTNAME}:bundled:onboarding`, 'true');
    mockGetHighlightedGuideConfig.mockReturnValue({ ...baseConfig, resetCache: true });

    initializeHighlightedGuideExperiment(HOSTNAME);

    expect(localStorage.getItem(`grafana-pathfinder-highlighted-guide-auto-open-${HOSTNAME}:bundled:onboarding`)).toBe(
      'true'
    );
  });

  it('rearms by flipping sentinel to false on a true→false resetCache transition', () => {
    localStorage.setItem(`grafana-pathfinder-highlighted-guide-reset-processed-${HOSTNAME}`, 'true');
    mockGetHighlightedGuideConfig.mockReturnValue({ ...baseConfig, resetCache: false });

    initializeHighlightedGuideExperiment(HOSTNAME);

    expect(localStorage.getItem(`grafana-pathfinder-highlighted-guide-reset-processed-${HOSTNAME}`)).toBe('false');
  });
});

describe('setupHighlightedGuideAutoOpen', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    mockIsExtensionSidebarOwnedByOther.mockReturnValue(false);
    mockGetIsSidebarMounted.mockReturnValue(false);
    // Default: findDocPage resolves so the auto-launch dispatch fires.
    mockFindDocPage.mockReturnValue({
      url: 'https://grafana.com/docs/onboarding',
      title: 'Onboarding',
      type: 'docs-page',
    });
  });

  it('short-circuits on variant = excluded', () => {
    setupHighlightedGuideAutoOpen({ ...baseConfig, variant: 'excluded' }, '/connections/datasources', HOSTNAME);
    expect(mockAttemptAutoOpen).not.toHaveBeenCalled();
    expect(mockHistoryListen).not.toHaveBeenCalled();
  });

  it('short-circuits on autoOpen = false', () => {
    setupHighlightedGuideAutoOpen({ ...baseConfig, autoOpen: false }, '/connections/datasources', HOSTNAME);
    expect(mockAttemptAutoOpen).not.toHaveBeenCalled();
    expect(mockHistoryListen).not.toHaveBeenCalled();
  });

  it('short-circuits on empty guideId (cannot mark, would loop)', () => {
    setupHighlightedGuideAutoOpen({ ...baseConfig, guideId: '' }, '/connections/datasources', HOSTNAME);
    expect(mockAttemptAutoOpen).not.toHaveBeenCalled();
  });

  it('auto-opens and marks when page matches and no marker exists', () => {
    setupHighlightedGuideAutoOpen(baseConfig, '/connections/datasources/new', HOSTNAME);
    expect(mockSetPendingOpenSource).toHaveBeenCalledWith('highlighted_guide_experiment', 'auto-open');
    expect(mockAttemptAutoOpen).toHaveBeenCalled();
    expect(localStorage.getItem(`grafana-pathfinder-highlighted-guide-auto-open-${HOSTNAME}:bundled:onboarding`)).toBe(
      'true'
    );
  });

  it('does NOT pin the recommendations tab (the auto-launched guide tab takes focus instead)', () => {
    // Regression: the previous behavior pinned `recommendations` via
    // `tabStorage.setActiveTab` so the user landed on the Featured slot.
    // The new flow auto-launches the guide as its own tab, so pinning would
    // flicker.
    setupHighlightedGuideAutoOpen(baseConfig, '/connections/datasources/new', HOSTNAME);
    expect(mockSetActiveTab).not.toHaveBeenCalled();
  });

  it('skips auto-open when marker is already set for the same guideId', () => {
    localStorage.setItem(`grafana-pathfinder-highlighted-guide-auto-open-${HOSTNAME}:bundled:onboarding`, 'true');
    setupHighlightedGuideAutoOpen(baseConfig, '/connections/datasources/new', HOSTNAME);
    expect(mockAttemptAutoOpen).not.toHaveBeenCalled();
  });

  it('does not auto-open on a non-matching path, but still installs a nav listener', () => {
    setupHighlightedGuideAutoOpen(baseConfig, '/dashboards', HOSTNAME);
    expect(mockAttemptAutoOpen).not.toHaveBeenCalled();
    expect(mockHistoryListen).toHaveBeenCalled();
  });

  it('arms the nav listener which then fires auto-open on first matching navigation', () => {
    setupHighlightedGuideAutoOpen(baseConfig, '/dashboards', HOSTNAME);
    const handler = mockHistoryListen.mock.calls[0]?.[0];
    expect(handler).toBeDefined();

    mockGetLocation.mockReturnValueOnce({ pathname: '/connections/datasources/new' });
    handler?.();

    expect(mockAttemptAutoOpen).toHaveBeenCalled();
  });

  it('does not steal the sidebar from another plugin', () => {
    mockIsExtensionSidebarOwnedByOther.mockReturnValue(true);
    setupHighlightedGuideAutoOpen(baseConfig, '/connections/datasources/new', HOSTNAME);
    expect(mockAttemptAutoOpen).not.toHaveBeenCalled();
  });
});

// ============================================================================
// auto-launch-tutorial dispatch
// ============================================================================
//
// These tests pin the contract between `setupHighlightedGuideAutoOpen` and
// the `useAutoLaunchTutorial` hook: after the sidebar (or panel) mounts, the
// orchestrator must dispatch `auto-launch-tutorial` with a payload derived
// from `findDocPage(guideId)` and tagged with `source: 'highlighted_guide_experiment'`.
//
// `useAutoLaunchTutorial.test.ts` separately verifies that the hook routes
// that payload to `openDocsPage` / `openLearningJourney` without navigating
// the user away from their current page.
describe('setupHighlightedGuideAutoOpen → auto-launch-tutorial dispatch', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.useFakeTimers();
    // Drain any `pathfinder-sidebar-mounted` / `pathfinder-panel-mounted`
    // listeners installed by previous tests' `setupHighlightedGuideAutoOpen`
    // calls. The orchestrator registers them with `{ once: true }`, so
    // dispatching the events here causes them all to self-remove. We then
    // flush the 500ms setTimeout each one queued so a stale `auto-launch-tutorial`
    // can't fire mid-test once a real handler is wired up.
    window.dispatchEvent(new Event('pathfinder-sidebar-mounted'));
    document.dispatchEvent(new Event('pathfinder-panel-mounted'));
    jest.runAllTimers();
    jest.clearAllMocks();
    mockIsExtensionSidebarOwnedByOther.mockReturnValue(false);
    mockGetIsSidebarMounted.mockReturnValue(false);
    mockFindDocPage.mockReturnValue({
      url: 'https://grafana.com/docs/onboarding',
      title: 'Onboarding',
      type: 'docs-page',
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function captureAutoLaunch(): jest.Mock {
    const handler = jest.fn();
    document.addEventListener('auto-launch-tutorial', handler);
    return handler;
  }

  it('dispatches auto-launch-tutorial on sidebar mount with findDocPage-resolved url/title/type', () => {
    const handler = captureAutoLaunch();
    setupHighlightedGuideAutoOpen(baseConfig, '/connections/datasources/new', HOSTNAME);

    // attemptAutoOpen is mocked, so no real mount fires. Simulate it.
    window.dispatchEvent(new Event('pathfinder-sidebar-mounted'));
    jest.advanceTimersByTime(500);

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toEqual({
      url: 'https://grafana.com/docs/onboarding',
      title: 'Onboarding',
      type: 'docs-page',
      source: 'highlighted_guide_experiment',
    });
  });

  it('also dispatches on the floating panel mount event (whichever surface mounts first)', () => {
    const handler = captureAutoLaunch();
    setupHighlightedGuideAutoOpen(baseConfig, '/connections/datasources/new', HOSTNAME);

    document.dispatchEvent(new Event('pathfinder-panel-mounted'));
    jest.advanceTimersByTime(500);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('dispatches synchronously when the sidebar is already mounted (SPA nav case)', () => {
    mockGetIsSidebarMounted.mockReturnValue(true);
    const handler = captureAutoLaunch();

    setupHighlightedGuideAutoOpen(baseConfig, '/connections/datasources/new', HOSTNAME);
    jest.advanceTimersByTime(500);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('honors the docType operator override when set (forces the click-through flow)', () => {
    // `findDocPage` returned type: 'docs-page'; the operator-configured
    // `docType: 'learning-journey'` should win so the hook routes to
    // `openLearningJourney`.
    const handler = captureAutoLaunch();
    setupHighlightedGuideAutoOpen(
      { ...baseConfig, docType: 'learning-journey' },
      '/connections/datasources/new',
      HOSTNAME
    );

    window.dispatchEvent(new Event('pathfinder-sidebar-mounted'));
    jest.advanceTimersByTime(500);

    const event = handler.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toEqual(
      expect.objectContaining({
        type: 'learning-journey',
        source: 'highlighted_guide_experiment',
      })
    );
  });

  it('fires exactly once even when both sidebar and panel mount events arrive', () => {
    const handler = captureAutoLaunch();
    setupHighlightedGuideAutoOpen(baseConfig, '/connections/datasources/new', HOSTNAME);

    // Race condition: both surfaces mount (e.g. user toggles floating mode
    // mid-flight). The orchestrator's `autoLaunched` guard must prevent a
    // duplicate dispatch.
    window.dispatchEvent(new Event('pathfinder-sidebar-mounted'));
    document.dispatchEvent(new Event('pathfinder-panel-mounted'));
    jest.advanceTimersByTime(500);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('still opens the sidebar but skips auto-launch when findDocPage returns null (fallback to Featured injection)', () => {
    mockFindDocPage.mockReturnValue(null);
    const handler = captureAutoLaunch();

    setupHighlightedGuideAutoOpen(baseConfig, '/connections/datasources/new', HOSTNAME);
    window.dispatchEvent(new Event('pathfinder-sidebar-mounted'));
    jest.advanceTimersByTime(500);

    // Sidebar still opens — the user gets the Featured-slot card from
    // `injectHighlightedGuide` as a fallback.
    expect(mockAttemptAutoOpen).toHaveBeenCalled();
    // ...but no auto-launch event fires because we couldn't resolve the guide.
    expect(handler).not.toHaveBeenCalled();
    // Marker is still set so we don't retry on every reload of a misconfigured flag.
    expect(localStorage.getItem(`grafana-pathfinder-highlighted-guide-auto-open-${HOSTNAME}:bundled:onboarding`)).toBe(
      'true'
    );
  });

  it('fires the pathfinder-auto-launch-pending coordination event synchronously on mount', () => {
    // The floating panel listens for this to short-circuit its empty-state
    // fallback before the 500ms auto-launch-tutorial dispatch lands.
    const pendingHandler = jest.fn();
    document.addEventListener('pathfinder-auto-launch-pending', pendingHandler);

    setupHighlightedGuideAutoOpen(baseConfig, '/connections/datasources/new', HOSTNAME);
    window.dispatchEvent(new Event('pathfinder-sidebar-mounted'));

    // The pending event is dispatched BEFORE the 500ms setTimeout, so we
    // shouldn't need to advance timers to observe it.
    expect(pendingHandler).toHaveBeenCalledTimes(1);
  });
});
