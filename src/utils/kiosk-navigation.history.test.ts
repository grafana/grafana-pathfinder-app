import { locationService } from '@grafana/runtime';
import { kioskState } from '../global-state/kiosk';
import { clearKioskLaunchParams, installKioskNavigation } from './kiosk-navigation';

it('retains a kiosk entry when a destination is pushed and restores it with Back and Forward', () => {
  const history = locationService.getHistory();
  locationService.push('/?pathfinderKiosk=1&kioskRulesUrl=catalog&orgId=2#section');
  installKioskNavigation(jest.fn());
  expect(locationService.getLocation().search).toBe('?orgId=2');
  kioskState.set(null);
  locationService.push('/a/product');
  expect(locationService.getLocation().state).toBeUndefined();
  expect(kioskState.getSnapshot()).toBeNull();
  history.goBack();
  expect(kioskState.getSnapshot()).toEqual({ source: 'url', rulesUrl: 'catalog' });
  history.goForward();
  expect(kioskState.getSnapshot()).toBeNull();
  history.goBack();
  clearKioskLaunchParams();
  kioskState.set(null);
  expect(installKioskNavigation(jest.fn())).toBe(false);
});

it('does not copy the kiosk into a partial navigation entry', () => {
  locationService.push('/?pathfinderKiosk=1');
  installKioskNavigation(jest.fn());
  locationService.partial({ view: 'other' });
  expect(kioskState.getSnapshot()).toBeNull();
  expect(installKioskNavigation(jest.fn())).toBe(false);
  locationService.getHistory().goBack();
  expect(kioskState.getSnapshot()?.source).toBe('url');
});
