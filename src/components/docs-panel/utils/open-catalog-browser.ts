import { config } from '@grafana/runtime';
import { requestCatalogActivation } from '../../../global-state/package-browser';
import { panelModeManager } from '../../../global-state/panel-mode';
import { sidebarState } from '../../../global-state/sidebar';
import { OPEN_CATALOG_BROWSER_EVENT } from '../../../lib/event-names';
import { isExtensionSidebarOwnedByOther } from '../../../lib/storage/extension-sidebar';
import { getPathfinderSurface } from '../../../lib/telemetry/surface';
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
