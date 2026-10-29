import { HistoryWrapper, locationService, setLocationService } from '@grafana/runtime';

import { autoLaunchChannel } from '../global-state/auto-launch';
import { __resetDeepLinkHandlerStateForTests, handlePathfinderDeepLink } from './pathfinder-deep-link-handler';
import { installDeepLinkNavListener } from './pathfinder-deep-link-loader';

jest.mock('../global-state/panel-mode', () => ({
  panelModeManager: {
    setModePersisted: jest.fn(),
    getMode: () => 'sidebar',
  },
}));
jest.mock('../global-state/sidebar', () => ({
  sidebarState: {
    setPendingOpenSource: jest.fn(),
    getIsSidebarMounted: () => true,
  },
}));
jest.mock('./find-doc-page', () => ({
  findDocPage: (id: string) =>
    id === 'invalid' ? null : { url: 'bundled:cheerlights', title: 'CheerLights', type: 'interactive' },
}));

const { createBrowserHistory } = jest.requireActual<{
  createBrowserHistory: (options: { basename: string }) => NonNullable<ConstructorParameters<typeof HistoryWrapper>[0]>;
}>('history');

const doc = 'bundled:cheerlights';
const flush = async () => {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
  jest.runOnlyPendingTimers();
};

describe('consumed deep links with Grafana browser history', () => {
  const originalService = locationService;
  const deps = { attemptAutoOpen: jest.fn() };
  let unsubscribe: () => void;
  let launch: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    __resetDeepLinkHandlerStateForTests();
    launch = jest.fn();
    unsubscribe = autoLaunchChannel.subscribe(launch);
  });

  afterEach(() => {
    window.__pathfinderDeepLinkNavUnlisten?.();
    window.__pathfinderDeepLinkNavUnlisten = undefined;
    unsubscribe();
    setLocationService(originalService);
    jest.useRealTimers();
  });

  const arrive = (basename = '', extra = '') => {
    window.history.replaceState(
      {},
      '',
      `${basename}/d/cheerlights?orgId=1&from=now-6h&to=now&doc=${encodeURIComponent(doc)}${extra}#panel-3`
    );
    setLocationService(new HistoryWrapper(createBrowserHistory({ basename })));
    locationService.getHistory().replace({ ...locationService.getLocation(), state: { draft: 'keep-me' } });
    installDeepLinkNavListener(deps);
    handlePathfinderDeepLink(deps);
  };

  it.each(['', '/grafana'])(
    'cleans browser and router state under basename %s before Edit or time changes',
    async (basename) => {
      arrive(basename);
      await flush();

      expect(window.location.pathname).toBe(`${basename}/d/cheerlights`);
      expect(locationService.getLocation().pathname).toBe('/d/cheerlights');
      expect(locationService.getSearch().has('doc')).toBe(false);
      expect(new URLSearchParams(window.location.search).has('doc')).toBe(false);
      expect(locationService.getLocation().hash).toBe('#panel-3');
      expect(locationService.getLocation().state).toEqual({ draft: 'keep-me' });
      expect(window.history.state.state).toEqual({ draft: 'keep-me' });
      expect(locationService.getSearchObject()).toMatchObject({ orgId: '1', from: 'now-6h', to: 'now' });
      expect(launch).toHaveBeenCalledTimes(1);

      const edit = new URLSearchParams(locationService.getLocation().search);
      edit.set('editPanel', '3');
      const href = locationService.getHistory().createHref({ ...locationService.getLocation(), search: `?${edit}` });
      expect(new URL(href, window.location.origin).searchParams.has('doc')).toBe(false);
      locationService.partial({ editPanel: 3 });
      locationService.partial({ from: 'now-1h', to: 'now' });
      await flush();
      expect(locationService.getSearch().has('doc')).toBe(false);
      expect(new URLSearchParams(window.location.search).has('doc')).toBe(false);
      expect(launch).toHaveBeenCalledTimes(1);

      locationService.partial({ doc });
      await flush();
      expect(launch).toHaveBeenCalledTimes(2);
      expect(locationService.getSearch().has('doc')).toBe(false);
    }
  );

  it('preserves fullscreen doc ownership while consuming panel mode under a subpath', async () => {
    window.history.replaceState({}, '', '/grafana/a/grafana-pathfinder-app/fullscreen?doc=bundled%3Acheerlights');
    setLocationService(new HistoryWrapper(createBrowserHistory({ basename: '/grafana' })));
    installDeepLinkNavListener(deps);
    expect(handlePathfinderDeepLink(deps)).toBe(false);
    expect(locationService.getSearch().get('doc')).toBe(doc);
    expect(launch).not.toHaveBeenCalled();

    locationService.partial({ panelMode: 'floating' });
    await flush();
    expect(locationService.getLocation().pathname).toBe('/a/grafana-pathfinder-app/fullscreen');
    expect(window.location.pathname).toBe('/grafana/a/grafana-pathfinder-app/fullscreen');
    expect(locationService.getSearch().get('doc')).toBe(doc);
    expect(locationService.getSearch().has('panelMode')).toBe(false);
    expect(launch).not.toHaveBeenCalled();
  });

  it.each(['', '/grafana'])('routes a fullscreen doc arrival under basename %s without replay', async (basename) => {
    arrive(basename, '&panelMode=fullscreen&type=learning-journey');
    await flush();

    expect(locationService.getLocation().pathname).toBe('/a/grafana-pathfinder-app/fullscreen');
    expect(window.location.pathname).toBe(`${basename}/a/grafana-pathfinder-app/fullscreen`);
    expect(locationService.getSearch().has('panelMode')).toBe(false);
    expect(locationService.getSearch().has('doc')).toBe(false);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ url: doc, type: 'learning-journey' }));

    locationService.partial({ from: 'now-1h' });
    await flush();
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('cleans invalid doc arrivals and allows validated page redirects without replay', async () => {
    arrive();
    await flush();
    launch.mockClear();
    deps.attemptAutoOpen.mockClear();
    locationService.partial({ doc: 'invalid', source: 'dashboard', panelMode: 'sidebar' });
    await flush();
    expect(locationService.getSearch().has('doc')).toBe(false);
    expect(launch).not.toHaveBeenCalled();
    expect(deps.attemptAutoOpen).toHaveBeenCalledTimes(1);

    locationService.partial({ doc, page: '/explore' });
    await flush();
    expect(locationService.getLocation().pathname).toBe('/explore');
    expect(locationService.getSearch().has('doc')).toBe(false);
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it.each(['sidebar', 'floating'])(
    'consumes doc with panelMode=%s without a reentrant duplicate launch',
    async (mode) => {
      arrive('', `&panelMode=${mode}&source=dashboard`);
      await flush();
      expect(launch).toHaveBeenCalledTimes(1);
      expect(locationService.getSearch().has('doc')).toBe(false);
      expect(locationService.getSearch().has('panelMode')).toBe(false);
      expect(locationService.getSearch().has('source')).toBe(false);
      expect(deps.attemptAutoOpen).toHaveBeenCalledTimes(1);
    }
  );
});
