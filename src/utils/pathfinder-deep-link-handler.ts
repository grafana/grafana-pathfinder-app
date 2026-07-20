/**
 * Centralized `?doc=` / `?panelMode=` / `?kiosk_session=` deep-link handler.
 *
 * `plugin.init` fires only once — from `appPluginPostImport` in Grafana's
 * plugin importer.
 *
 * `handlePathfinderDeepLink` is idempotent and deduplicated so it can be
 * called on every navigation; `installDeepLinkNavListener` wires it up to
 * `locationService.getHistory().listen()` for SPA navigations
 */

import { locationService } from '@grafana/runtime';

import { PLUGIN_BASE_URL, ROUTES } from '../constants';
import { logger } from '../lib/logging';
import { panelModeManager } from '../global-state/panel-mode';
import { sidebarState } from '../global-state/sidebar';
import { autoLaunchChannel } from '../global-state/auto-launch';
import { validateRedirectPath } from '../security/url-validator';
import {
  parsePathfinderDeepLink,
  PATHFINDER_ACTIVATION_PARAMS,
  stripPathfinderParams,
} from './pathfinder-search-params';

export interface DeepLinkHandlerDeps {
  /** Whether the sidebar surface is mounted for this user/variant. */
  shouldMountSidebar: boolean;
  /** Schedule an `open-extension-sidebar` event after the given delay. */
  attemptAutoOpen: (delay?: number) => void;
  loadControlGroupDocPopup: () => Promise<{ showControlGroupDocPopup: (source: string) => void }>;
}

// Dedup gate — prevents re-processing the same URL from multiple listener transports.
let lastProcessedSearch: string | null = null;

/** Test-only escape hatch — resets dedup state between assertions. */
export function __resetDeepLinkHandlerStateForTests(): void {
  lastProcessedSearch = null;
}

/** Mutate the current URL in place and invalidate the dedup gate — the
 *  stored search is pre-strip and would block re-arrivals at the same link. */
function rewriteCurrentUrl(mutate: (url: URL) => void): void {
  const url = new URL(window.location.href);
  mutate(url);
  window.history.replaceState({}, '', url.toString());
  lastProcessedSearch = null;
}

function isFullScreenRoute(pathname: string): boolean {
  return pathname === `${PLUGIN_BASE_URL}/${ROUTES.FullScreen}`;
}

/** Process Pathfinder deep-link params from the current URL. Idempotent. */
export function handlePathfinderDeepLink(deps: DeepLinkHandlerDeps): boolean {
  const search = window.location.search;
  if (!hasAnyPathfinderParam(search)) {
    return false;
  }

  const deepLink = parsePathfinderDeepLink(search);
  const { doc: docsParam, page: pageParam, source: sourceParam, type: typeParam } = deepLink;
  const kioskSessionParam = deepLink.kioskSession;
  const panelModeParam = deepLink.panelMode;

  // FullScreenPanel owns `?doc=` on this route; kiosk_session/panelMode still
  // process below. With neither present there is nothing to do — bail before
  // the dedup gate so this search isn't latched against a later normal route.
  const onFullScreenRoute = isFullScreenRoute(locationService.getLocation().pathname);
  if (onFullScreenRoute && panelModeParam === undefined && kioskSessionParam === undefined) {
    return false;
  }

  if (search === lastProcessedSearch) {
    return false;
  }
  lastProcessedSearch = search;

  if (kioskSessionParam) {
    (window as any).__pathfinderKioskSessionId = kioskSessionParam;
  }

  if (panelModeParam === 'floating') {
    panelModeManager.setMode('floating');
    rewriteCurrentUrl((url) => url.searchParams.delete('panelMode'));
  } else if (panelModeParam === 'fullscreen') {
    panelModeManager.setMode('fullscreen');
    rewriteCurrentUrl((url) => url.searchParams.delete('panelMode'));
    let target = `${PLUGIN_BASE_URL}/${ROUTES.FullScreen}`;
    if (docsParam) {
      const fullScreenParams = new URLSearchParams();
      fullScreenParams.set('doc', docsParam);
      if (typeParam) {
        fullScreenParams.set('type', typeParam);
      }
      target += `?${fullScreenParams.toString()}`;
    }
    locationService.replace(target);
  }

  const docOpenSource = sourceParam || 'url_param';

  if (!docsParam || onFullScreenRoute) {
    // panelMode-only / kiosk-only links, or a full-screen-route doc owned by
    // FullScreenPanel: nothing more to dispatch here.
    return panelModeParam !== undefined || kioskSessionParam !== undefined;
  }

  // Control group: sidebar is dismounted; show the fallback popup instead.
  if (!deps.shouldMountSidebar) {
    rewriteCurrentUrl(stripPathfinderParams);
    deps
      .loadControlGroupDocPopup()
      .then(({ showControlGroupDocPopup }) => showControlGroupDocPopup(docOpenSource))
      .catch((err) => logger.error('[Pathfinder] Failed to load control group popup', { error: err }));
    return true;
  }

  // Capture before the async import so listener re-fires don't mutate these.
  const ctx = {
    docsParam,
    pageParam,
    typeParam,
    docOpenSource,
  };

  import('./find-doc-page')
    .then(({ findDocPage }) => {
      const docsPage = findDocPage(ctx.docsParam);

      // SECURITY: page only processed when doc is also present (not a general redirector).
      const rawRedirectTarget = ctx.pageParam || docsPage?.targetPage;
      const redirectTarget = rawRedirectTarget ? validateRedirectPath(rawRedirectTarget) : null;

      if (!docsPage) {
        logger.warn('Could not parse doc param', {
          docsParam: ctx.docsParam,
          supportedFormats:
            '- Supported formats: api:<resourceName>, bundled:<id>, interactive-learning.grafana.net/..., /docs/..., https://grafana.com/docs/...',
        });
        rewriteCurrentUrl(stripPathfinderParams);
        sidebarState.setPendingOpenSource(ctx.docOpenSource, 'auto-open');
        deps.attemptAutoOpen(200);
        return;
      }

      const needsRedirect = redirectTarget && redirectTarget !== window.location.pathname;
      const currentMode = panelModeManager.getMode();
      const isFloatingMode = currentMode === 'floating';
      const isFullScreenMode = currentMode === 'fullscreen';

      sidebarState.setPendingOpenSource(ctx.docOpenSource, 'auto-open');

      if (needsRedirect) {
        locationService.replace(redirectTarget);
        lastProcessedSearch = null;
      } else {
        rewriteCurrentUrl(stripPathfinderParams);
      }

      // Floating/fullscreen panels mount on their own; don't open a second sidebar.
      if (!isFloatingMode && !isFullScreenMode) {
        deps.attemptAutoOpen(needsRedirect ? 500 : 200);
      }

      installAutoLaunchOnMount({
        url: docsPage.url,
        title: docsPage.title,
        // ?type= wins over URL-based classification (package URLs misclassify as 'interactive').
        type: ctx.typeParam === 'learning-journey' ? 'learning-journey' : docsPage.type,
        source: ctx.docOpenSource,
      });
    })
    .catch((err) => {
      logger.error('[Pathfinder] Failed to load find-doc-page chunk', { error: err });
      sidebarState.setPendingOpenSource(ctx.docOpenSource, 'auto-open');
      deps.attemptAutoOpen(200);
      setTimeout(() => {
        locationService.replace('/');
      }, 300);
    });

  return true;
}

/** Register a location listener that re-runs the handler on every SPA navigation. */
export function installDeepLinkNavListener(deps: DeepLinkHandlerDeps): void {
  const handler = () => {
    if (!hasAnyPathfinderParam(window.location.search)) {
      return;
    }
    handlePathfinderDeepLink(deps);
  };

  try {
    const history = locationService.getHistory();
    if (history) {
      const unlisten = history.listen(handler);
      (window as any).__pathfinderDeepLinkNavUnlisten = unlisten;
    }
  } catch {
    window.addEventListener('popstate', handler);
  }
}

function hasAnyPathfinderParam(search: string): boolean {
  if (!search) {
    return false;
  }

  const params = new URLSearchParams(search);
  return PATHFINDER_ACTIVATION_PARAMS.some((p) => params.has(p));
}

/** Emit the auto-launch onto `autoLaunchChannel` once whichever panel surface mounts first. */
function installAutoLaunchOnMount(detail: { url: string; title: string; type: string; source: string }): void {
  let autoLaunched = false;
  const dispatch = () => {
    if (autoLaunched) {
      return;
    }
    autoLaunched = true;
    window.removeEventListener('pathfinder-sidebar-mounted', dispatch);
    document.removeEventListener('pathfinder-panel-mounted', dispatch);

    document.dispatchEvent(new CustomEvent('pathfinder-auto-launch-pending'));

    setTimeout(() => {
      // If the surface unmounted during the delay, skip the emit — the channel
      // latches, so a stale value would replay on a later manual open.
      if (!sidebarState.getIsSidebarMounted()) {
        return;
      }
      autoLaunchChannel.emit(detail);
    }, 500);
  };

  window.addEventListener('pathfinder-sidebar-mounted', dispatch, { once: true });
  document.addEventListener('pathfinder-panel-mounted', dispatch, { once: true });

  if (sidebarState.getIsSidebarMounted()) {
    dispatch();
  }
}
