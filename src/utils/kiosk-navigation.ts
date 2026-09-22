import { locationService } from '@grafana/runtime';
import { kioskState } from '../global-state/kiosk';
import { parsePathfinderDeepLink } from './pathfinder-search-params';

let detach: (() => void) | undefined;

export function clearKioskLaunchParams(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('pathfinderKiosk');
  url.searchParams.delete('kioskRulesUrl');
  window.history.replaceState(window.history.state, '', url.toString());
}

export function installKioskNavigation(mount: () => void): boolean {
  detach?.();
  const handleNavigation = () => {
    const params = parsePathfinderDeepLink(window.location.search);
    if (!params.pathfinderKiosk || params.doc || params.controller) {
      if (kioskState.getSnapshot()?.source === 'url') {
        kioskState.set(null);
      }
      return false;
    }
    kioskState.set({ source: 'url', rulesUrl: params.kioskRulesUrl });
    mount();
    return true;
  };
  try {
    detach = locationService.getHistory().listen(handleNavigation);
  } catch {
    window.addEventListener('popstate', handleNavigation);
    detach = () => window.removeEventListener('popstate', handleNavigation);
  }
  return handleNavigation();
}
