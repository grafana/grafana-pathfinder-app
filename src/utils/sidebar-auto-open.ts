// Config-driven sidebar auto-open. Opens the Pathfinder extension sidebar on
// launch when the operator opted in via the "Open panel on launch" plugin
// config or the `pathfinder.auto-open-sidebar` flag. Extracted from the retired
// `pathfinder.experiment-variant` orchestrator (the A/B machinery is gone).

import { getAppEvents, locationService } from '@grafana/runtime';

import pluginJson from '../plugin.json';
import { sidebarState } from '../global-state/sidebar';
import { isExtensionSidebarInUse } from '../lib/storage/extension-sidebar';
import { getFeatureFlagValue } from './openfeature';

export interface ConfigAutoOpenContext {
  currentPath: string;
  featureFlagEnabled: boolean;
  pluginConfig: { openPanelOnLaunch?: boolean };
}

export function attemptAutoOpen(delay = 200): void {
  setTimeout(() => {
    try {
      getAppEvents().publish({
        type: 'open-extension-sidebar',
        payload: {
          pluginId: pluginJson.id,
          componentTitle: 'Interactive learning',
        },
      });
    } catch (error) {
      console.error('Failed to auto-open Interactive learning panel:', error);
    }
  }, delay);
}

export function getCurrentPath(): string {
  const location = locationService.getLocation();
  return location.pathname || window.location.pathname || '';
}

export function getAutoOpenFeatureFlag(): boolean {
  return getFeatureFlagValue('pathfinder.auto-open-sidebar', false);
}

function isOnboardingFlowPath(path: string): boolean {
  return path.includes('/a/grafana-setupguide-app/onboarding-flow');
}

function openSidebarIfFree(delay = 200): void {
  if (isExtensionSidebarInUse()) {
    console.log('[Pathfinder] Skipping auto-open: sidebar already in use by another plugin');
    return;
  }
  sidebarState.setPendingOpenSource('auto_open', 'auto-open');
  attemptAutoOpen(delay);
}

// Defer auto-open when launched on Grafana's onboarding flow so Pathfinder
// doesn't pop open on top of the wizard; fire once the user navigates away.
function setupOnboardingFlowListener(): void {
  let opened = false;
  let detach = () => {};
  const checkLocationChange = () => {
    if (opened || isOnboardingFlowPath(getCurrentPath())) {
      return;
    }
    opened = true;
    detach();
    openSidebarIfFree(500);
  };
  try {
    const history = locationService.getHistory();
    if (history) {
      const unlisten = history.listen(checkLocationChange);
      detach = unlisten;
      (window as any).__pathfinderAutoOpenUnlisten = unlisten;
      return;
    }
  } catch {
    // fall through to popstate below
  }
  window.addEventListener('popstate', checkLocationChange);
  detach = () => window.removeEventListener('popstate', checkLocationChange);
}

export function setupConfigAutoOpen(context: ConfigAutoOpenContext): void {
  const { currentPath, featureFlagEnabled, pluginConfig } = context;

  if (!featureFlagEnabled && !pluginConfig.openPanelOnLaunch) {
    return;
  }

  if (isOnboardingFlowPath(currentPath)) {
    setupOnboardingFlowListener();
    return;
  }

  openSidebarIfFree();
}
