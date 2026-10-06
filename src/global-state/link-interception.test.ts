import { linkInterceptionState } from './link-interception';
import { panelModeManager, type PanelMode } from './panel-mode';
import { sidebarState } from './sidebar';
import { AUTO_OPEN_DOCS_EVENT } from '../lib/event-names';
import { reportAppInteraction } from '../lib/analytics';

jest.mock('./sidebar', () => ({
  sidebarState: {
    getIsSidebarMounted: jest.fn(),
    openSidebar: jest.fn(),
    setPendingOpenSource: jest.fn(),
  },
}));

jest.mock('./panel-mode', () => ({
  panelModeManager: { getMode: jest.fn() },
}));

jest.mock('../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: { GlobalDocsLinkIntercepted: 'global_docs_link_intercepted' },
}));

const DOCS_URL = 'https://grafana.com/docs/grafana/latest/alerting/';

const mockedGetMode = panelModeManager.getMode as jest.MockedFunction<typeof panelModeManager.getMode>;
const mockedIsSidebarMounted = sidebarState.getIsSidebarMounted as jest.MockedFunction<
  typeof sidebarState.getIsSidebarMounted
>;

function clickDocsLink(): MouseEvent {
  document.body.innerHTML = `<a href="${DOCS_URL}"><span id="label">Alerting</span></a>`;
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
  document.getElementById('label')!.dispatchEvent(event);
  return event;
}

function listenAsSurface(accept: boolean) {
  const listener = jest.fn((event: Event) => {
    if (accept) {
      event.preventDefault();
    }
  });
  document.addEventListener(AUTO_OPEN_DOCS_EVENT, listener);
  return listener;
}

let listeners: jest.Mock[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetMode.mockReturnValue('sidebar');
  mockedIsSidebarMounted.mockReturnValue(false);
  linkInterceptionState.setInterceptionEnabled(true);
});

afterEach(() => {
  linkInterceptionState.setInterceptionEnabled(false);
  listeners.forEach((listener) => document.removeEventListener(AUTO_OPEN_DOCS_EVENT, listener));
  listeners = [];
  linkInterceptionState.processQueuedLinks();
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
});

describe('linkInterceptionState click handling', () => {
  it('hands the link to the surface that accepts it and keeps the browser from navigating', () => {
    const surface = listenAsSurface(true);
    listeners.push(surface);

    const event = clickDocsLink();

    expect(event.defaultPrevented).toBe(true);
    expect(surface).toHaveBeenCalledTimes(1);
    expect((surface.mock.calls[0]![0] as CustomEvent).detail).toMatchObject({
      url: DOCS_URL,
      source: 'link_interception',
    });
    expect(sidebarState.openSidebar).not.toHaveBeenCalled();
    expect(linkInterceptionState.hasQueuedLinks()).toBe(false);
  });

  // The floating panel's close leaves the mounted flag set with nothing listening.
  it('opens the sidebar and queues the link when no surface accepts it', () => {
    const unmatchedSurface = listenAsSurface(false);
    listeners.push(unmatchedSurface);

    const event = clickDocsLink();

    expect(event.defaultPrevented).toBe(true);
    expect(sidebarState.setPendingOpenSource).toHaveBeenCalledWith('link_interception');
    expect(sidebarState.openSidebar).toHaveBeenCalledWith(
      'Interactive learning',
      expect.objectContaining({ url: DOCS_URL })
    );
    expect(linkInterceptionState.shiftFromQueue()).toMatchObject({ url: DOCS_URL });
  });

  it('reports an open surface taking the link, keeping sidebar_was_open as the mounted flag', () => {
    mockedIsSidebarMounted.mockReturnValue(true);
    listeners.push(listenAsSurface(true));

    clickDocsLink();

    expect(reportAppInteraction).toHaveBeenCalledWith(
      'global_docs_link_intercepted',
      expect.objectContaining({ intercepted_url: DOCS_URL, sidebar_was_open: true, delivery: 'open_surface' })
    );
  });

  it('reports a cold sidebar open, even when the mounted flag is stale', () => {
    mockedIsSidebarMounted.mockReturnValue(true);

    clickDocsLink();

    expect(reportAppInteraction).toHaveBeenCalledWith(
      'global_docs_link_intercepted',
      expect.objectContaining({ sidebar_was_open: true, delivery: 'cold_sidebar' })
    );
  });

  it.each<PanelMode>(['floating', 'fullscreen'])(
    'lets the browser follow the link in %s mode when no surface accepts it',
    (mode) => {
      mockedGetMode.mockReturnValue(mode);

      const event = clickDocsLink();

      expect(event.defaultPrevented).toBe(false);
      expect(sidebarState.openSidebar).not.toHaveBeenCalled();
      expect(linkInterceptionState.hasQueuedLinks()).toBe(false);
      expect(reportAppInteraction).not.toHaveBeenCalled();
    }
  );

  it('lets the browser follow the link in Grafana kiosk mode', () => {
    window.history.replaceState(null, '', '/d/abc?kiosk');
    const surface = listenAsSurface(true);
    listeners.push(surface);

    const event = clickDocsLink();

    expect(event.defaultPrevented).toBe(false);
    expect(surface).not.toHaveBeenCalled();
  });

  it('stops intercepting once disabled', () => {
    linkInterceptionState.setInterceptionEnabled(false);

    const event = clickDocsLink();

    expect(event.defaultPrevented).toBe(false);
    expect(sidebarState.openSidebar).not.toHaveBeenCalled();
  });
});
