import { config, locationService } from '@grafana/runtime';
import { kioskState } from '../global-state/kiosk';
import { parsePathfinderDeepLink } from './pathfinder-search-params';

let detach: (() => void) | undefined;

const HISTORY_KEY = 'grafana-pathfinder-app:kiosk';
let replacing = false;

function entryState(): Record<string, unknown> {
  const state = locationService.getLocation().state;
  return state && typeof state === 'object' ? { ...state } : {};
}

function replaceEntry(state: Record<string, unknown>): void {
  const location = locationService.getLocation();
  const search = new URLSearchParams(location.search);
  search.delete('pathfinderKiosk');
  search.delete('kioskRulesUrl');
  replacing = true;
  try {
    locationService.replace({ ...location, search: search.size ? `?${search}` : '', state });
  } finally {
    replacing = false;
  }
}

export function clearKioskLaunchParams(): void {
  const state = entryState();
  delete state[HISTORY_KEY];
  replaceEntry(state);
}

export function installKioskNavigation(mount: () => void): boolean {
  detach?.();
  const handleNavigation = (_location?: unknown, action?: string) => {
    if (replacing) {
      return kioskState.getSnapshot() !== null;
    }
    const params = parsePathfinderDeepLink(locationService.getLocation().search);
    const state = entryState();
    if (params.pathfinderKiosk && !params.doc && !params.controller) {
      const launch = { source: 'url' as const, rulesUrl: params.kioskRulesUrl };
      state[HISTORY_KEY] = launch;
      replaceEntry(state);
      kioskState.set(launch);
      mount();
      return true;
    }
    const saved = state[HISTORY_KEY];
    if (
      !params.doc &&
      !params.controller &&
      action !== 'PUSH' &&
      action !== 'REPLACE' &&
      saved &&
      typeof saved === 'object' &&
      'source' in saved &&
      saved.source === 'url' &&
      (!('rulesUrl' in saved) || saved.rulesUrl === undefined || typeof saved.rulesUrl === 'string')
    ) {
      kioskState.set({
        source: 'url',
        rulesUrl: 'rulesUrl' in saved ? (saved.rulesUrl as string | undefined) : undefined,
      });
      mount();
      return true;
    }
    if (saved) {
      delete state[HISTORY_KEY];
      replaceEntry(state);
    }
    if (kioskState.getSnapshot()?.source === 'url') {
      kioskState.set(null);
    }
    return false;
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
