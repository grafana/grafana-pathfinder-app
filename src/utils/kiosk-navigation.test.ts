import { locationService } from '@grafana/runtime';
import { kioskState } from '../global-state/kiosk';
import { installKioskNavigation, clearKioskLaunchParams } from './kiosk-navigation';

jest.mock('@grafana/runtime', () => ({ locationService: { getHistory: jest.fn() } }));

let navigate: () => void;
const unlisten = jest.fn();
beforeEach(() => {
  window.history.replaceState({}, '', '/');
  kioskState.set(null);
  jest.clearAllMocks();
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
