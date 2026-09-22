import { config, locationService } from '@grafana/runtime';
import { parseKioskWebUrl } from '../security/kiosk-url';
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
  const handleClick = (event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute('download')) {
      return;
    }
    const target = anchor.getAttribute('target') ?? document.querySelector('base')?.getAttribute('target');
    if (target && target.toLowerCase() !== '_self') {
      return;
    }
    const url = parseKioskWebUrl(anchor.href, window.location.origin);
    if (!url) {
      return;
    }
    const params = parsePathfinderDeepLink(url.search);
    if (url.origin !== window.location.origin || !params.pathfinderKiosk || params.doc || params.controller) {
      return;
    }
    const appSubUrl = config.appSubUrl ?? '';
    if (appSubUrl && url.pathname !== appSubUrl && !url.pathname.startsWith(`${appSubUrl}/`)) {
      return;
    }
    event.preventDefault();
    locationService.push(`${url.pathname.slice(appSubUrl.length) || '/'}${url.search}${url.hash}`);
  };
  let unlisten: () => void;
  try {
    unlisten = locationService.getHistory().listen(handleNavigation);
  } catch {
    window.addEventListener('popstate', handleNavigation);
    unlisten = () => window.removeEventListener('popstate', handleNavigation);
  }
  document.addEventListener('click', handleClick);
  detach = () => {
    unlisten();
    document.removeEventListener('click', handleClick);
  };
  return handleNavigation();
}
