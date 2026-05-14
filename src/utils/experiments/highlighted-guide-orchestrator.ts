/**
 * Highlighted-Guide Experiment Orchestrator
 *
 * Boot- and nav-time side effects for `pathfinder.highlighted-guide-experiment`:
 *   - Reads the flag value, validates the extra fields (`guideId`, `autoOpen`).
 *   - Handles `resetCache: true` → false transitions using a separate sentinel
 *     key so a true→false→true sequence re-arms.
 *   - On a matched page, auto-opens the Pathfinder extension sidebar once per
 *     (hostname, guideId) — persisted in localStorage, NOT sessionStorage.
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
import { tabStorage } from '../../lib/user-storage';
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
 *   6. Auto-open: write marker, publish `open-extension-sidebar`.
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
    // Pin the active tab to 'recommendations' so the sidebar lands on the
    // Featured slot rather than whatever was last open (editor, devtools, etc.).
    // attemptAutoOpen's 200ms delay covers the async write; if it fails we accept
    // the user seeing their previous tab — the marker is still set, so we don't loop.
    tabStorage.setActiveTab('recommendations').catch((error) => {
      console.warn('[Pathfinder] Failed to pin recommendations tab for highlighted-guide auto-open:', error);
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

function installHighlightedGuideNavListener(tryAutoOpen: (path: string) => void): void {
  const handler = () => {
    const newLocation = locationService.getLocation();
    const newPath = newLocation.pathname || window.location.pathname || '';
    tryAutoOpen(newPath);
  };

  document.addEventListener('grafana:location-changed', handler);

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
