import { config, locationService } from '@grafana/runtime';
import { kioskState } from '../global-state/kiosk';
import { installKioskNavigation, clearKioskLaunchParams } from './kiosk-navigation';

jest.mock('@grafana/runtime', () => ({
  config: { appSubUrl: '' },
  locationService: { getHistory: jest.fn(), push: jest.fn() },
}));

let navigate: () => void;
const unlisten = jest.fn();
beforeEach(() => {
  window.history.replaceState({}, '', '/');
  kioskState.set(null);
  jest.clearAllMocks();
  config.appSubUrl = '';
  document.body.replaceChildren();
  (locationService.getHistory as jest.Mock).mockReturnValue({
    listen: (handler: () => void) => {
      navigate = handler;
      return unlisten;
    },
  });
});

it('opens initial URLs and updates the selection on SPA navigation', () => {
  window.history.replaceState({}, '', '/?pathfinderKiosk=1&kioskRulesUrl=first');
  const mount = jest.fn();
  expect(installKioskNavigation(mount)).toBe(true);
  const first = kioskState.getSnapshot();
  expect(first).toEqual({ source: 'url', rulesUrl: 'first' });
  navigate();
  expect(kioskState.getSnapshot()).toBe(first);
  window.history.replaceState({}, '', '/?pathfinderKiosk=1&kioskRulesUrl=second');
  navigate();
  expect(kioskState.getSnapshot()?.rulesUrl).toBe('second');
  window.history.replaceState({}, '', '/');
  navigate();
  expect(kioskState.getSnapshot()).toBeNull();
});

it.each([
  '?kiosk=1',
  '?kioskRulesUrl=first',
  '?pathfinderKiosk=1&doc=bundled:welcome',
  '?pathfinderKiosk=1&controller=1',
])('does not open for %s', (search) => {
  window.history.replaceState({}, '', `/${search}`);
  const mount = jest.fn();
  expect(installKioskNavigation(mount)).toBe(false);
  expect(mount).not.toHaveBeenCalled();
});

it('clears launch parameters without replaying a closed kiosk on navigation', () => {
  window.history.replaceState({ keep: true }, '', '/?pathfinderKiosk=1&kioskRulesUrl=first&kiosk=tv#anchor');
  installKioskNavigation(jest.fn());
  clearKioskLaunchParams();
  kioskState.set(null);
  navigate();
  expect(kioskState.getSnapshot()).toBeNull();
  expect(window.location.search).toBe('?kiosk=tv');
  expect(window.location.hash).toBe('#anchor');
  expect(window.history.state).toEqual({ keep: true });
});

it('replaces the previous listener on reinstallation', () => {
  installKioskNavigation(jest.fn());
  unlisten.mockClear();
  installKioskNavigation(jest.fn());
  expect(unlisten).toHaveBeenCalledTimes(1);
});

function clickLink(href: string, attributes: Record<string, string> = {}, options: MouseEventInit = {}): MouseEvent {
  const anchor = document.createElement('a');
  anchor.href = href;
  for (const [key, value] of Object.entries(attributes)) {
    anchor.setAttribute(key, value);
  }
  const child = document.createElement('span');
  anchor.appendChild(child);
  document.body.appendChild(anchor);
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...options });
  child.dispatchEvent(event);
  return event;
}

it('opens same-origin kiosk links through SPA navigation instead of reloading', () => {
  installKioskNavigation(jest.fn());
  const event = clickLink('/d/demo?orgId=2&pathfinderKiosk=1&kioskRulesUrl=custom#section');
  expect(event.defaultPrevented).toBe(true);
  expect(locationService.push).toHaveBeenCalledWith('/d/demo?orgId=2&pathfinderKiosk=1&kioskRulesUrl=custom#section');
});

it.each([
  ['https://other.example.com/?pathfinderKiosk=1', {}, {}],
  ['http://[invalid', {}, {}],
  ['javascript:void(0)', {}, {}],
  ['/?pathfinderKiosk=1', { target: '_blank' }, {}],
  ['/?pathfinderKiosk=1', { download: '' }, {}],
  ['/?pathfinderKiosk=1', {}, { ctrlKey: true }],
  ['/?pathfinderKiosk=1', {}, { metaKey: true }],
  ['/?pathfinderKiosk=1', {}, { shiftKey: true }],
  ['/?pathfinderKiosk=1', {}, { altKey: true }],
  ['/?pathfinderKiosk=1', {}, { button: 1 }],
  ['/?pathfinderKiosk=1&doc=bundled:welcome', {}, {}],
  ['/?pathfinderKiosk=1&controller=1', {}, {}],
  ['/?kioskRulesUrl=custom', {}, {}],
  ['/?kiosk=1', {}, {}],
] as Array<[string, Record<string, string>, MouseEventInit]>)(
  'leaves other link behavior intact: %s %j %j',
  (href, attributes, options) => {
    installKioskNavigation(jest.fn());
    const event = clickLink(href, attributes, options);
    expect(event.defaultPrevented).toBe(false);
    expect(locationService.push).not.toHaveBeenCalled();
  }
);

it('strips the Grafana subpath for router navigation and ignores links outside it', () => {
  config.appSubUrl = '/grafana';
  installKioskNavigation(jest.fn());
  expect(clickLink('/other?pathfinderKiosk=1').defaultPrevented).toBe(false);
  expect(clickLink('/grafana/d/demo?pathfinderKiosk=1').defaultPrevented).toBe(true);
  expect(locationService.push).toHaveBeenCalledWith('/d/demo?pathfinderKiosk=1');
});

it('removes the previous click handler on reinstallation', () => {
  installKioskNavigation(jest.fn());
  installKioskNavigation(jest.fn());
  clickLink('/?pathfinderKiosk=1', { target: '_self' });
  expect(locationService.push).toHaveBeenCalledTimes(1);
});
