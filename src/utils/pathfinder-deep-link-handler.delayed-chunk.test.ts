import { HistoryWrapper, locationService, setLocationService } from '@grafana/runtime';

import { autoLaunchChannel } from '../global-state/auto-launch';
import { __resetDeepLinkHandlerStateForTests } from './pathfinder-deep-link-handler';
import { handlePathfinderDeepLink, installDeepLinkNavListener } from './pathfinder-deep-link-loader';

let mockMode = 'sidebar';
let mockChunkGate: Promise<void>;
const mockFindDocPage = jest.fn();

jest.mock('../global-state/panel-mode', () => ({
  panelModeManager: {
    setModePersisted: (mode: string) => {
      mockMode = mode;
    },
    getMode: () => mockMode,
  },
}));
jest.mock('../global-state/sidebar', () => ({
  sidebarState: {
    setPendingOpenSource: jest.fn(),
    getIsSidebarMounted: () => true,
  },
}));
jest.mock('./find-doc-page', () => ({
  __esModule: true,
  // Import promises assimilate this thenable, allowing real chunk latency without a production test seam.
  then: (resolve: (module: unknown) => void) => mockChunkGate.then(() => resolve({ findDocPage: mockFindDocPage })),
}));

const { createBrowserHistory } = jest.requireActual<{
  createBrowserHistory: (options: { basename: string }) => NonNullable<ConstructorParameters<typeof HistoryWrapper>[0]>;
}>('history');

const drainMicrotasks = async () => {
  for (let i = 0; i < 30; i++) {
    await Promise.resolve();
  }
};

describe('deep-link arrivals while the document chunk is pending', () => {
  const originalService = locationService;
  const doc = 'bundled:cheerlights';
  const deps = { attemptAutoOpen: jest.fn() };
  let releaseChunk: () => void;
  let unsubscribe: () => void;
  let launch: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    __resetDeepLinkHandlerStateForTests();
    mockMode = 'sidebar';
    mockChunkGate = new Promise<void>((resolve) => {
      releaseChunk = resolve;
    });
    mockFindDocPage.mockReturnValue({ url: doc, title: 'CheerLights', type: 'interactive' });
    launch = jest.fn();
    unsubscribe = autoLaunchChannel.subscribe(launch);
    launch.mockClear();
  });

  afterEach(() => {
    window.__pathfinderDeepLinkNavUnlisten?.();
    window.__pathfinderDeepLinkNavUnlisten = undefined;
    unsubscribe();
    setLocationService(originalService);
    jest.useRealTimers();
  });

  it.each([
    ['sidebar', ''],
    ['floating', ''],
    ['sidebar', '/grafana'],
    ['floating', '/grafana'],
  ])('launches once for %s under basename %s and permits a fresh identical arrival', async (mode, basename) => {
    window.history.replaceState(
      {},
      '',
      `${basename}/d/cheerlights?orgId=1&doc=${encodeURIComponent(doc)}&panelMode=${mode}&source=dashboard#panel-3`
    );
    setLocationService(new HistoryWrapper(createBrowserHistory({ basename })));
    locationService.getHistory().replace({ ...locationService.getLocation(), state: { draft: 'keep-me' } });
    installDeepLinkNavListener(deps);
    handlePathfinderDeepLink(deps);
    await drainMicrotasks();

    expect(mockFindDocPage).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();

    setTimeout(releaseChunk, 1);
    jest.advanceTimersByTime(1);
    await drainMicrotasks();
    jest.advanceTimersByTime(500);

    expect(mockFindDocPage).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ url: doc, source: 'dashboard' }));
    expect(deps.attemptAutoOpen).toHaveBeenCalledTimes(mode === 'sidebar' ? 1 : 0);
    expect(window.location.pathname).toBe(`${basename}/d/cheerlights`);
    expect(locationService.getLocation()).toMatchObject({
      pathname: '/d/cheerlights',
      search: '?orgId=1',
      hash: '#panel-3',
      state: { draft: 'keep-me' },
    });
    expect(window.location.search).toBe('?orgId=1');

    locationService.partial({ editPanel: 3, from: 'now-1h' });
    await drainMicrotasks();
    jest.advanceTimersByTime(500);
    expect(mockFindDocPage).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledTimes(1);

    locationService.partial({ doc, panelMode: mode, source: 'dashboard' });
    await drainMicrotasks();
    jest.advanceTimersByTime(500);
    expect(mockFindDocPage).toHaveBeenCalledTimes(2);
    expect(launch).toHaveBeenCalledTimes(2);
    expect(locationService.getSearch().has('doc')).toBe(false);
  });
});
