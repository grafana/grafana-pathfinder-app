import { config, locationService } from '@grafana/runtime';
import { kioskState } from '../global-state/kiosk';
import { parsePathfinderDeepLink } from './pathfinder-search-params';

let detach: (() => void) | undefined;

export function clearKioskLaunchParams(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('pathfinderKiosk');
  url.searchParams.delete('kioskRulesUrl');
  locationService.replace({
    ...locationService.getLocation(),
    search: url.search,
    hash: url.hash,
  });
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
    handleKioskLinkClick(event);
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

export function handleKioskLinkClick(event: MouseEvent, fromGuide = false): boolean {
  const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!(anchor instanceof HTMLAnchorElement)) {
    return false;
  }
  const url = prepareKioskLink(anchor, fromGuide);
  if (!url) {
    return false;
  }
  const appSubUrl = config.appSubUrl ?? '';
  const target = anchor.getAttribute('target') ?? document.querySelector('base')?.getAttribute('target');
  if (
    !detach ||
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    anchor.hasAttribute('download') ||
    (target && target.toLowerCase() !== '_self') ||
    url.origin !== window.location.origin ||
    (appSubUrl && url.pathname !== appSubUrl && !url.pathname.startsWith(`${appSubUrl}/`))
  ) {
    return true;
  }
  event.preventDefault();
  locationService.push(`${url.pathname.slice(appSubUrl.length) || '/'}${url.search}${url.hash}`);
  return true;
}

export function prepareKioskLink(anchor: HTMLAnchorElement, fromGuide = false): URL | null {
  let url: URL;
  try {
    url = new URL(anchor.getAttribute('href') ?? '', window.location.href);
  } catch {
    return null;
  }
  const params = parsePathfinderDeepLink(url.search);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    !params.pathfinderKiosk ||
    params.doc ||
    params.controller
  ) {
    return null;
  }
  const appSubUrl = config.appSubUrl ?? '';
  const raw = anchor.getAttribute('href') ?? '';
  if (
    fromGuide &&
    raw.startsWith('/') &&
    !raw.startsWith('//') &&
    appSubUrl &&
    url.pathname !== appSubUrl &&
    !url.pathname.startsWith(`${appSubUrl}/`)
  ) {
    url.pathname = `${appSubUrl}${url.pathname}`;
    anchor.href = url.href;
  }
  return url;
}
