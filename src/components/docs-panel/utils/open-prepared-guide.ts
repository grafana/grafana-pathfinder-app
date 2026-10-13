import { locationService } from '@grafana/runtime';
import { sidebarState } from '../../../global-state/sidebar';
import { guideLaunchStore } from '../../../global-state/guide-launch';
import { linkInterceptionState } from '../../../global-state/link-interception';
import { panelModeManager, type PendingGuide } from '../../../global-state/panel-mode';
import { isExtensionSidebarOwnedByOther } from '../../../lib/storage/extension-sidebar';
import {
  AUTO_OPEN_DOCS_EVENT,
  REQUEST_FLOATING_GUIDE_EVENT,
  REQUEST_FULLSCREEN_GUIDE_EVENT,
} from '../../../lib/event-names';
import { PLUGIN_BASE_URL, ROUTES } from '../../../constants';
import { reportAppInteraction, UserInteraction } from '../../../lib/analytics';
import { buildFullScreenRouteUrl } from '../../../utils/pathfinder-search-params';
import pluginJson from '../../../plugin.json';
import { getPathfinderSurface } from '../../../lib/telemetry/surface';
import { cancelCatalogActivation } from '../../../global-state/package-browser';
import type { PreparedGuideLaunch } from './prepare-guide-launch';

function reportSurfaceChoice(surface: 'sidebar' | 'floating' | 'fullscreen', launch: PreparedGuideLaunch): void {
  reportAppInteraction(UserInteraction.GuideLaunchSurfaceChosen, {
    surface,
    requires_grafana_ui: launch.requiresGrafanaUi,
    ...(launch.source === 'package_browser' ? { source: 'package_browser' } : { content_url: launch.url }),
  });
}

function pendingGuideFrom(launch: PreparedGuideLaunch): PendingGuide {
  return {
    url: launch.url,
    title: launch.title,
    type: launch.type,
    packageInfo: launch.packageInfo,
    preparedContent: launch.preparedContent,
    source: launch.source,
  };
}

function openBesideGrafana(launch: PreparedGuideLaunch): void {
  if (isExtensionSidebarOwnedByOther(pluginJson.id) || panelModeManager.getMode() === 'floating') {
    reportSurfaceChoice('floating', launch);
    panelModeManager.setPendingGuide(pendingGuideFrom(launch));
    panelModeManager.setModeTransient('floating');
    document.dispatchEvent(new CustomEvent(REQUEST_FLOATING_GUIDE_EVENT));
    return;
  }

  reportSurfaceChoice('sidebar', launch);
  panelModeManager.setModeTransient('sidebar');

  // Only the opaque key crosses the public event channel.
  const launchKey = guideLaunchStore.stage({
    url: launch.url,
    preparedContent: launch.preparedContent,
    packageInfo: launch.packageInfo,
  });
  if (sidebarState.getIsSidebarMounted()) {
    document.dispatchEvent(
      new CustomEvent(AUTO_OPEN_DOCS_EVENT, {
        detail: { url: launch.url, title: launch.title, source: launch.source, launchKey },
      })
    );
  } else {
    sidebarState.setPendingOpenSource('home_page');
    sidebarState.openSidebar('Interactive learning', {
      url: launch.url,
      title: launch.title,
      timestamp: Date.now(),
    });
    linkInterceptionState.addToQueue({
      url: launch.url,
      title: launch.title,
      timestamp: Date.now(),
      launchKey,
    });
  }
}

function openFullScreen(launch: PreparedGuideLaunch): void {
  reportSurfaceChoice('fullscreen', launch);
  panelModeManager.setPendingGuide(pendingGuideFrom(launch));
  panelModeManager.capturePriorPath(window.location.pathname + window.location.search);
  panelModeManager.setModeTransient('fullscreen');
  document.dispatchEvent(new CustomEvent(REQUEST_FULLSCREEN_GUIDE_EVENT));
  locationService.push(
    buildFullScreenRouteUrl({
      pluginBaseUrl: PLUGIN_BASE_URL,
      fullScreenRoute: ROUTES.FullScreen,
      doc: launch.url,
      guideType: launch.type,
    })
  );
}

export function openPreparedGuide(launch: PreparedGuideLaunch): void {
  cancelCatalogActivation();
  if (launch.requiresGrafanaUi) {
    openBesideGrafana(launch);
  } else {
    openFullScreen(launch);
  }
}

export function openGuideInSidebar(
  launch: Pick<PreparedGuideLaunch, 'url' | 'title' | 'source'> &
    Partial<Pick<PreparedGuideLaunch, 'preparedContent' | 'packageInfo' | 'requiresGrafanaUi'>>
): void {
  cancelCatalogActivation();
  const sidebarMounted =
    panelModeManager.getMode() === 'sidebar' &&
    getPathfinderSurface() === 'sidebar' &&
    sidebarState.getIsSidebarMounted() &&
    !isExtensionSidebarOwnedByOther(pluginJson.id);
  const launchKey = guideLaunchStore.stage({
    url: launch.url,
    preparedContent: launch.preparedContent,
    packageInfo: launch.packageInfo,
    source: launch.source,
  });
  reportAppInteraction(UserInteraction.GuideLaunchSurfaceChosen, { surface: 'sidebar', source: launch.source });
  if (sidebarMounted) {
    panelModeManager.setModeTransient('sidebar');
    document.dispatchEvent(
      new CustomEvent(AUTO_OPEN_DOCS_EVENT, {
        detail: { url: launch.url, title: launch.title, source: launch.source, launchKey },
      })
    );
    return;
  }
  sidebarState.setIsSidebarMounted(false);
  linkInterceptionState.addToQueue({ url: launch.url, title: launch.title, timestamp: Date.now(), launchKey });
  panelModeManager.setModeTransient('sidebar');
  sidebarState.setPendingOpenSource(launch.source);
  sidebarState.openSidebar('Interactive learning');
}
