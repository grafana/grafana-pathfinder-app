import { createBrowserHistory } from 'history';
import { HistoryWrapper, locationService, setLocationService } from '@grafana/runtime';

import { autoLaunchChannel } from '../global-state/auto-launch';
import {
  __resetDeepLinkHandlerStateForTests,
  handlePathfinderDeepLink,
  installDeepLinkNavListener,
} from './pathfinder-deep-link-handler';

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
  findDocPage: () => ({ url: 'bundled:cheerlights', title: 'CheerLights', type: 'interactive' }),
}));

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
