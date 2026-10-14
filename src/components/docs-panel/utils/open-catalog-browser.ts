import { config, getAppEvents, locationService } from '@grafana/runtime';
import { requestCatalogActivation } from '../../../global-state/package-browser';
import { panelModeManager } from '../../../global-state/panel-mode';
import { sidebarState } from '../../../global-state/sidebar';
import { OPEN_CATALOG_BROWSER_EVENT } from '../../../lib/event-names';
import { isExtensionSidebarOwnedByOther } from '../../../lib/storage/extension-sidebar';
import { getPathfinderSurface } from '../../../lib/telemetry/surface';
import { PLUGIN_BASE_URL } from '../../../constants';
import { reportAppInteraction, UserInteraction } from '../../../lib/analytics';
import pluginJson from '../../../plugin.json';

export function openCatalogBrowser(options?: { source?: string }): void {
  const scope = `${config.namespace || ''}:${config.bootData?.user?.orgId ?? ''}:${config.bootData?.user?.id ?? ''}`;
  requestCatalogActivation(scope);
  const sidebarMounted =
    panelModeManager.getMode() === 'sidebar' &&
    getPathfinderSurface() === 'sidebar' &&
    sidebarState.getIsSidebarMounted() &&
    !isExtensionSidebarOwnedByOther(pluginJson.id);
  panelModeManager.setModeTransient('sidebar');
  if (sidebarMounted) {
    document.dispatchEvent(new CustomEvent(OPEN_CATALOG_BROWSER_EVENT));
    return;
  }
  sidebarState.setIsSidebarMounted(false);
  sidebarState.setPendingOpenSource(options?.source ?? 'package_browser');
  sidebarState.openSidebar('Interactive learning');
}

export function openLearningHome(options?: { source?: string }): void {
  reportAppInteraction(UserInteraction.DocsPanelInteraction, {
    action: 'navigate_to_my_learning',
    source: options?.source ?? 'content_completion_panel',
  });
  panelModeManager.setModeTransient('sidebar');
  getAppEvents().publish({ type: 'close-extension-sidebar', payload: {} });
  if (getPathfinderSurface() === 'controller') {
    window.location.assign(new URL(PLUGIN_BASE_URL, window.location.origin).href);
  } else {
    locationService.push(PLUGIN_BASE_URL);
  }
}
