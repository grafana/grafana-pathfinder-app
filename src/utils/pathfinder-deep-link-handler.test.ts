/**
 * Tests for `pathfinder-deep-link-handler`.
 *
 * Locks down the SPA-navigation deep-link fix: `?doc=` arriving via runtime
 * URL changes must trigger the same auto-open path as a cold load.
 *
 * Coverage:
 *   - `handlePathfinderDeepLink` is a no-op when no Pathfinder params are
 *     present, dedupes same-search re-fires, and routes to the panelMode /
 *     control-group / find-doc-page branches.
 *   - `installDeepLinkNavListener` wires `history.listen` (primary) and
 *     falls back to `popstate` when `locationService.getHistory()` throws.
 */

jest.mock('../plugin.json', () => ({
  id: 'grafana-pathfinder-app',
}));

const mockLocationServiceReplace = jest.fn();
const mockHistoryListen = jest.fn().mockReturnValue(() => {});
let mockGetHistoryImpl: () => { listen: typeof mockHistoryListen } | null = () => ({ listen: mockHistoryListen });
let mockRouterPathname = '/';

jest.mock('@grafana/runtime', () => ({
  locationService: {
    replace: (path: string) => mockLocationServiceReplace(path),
    getHistory: () => mockGetHistoryImpl(),
    getLocation: () => ({ pathname: mockRouterPathname }),
  },
}));

const mockSetMode = jest.fn();
const mockGetMode = jest.fn().mockReturnValue('sidebar');
jest.mock('../global-state/panel-mode', () => ({
  panelModeManager: {
    setMode: (mode: string) => mockSetMode(mode),
    getMode: () => mockGetMode(),
  },
}));

const mockSetPendingOpenSource = jest.fn();
const mockGetIsSidebarMounted = jest.fn().mockReturnValue(false);
jest.mock('../global-state/sidebar', () => ({
  sidebarState: {
    setPendingOpenSource: (source: string, action: string) => mockSetPendingOpenSource(source, action),
    getIsSidebarMounted: () => mockGetIsSidebarMounted(),
  },
}));

const mockValidateRedirectPath = jest.fn((path: string) => path);
jest.mock('../security/url-validator', () => ({
  validateRedirectPath: (path: string) => mockValidateRedirectPath(path),
}));

const mockFindDocPage = jest.fn();
jest.mock('./find-doc-page', () => ({
  findDocPage: (id: string) => mockFindDocPage(id),
}));

import {
  __resetDeepLinkHandlerStateForTests,
  handlePathfinderDeepLink,
  installDeepLinkNavListener,
} from './pathfinder-deep-link-handler';
import { autoLaunchChannel, type AutoLaunchTutorialDetail } from '../global-state/auto-launch';

type Deps = Parameters<typeof handlePathfinderDeepLink>[0];

// Drain pending promise microtasks before resuming
const flushPromises = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
  }
};

const mkDeps = (overrides: Partial<Deps> = {}): Deps => ({
  shouldMountSidebar: true,
  attemptAutoOpen: jest.fn(),
  loadControlGroupDocPopup: jest.fn().mockResolvedValue({ showControlGroupDocPopup: jest.fn() }),
  ...overrides,
});

const setSearch = (search: string) => {
  // jsdom doesn't reflect `replaceState` calls into `window.location.search`
  // reliably in all versions — set the URL via `history.replaceState` so the
  // handler's `window.location.search` read matches what the test intends.
  const url = new URL(window.location.href);
  url.search = search;
  window.history.replaceState({}, '', url.toString());
};

const setPathname = (pathname: string, routerPathname = pathname) => {
  const url = new URL(window.location.href);
  url.pathname = pathname;
  window.history.replaceState({}, '', url.toString());
  mockRouterPathname = routerPathname;
};

describe('handlePathfinderDeepLink', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetDeepLinkHandlerStateForTests();
    setPathname('/');
    setSearch('');
    mockGetMode.mockReturnValue('sidebar');
    mockGetIsSidebarMounted.mockReturnValue(false);
    mockFindDocPage.mockReturnValue({
      url: 'https://grafana.com/docs/foo',
      title: 'Foo',
      type: 'docs-page',
    });
    mockGetHistoryImpl = () => ({ listen: mockHistoryListen });
  });

  it('returns false and does no work when no Pathfinder params are present', () => {
    setSearch('?keep=this');
    const deps = mkDeps();
    expect(handlePathfinderDeepLink(deps)).toBe(false);
    expect(deps.attemptAutoOpen).not.toHaveBeenCalled();
    expect(mockSetPendingOpenSource).not.toHaveBeenCalled();
  });

  it('does not match param names that merely contain a trigger as a substring', () => {
    // Another plugin's link might carry `my_doc=` or `kiosk_session_id=`; the
    // old substring check matched them and started spurious handler runs.
    for (const search of ['?my_doc=foo', '?kiosk_session_id=abc', '?some_panelMode=floating']) {
      setSearch(search);
      const deps = mkDeps();
      expect(handlePathfinderDeepLink(deps)).toBe(false);
      expect(deps.attemptAutoOpen).not.toHaveBeenCalled();
    }
  });

  it('dedupes consecutive calls with the same search string', async () => {
    setSearch('?doc=bundled%3Afoo');
    const deps = mkDeps();

    expect(handlePathfinderDeepLink(deps)).toBe(true);
    // Second call with the exact same search string is a no-op even before
    // strip-params would naturally short-circuit later fires.
    setSearch('?doc=bundled%3Afoo');
    expect(handlePathfinderDeepLink(deps)).toBe(false);

    // `findDocPage` is loaded via dynamic import — drain the microtask queue
    // so the inner `.then` callback settles before we assert.
    await flushPromises();
    expect(mockFindDocPage).toHaveBeenCalledTimes(1);
  });

  it('routes the control-group branch when sidebar is not mountable', async () => {
    setSearch('?doc=bundled%3Afoo&source=tile_click');
    const showControlGroupDocPopup = jest.fn();
    const loadControlGroupDocPopup = jest.fn().mockResolvedValue({ showControlGroupDocPopup });
    const deps = mkDeps({ shouldMountSidebar: false, loadControlGroupDocPopup });

    expect(handlePathfinderDeepLink(deps)).toBe(true);
    expect(window.location.search).toBe('');

    await flushPromises();
    expect(showControlGroupDocPopup).toHaveBeenCalledWith('tile_click');
    expect(mockFindDocPage).not.toHaveBeenCalled();
  });

  it('sets floating panel mode and strips panelMode from the URL', () => {
    setSearch('?panelMode=floating&keep=this');
    const deps = mkDeps();

    expect(handlePathfinderDeepLink(deps)).toBe(true);
    expect(mockSetMode).toHaveBeenCalledWith('floating');
    expect(window.location.search).toBe('?keep=this');
  });

  it('routes fullscreen panelMode to the in-app fullscreen page with doc + type forwarded', () => {
    setSearch('?panelMode=fullscreen&doc=bundled%3Afoo&type=learning-journey');
    const deps = mkDeps();

    expect(handlePathfinderDeepLink(deps)).toBe(true);
    expect(mockSetMode).toHaveBeenCalledWith('fullscreen');

    const target = mockLocationServiceReplace.mock.calls[0][0] as string;
    expect(target).toContain('/a/grafana-pathfinder-app/fullscreen?');
    const params = new URLSearchParams(target.split('?')[1]);
    expect(params.get('doc')).toBe('bundled:foo');
    expect(params.get('type')).toBe('learning-journey');
  });

  it('bails out on the full-screen route so it does not hijack the sidebar→full-screen handoff', async () => {
    // The handoff pushes `?doc=` onto the full-screen route; FullScreenPanel
    // owns that param. The global handler must not process it — otherwise a
    // guide with a `targetPage` gets redirected off the route (issue #1351).
    setPathname('/a/grafana-pathfinder-app/fullscreen');
    setSearch('?doc=bundled%3Awelcome-to-grafana&type=docs');
    mockGetMode.mockReturnValue('fullscreen');
    const deps = mkDeps();

    expect(handlePathfinderDeepLink(deps)).toBe(false);

    await flushPromises();
    expect(mockFindDocPage).not.toHaveBeenCalled();
    expect(mockLocationServiceReplace).not.toHaveBeenCalled();
    expect(mockSetPendingOpenSource).not.toHaveBeenCalled();
    expect(deps.attemptAutoOpen).not.toHaveBeenCalled();
    // The full-screen URL's `?doc=` must survive for FullScreenPanel's rehydration.
    expect(window.location.search).toBe('?doc=bundled%3Awelcome-to-grafana&type=docs');
  });

  it('bails out on the full-screen route when Grafana is served from a subpath', async () => {
    setPathname('/grafana/a/grafana-pathfinder-app/fullscreen', '/a/grafana-pathfinder-app/fullscreen');
    setSearch('?doc=bundled%3Awelcome-to-grafana&type=docs');
    const deps = mkDeps();

    expect(handlePathfinderDeepLink(deps)).toBe(false);

    await flushPromises();
    expect(mockFindDocPage).not.toHaveBeenCalled();
    expect(mockLocationServiceReplace).not.toHaveBeenCalled();
    expect(mockSetPendingOpenSource).not.toHaveBeenCalled();
    expect(deps.attemptAutoOpen).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?doc=bundled%3Awelcome-to-grafana&type=docs');
  });

  it('still processes a ?doc= link on a look-alike route that is not exactly the full-screen route', async () => {
    // Guards the exact-match strictness: a `fullscreen`-prefixed but non-equal
    // pathname must NOT bail. A future loosening to startsWith/includes would
    // regress normal routes and this test would catch it.
    setPathname('/a/grafana-pathfinder-app/fullscreen-extra');
    setSearch('?doc=bundled%3Afoo');
    const deps = mkDeps();

    expect(handlePathfinderDeepLink(deps)).toBe(true);
    await flushPromises();
    expect(mockFindDocPage).toHaveBeenCalledWith('bundled:foo');
  });

  it('dispatches auto-launch-tutorial when the sidebar is already mounted (SPA-arrival case)', async () => {
    jest.useFakeTimers();
    try {
      setSearch('?doc=bundled%3Afoo&source=url_param');
      mockGetIsSidebarMounted.mockReturnValue(true);

      const deps = mkDeps();
      const events: AutoLaunchTutorialDetail[] = [];
      const unsubscribe = autoLaunchChannel.subscribe((detail) => events.push(detail));
      // Discard any value a prior test latched and delivered on subscribe.
      events.length = 0;

      expect(handlePathfinderDeepLink(deps)).toBe(true);

      // Drain microtasks so the dynamic import + its `.then` callback settle
      // before we advance fake timers for the auto-launch delay.
      await flushPromises();

      // The mount-then-dispatch waits 500ms before emitting.
      jest.advanceTimersByTime(500);
      unsubscribe();

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        url: 'https://grafana.com/docs/foo',
        title: 'Foo',
        type: 'docs-page',
        source: 'url_param',
      });
      expect(deps.attemptAutoOpen).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('skips the auto-launch emit when the surface unmounts before the 500ms timer fires', async () => {
    jest.useFakeTimers();
    try {
      setSearch('?doc=bundled%3Afoo&source=url_param');
      mockGetIsSidebarMounted.mockReturnValue(true);

      const events: AutoLaunchTutorialDetail[] = [];
      const unsubscribe = autoLaunchChannel.subscribe((detail) => events.push(detail));
      events.length = 0;

      handlePathfinderDeepLink(mkDeps());
      await flushPromises();

      // Surface unmounts during the 500ms delay: the queued emit must not fire,
      // or a stale value latches and replays on a later manual open.
      mockGetIsSidebarMounted.mockReturnValue(false);
      jest.advanceTimersByTime(500);
      unsubscribe();

      expect(events).toHaveLength(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('honors explicit ?type=learning-journey over findDocPage classification', async () => {
    jest.useFakeTimers();
    try {
      setSearch('?doc=bundled%3Afoo&type=learning-journey');
      mockGetIsSidebarMounted.mockReturnValue(true);
      // Simulate the case from the comments: package URL classifies as
      // 'interactive' but is really a learning journey.
      mockFindDocPage.mockReturnValue({
        url: 'https://example.com/packages/foo/content.json',
        title: 'Foo',
        type: 'interactive',
      });

      const events: AutoLaunchTutorialDetail[] = [];
      const unsubscribe = autoLaunchChannel.subscribe((detail) => events.push(detail));
      events.length = 0;

      handlePathfinderDeepLink(mkDeps());
      await flushPromises();
      jest.advanceTimersByTime(500);
      unsubscribe();

      expect(events[0]?.type).toBe('learning-journey');
    } finally {
      jest.useRealTimers();
    }
  });

  it('re-runs the handler when the user nav-aways and returns to the same ?doc=', async () => {
    setSearch('?doc=bundled%3Afoo');
    const deps = mkDeps();

    // First arrival: handler runs and the async branch strips the search.
    expect(handlePathfinderDeepLink(deps)).toBe(true);
    await flushPromises();
    expect(mockFindDocPage).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe('');

    // User navigates away to a URL without Pathfinder params.
    setSearch('?tab=overview');
    expect(handlePathfinderDeepLink(deps)).toBe(false);

    // User returns to the original ?doc= link.
    setSearch('?doc=bundled%3Afoo');
    expect(handlePathfinderDeepLink(deps)).toBe(true);
    await flushPromises();
    expect(mockFindDocPage).toHaveBeenCalledTimes(2);
  });

  it('strips stale params when findDocPage returns null (bad doc) and still opens the sidebar', async () => {
    setSearch('?doc=garbage');
    mockFindDocPage.mockReturnValue(null);

    const deps = mkDeps();
    handlePathfinderDeepLink(deps);

    await flushPromises();

    expect(window.location.search).toBe('');
    expect(deps.attemptAutoOpen).toHaveBeenCalledWith(200);
    expect(mockSetPendingOpenSource).toHaveBeenCalledWith('url_param', 'auto-open');
  });
});

describe('installDeepLinkNavListener', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetDeepLinkHandlerStateForTests();
    setPathname('/');
    setSearch('');
    mockGetHistoryImpl = () => ({ listen: mockHistoryListen });
  });

  it('registers history.listen', () => {
    installDeepLinkNavListener(mkDeps());
    expect(mockHistoryListen).toHaveBeenCalledTimes(1);
  });

  it('falls back to popstate only when locationService.getHistory throws', () => {
    mockGetHistoryImpl = () => {
      throw new Error('not available');
    };
    const popstateSpy = jest.spyOn(window, 'addEventListener');

    installDeepLinkNavListener(mkDeps());

    expect(popstateSpy).toHaveBeenCalledWith('popstate', expect.any(Function));
    popstateSpy.mockRestore();
  });

  it('skips the parse + dedup machinery on URL changes that carry no Pathfinder params', () => {
    installDeepLinkNavListener(mkDeps());
    // Simulate a SPA navigation to a page without any pathfinder params.
    const historyHandler = mockHistoryListen.mock.calls[0][0] as () => void;
    setSearch('?tab=overview');
    historyHandler();
    expect(mockFindDocPage).not.toHaveBeenCalled();
  });

  it('re-runs the handler when the URL changes to include ?doc=', async () => {
    installDeepLinkNavListener(mkDeps());
    const historyHandler = mockHistoryListen.mock.calls[0][0] as () => void;

    setSearch('?doc=bundled%3Afoo');
    historyHandler();

    await flushPromises();
    expect(mockFindDocPage).toHaveBeenCalledWith('bundled:foo');
  });

  it('does not process a ?doc= navigation that lands on the full-screen route (issue #1351)', async () => {
    installDeepLinkNavListener(mkDeps());
    const historyHandler = mockHistoryListen.mock.calls[0][0] as () => void;

    setPathname('/a/grafana-pathfinder-app/fullscreen');
    setSearch('?doc=bundled%3Awelcome-to-grafana&type=docs');
    historyHandler();

    await flushPromises();
    expect(mockFindDocPage).not.toHaveBeenCalled();
    expect(mockLocationServiceReplace).not.toHaveBeenCalled();
  });

  it('does not process a full-screen navigation under a Grafana subpath', async () => {
    installDeepLinkNavListener(mkDeps());
    const historyHandler = mockHistoryListen.mock.calls[0][0] as () => void;

    setPathname('/grafana/a/grafana-pathfinder-app/fullscreen', '/a/grafana-pathfinder-app/fullscreen');
    setSearch('?doc=bundled%3Awelcome-to-grafana&type=docs');
    historyHandler();

    await flushPromises();
    expect(mockFindDocPage).not.toHaveBeenCalled();
    expect(mockLocationServiceReplace).not.toHaveBeenCalled();
  });
});
