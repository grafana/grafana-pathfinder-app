/**
 * Highlighted-Guide Experiment Orchestrator
 *
 * Boot- and nav-time side effects for `pathfinder.highlighted-guide-experiment`:
 *   - Reads the flag value, validates the extra fields (`guideId`, `autoOpen`).
 *   - Handles `resetCache: true` → false transitions using a separate sentinel
 *     key so a true→false→true sequence re-arms.
 *   - On a matched page, auto-opens the Pathfinder extension sidebar once per
 *     (hostname, guideId) — persisted in localStorage, NOT sessionStorage —
 *     and dispatches `auto-launch-tutorial` so the configured guide opens as
 *     a sidebar tab on mount (the same seam used by the `?doc=` deep link).
 *     Crucially, no `locationService.replace` is called — the user stays on
 *     the page they were on. The Featured-slot injection remains as a
 *     re-entry point if the user later closes the auto-opened tab.
 *   - If the user lands off-target, installs a navigation listener so the
 *     sidebar opens when they later enter a matched page.
 *
 * The Featured-slot injection that pairs with auto-open lives in
 * `context-engine/context.service.ts`. Both seams page-match through the same
 * `matchesHighlightedGuidePage` helper to avoid drift.
 */

import { locationService } from '@grafana/runtime';

import pluginJson from '../../plugin.json';
import { StorageKeys } from '../../lib/storage-keys';
import { sidebarState } from '../../global-state/sidebar';
import { findDocPage } from '../find-doc-page';
import { getHighlightedGuideConfig, type HighlightedGuideConfig } from '../openfeature';
import { attemptAutoOpen } from './experiment-orchestrator';
import { isExtensionSidebarOwnedByOther } from './experiment-utils';
import {
  clearHighlightedGuideMarkers,
  hasHighlightedGuideAutoOpened,
  markHighlightedGuideAutoOpened,
  matchesHighlightedGuidePage,
} from './highlighted-guide-utils';

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Read the flag and process `resetCache` exactly once per false→true transition.
 *
 * Sentinel key: `HIGHLIGHTED_GUIDE_RESET_PROCESSED_PREFIX{hostname}`. Mirrors
 * the pattern in `experiment-orchestrator.ts:106` so a stuck `resetCache: true`
 * doesn't trigger a clear on every reload.
 */
export function initializeHighlightedGuideExperiment(hostname: string): HighlightedGuideConfig {
  const config = getHighlightedGuideConfig();
  handleHighlightedGuideResetCache(hostname, config);
  return config;
}

function handleHighlightedGuideResetCache(hostname: string, config: HighlightedGuideConfig): void {
  const resetProcessedKey = `${StorageKeys.HIGHLIGHTED_GUIDE_RESET_PROCESSED_PREFIX}${hostname}`;
  let resetProcessed: string | null = null;
  try {
    resetProcessed = localStorage.getItem(resetProcessedKey);
  } catch {
    // localStorage unavailable — treat as not processed
  }

  if (config.resetCache) {
    if (resetProcessed !== 'true') {
      clearHighlightedGuideMarkers(hostname);
      try {
        localStorage.setItem(resetProcessedKey, 'true');
      } catch {
        // localStorage unavailable
      }
      console.log('[Pathfinder] Highlighted-guide reset triggered: cleared once-per-browser markers');
    }
  } else if (resetProcessed === 'true') {
    try {
      localStorage.setItem(resetProcessedKey, 'false');
    } catch {
      // localStorage unavailable
    }
  }
}

// ============================================================================
// AUTO-OPEN SETUP
// ============================================================================

/**
 * Decide whether to auto-open the Pathfinder sidebar now, or arm a navigation
 * listener for a later page match.
 *
 * Guard order — return early on any failure:
 *   1. `variant === 'excluded'` — flag is in no-op mode.
 *   2. `!autoOpen` — operator wants only the Featured-slot injection.
 *   3. Page does NOT match — install a nav listener and return.
 *   4. Already auto-opened for this `guideId` — done.
 *   5. Extension sidebar owned by another plugin (e.g. Assistant) — don't steal.
 *   6. Auto-open: write marker, publish `open-extension-sidebar`, then dispatch
 *      `auto-launch-tutorial` on sidebar/panel mount so the configured guide
 *      opens as a tab without navigating the user away from their current page.
 *
 * The nav listener uses the same logic, so a user navigating into a matched
 * page later in the same SPA navigation will trigger auto-open on first
 * arrival.
 */
export function setupHighlightedGuideAutoOpen(
  config: HighlightedGuideConfig,
  currentPath: string,
  hostname: string
): void {
  // Variant 'excluded' is the no-op default for users not in the experiment.
  // Silent so the vast majority of page loads stay quiet.
  if (config.variant === 'excluded') {
    return;
  }
  if (!config.autoOpen) {
    console.log('[Pathfinder] Highlighted-guide auto-open skipped: autoOpen=false (injection-only mode)');
    return;
  }
  if (!config.guideId) {
    console.log('[Pathfinder] Highlighted-guide auto-open skipped: guideId is empty');
    return;
  }

  const tryAutoOpen = (path: string, source: 'boot' | 'navigation') => {
    if (!matchesHighlightedGuidePage(config.pages, path)) {
      if (source === 'boot') {
        console.log(
          `[Pathfinder] Highlighted-guide auto-open skipped at boot: path "${path}" does not match pages ${JSON.stringify(
            config.pages
          )} (nav listener armed)`
        );
      }
      return;
    }
    if (hasHighlightedGuideAutoOpened(hostname, config.guideId)) {
      console.log(
        `[Pathfinder] Highlighted-guide auto-open skipped: already opened for guideId="${config.guideId}" (clear localStorage key with prefix "grafana-pathfinder-highlighted-guide-" + reload to re-test)`
      );
      return;
    }
    if (isExtensionSidebarOwnedByOther(pluginJson.id)) {
      console.log('[Pathfinder] Highlighted-guide auto-open skipped: extension sidebar owned by another plugin');
      return;
    }
    markHighlightedGuideAutoOpened(hostname, config.guideId);
    sidebarState.setPendingOpenSource('highlighted_guide_experiment', 'auto-open');

    // Resolve the guide so we can dispatch `auto-launch-tutorial` on mount —
    // same seam used by `?doc=` in `module.tsx`. If the guideId can't be
    // resolved we still open the sidebar (Featured-slot injection in
    // `context.service.ts` is the fallback path for misconfigured flags).
    const docsPage = findDocPage(config.guideId);
    if (!docsPage) {
      console.warn(
        `[Pathfinder] Highlighted-guide auto-open: findDocPage returned null for guideId="${config.guideId}". Opening sidebar without auto-launch; Featured-slot injection remains as fallback.`
      );
      attemptAutoOpen();
      return;
    }

    installAutoLaunchOnMount({
      url: docsPage.url,
      title: docsPage.title,
      // Operator override wins (lets the flag force the click-through flow
      // when `findDocPage`'s URL-based inference misclassifies the guide,
      // e.g. a docs URL that's really a learning journey). Otherwise honor
      // the inferred type.
      type: config.docType ?? docsPage.type,
    });

    attemptAutoOpen();
    console.log(`[Pathfinder] Highlighted-guide auto-open fired (${source}) for guideId:`, config.guideId);
  };

  tryAutoOpen(currentPath, 'boot');

  // Always install the nav listener — even if we just opened, the listener is a
  // no-op on subsequent fires (marker is set). Cheap insurance against SPA
  // navigations into a matched page later in the session.
  installHighlightedGuideNavListener((path) => tryAutoOpen(path, 'navigation'));
}

/**
 * Wire the `auto-launch-tutorial` dispatch to whichever panel surface mounts
 * first. Mirrors the `dispatchAutoLaunch` pattern in `module.tsx` so the
 * highlighted-guide experiment and `?doc=` deep links share the same
 * mount-then-dispatch contract.
 *
 * The dispatch fires exactly once even when both `pathfinder-sidebar-mounted`
 * and `pathfinder-panel-mounted` arrive (the floating panel can race the
 * sidebar). If the sidebar is already mounted (SPA navigation case — the user
 * already had the sidebar open from a prior page), we dispatch synchronously
 * so the listener isn't left dangling waiting for a mount that already fired.
 */
function installAutoLaunchOnMount(detail: { url: string; title: string; type: string }): void {
  let autoLaunched = false;
  const dispatch = () => {
    if (autoLaunched) {
      return;
    }
    autoLaunched = true;
    window.removeEventListener('pathfinder-sidebar-mounted', dispatch);
    document.removeEventListener('pathfinder-panel-mounted', dispatch);

    // Signal synchronously so the floating panel's empty-state fallback
    // doesn't fire on top of an incoming guide (same coordination event as
    // the `?doc=` flow).
    document.dispatchEvent(new CustomEvent('pathfinder-auto-launch-pending'));

    setTimeout(() => {
      document.dispatchEvent(
        new CustomEvent('auto-launch-tutorial', {
          detail: {
            url: detail.url,
            title: detail.title,
            type: detail.type,
            source: 'highlighted_guide_experiment',
          },
        })
      );
    }, 500);
  };

  window.addEventListener('pathfinder-sidebar-mounted', dispatch, { once: true });
  document.addEventListener('pathfinder-panel-mounted', dispatch, { once: true });

  if (sidebarState.getIsSidebarMounted()) {
    dispatch();
  }
}

function installHighlightedGuideNavListener(tryAutoOpen: (path: string) => void): void {
  const handler = () => {
    const newLocation = locationService.getLocation();
    const newPath = newLocation.pathname || window.location.pathname || '';
    tryAutoOpen(newPath);
  };

  try {
    const history = locationService.getHistory();
    if (history) {
      const unlisten = history.listen(handler);
      (window as any).__pathfinderHighlightedGuideNavUnlisten = unlisten;
    }
  } catch {
    window.addEventListener('popstate', handler);
  }
}
