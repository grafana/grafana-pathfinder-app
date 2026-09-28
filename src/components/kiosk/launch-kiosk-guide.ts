import type { PreparedGuideLaunch } from '../docs-panel/utils/prepare-guide-launch';
import { guideLaunchStore } from '../../global-state/guide-launch';
import { sidebarState } from '../../global-state/sidebar';
import { linkInterceptionState } from '../../global-state/link-interception';
import { isExtensionSidebarOwnedByOther } from '../../lib/storage/extension-sidebar';
import pluginJson from '../../plugin.json';
import { AUTO_OPEN_DOCS_EVENT, REQUEST_FLOATING_GUIDE_EVENT } from '../../lib/event-names';
import { panelModeManager } from '../../global-state/panel-mode';
import { locationService } from '@grafana/runtime';
import { stripPathfinderParams } from '../../utils/pathfinder-search-params';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import type { KioskRule } from './kiosk-rules';
import { parseKioskWebUrl } from '../../security/kiosk-url';
import { isAllowedContentUrl, validateInternalNavigationPath } from '../../security/url-validator';

import type { KioskMode } from '../../types/kiosk-page.schema';

export function launchKioskGuide(
  rule: KioskRule,
  mode: KioskMode,
  onLaunch?: () => void,
  prepared?: PreparedGuideLaunch
): void {
  const page = rule.page === undefined ? undefined : validateInternalNavigationPath(rule.page);
  if (page === null || !isAllowedContentUrl(rule.url)) {
    return;
  }
  const current = locationService.getLocation();
  const url =
    mode === 'instance'
      ? new URL(page ?? `${current.pathname}${current.search}${current.hash}`, window.location.origin)
      : parseKioskWebUrl(rule.targetUrl || window.location.origin, window.location.origin);
  if (!url) {
    return;
  }
  if (mode === 'presentation') {
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
    url.search = '';
    url.hash = '';
    if (page) {
      url.searchParams.set('page', page);
    }
  } else {
    const orgId = new URLSearchParams(current.search).get('orgId');
    if (orgId && !url.searchParams.has('orgId')) {
      url.searchParams.set('orgId', orgId);
    }
    stripPathfinderParams(url);
  }
  const sessionId = crypto.randomUUID();

  reportAppInteraction(UserInteraction.KioskDemoStarted, {
    kiosk_session_id: sessionId,
    guide_url: rule.url,
    guide_title: rule.title,
    guide_type: rule.type,
    launch_mode: mode,
    target_instance: mode === 'instance' ? window.location.origin : rule.targetUrl || window.location.origin,
  });

  if (!prepared) {
    url.searchParams.set('doc', rule.url);
  }
  url.searchParams.set('kiosk_session', sessionId);
  if (rule.type === 'learning-journey') {
    url.searchParams.set('type', 'learning-journey');
  }
  if (mode === 'instance') {
    if (prepared && (panelModeManager.getMode() === 'floating' || isExtensionSidebarOwnedByOther(pluginJson.id))) {
      window.__pathfinderKioskSessionId = sessionId;
      panelModeManager.setPendingGuide({
        url: prepared.url,
        title: prepared.title,
        type: prepared.type,
        packageInfo: prepared.packageInfo,
        preparedContent: prepared.preparedContent,
        source: prepared.source,
      });
      onLaunch?.();
      panelModeManager.setModeTransient('floating');
      locationService.push(`${url.pathname}${url.search}${url.hash}`);
      document.dispatchEvent(new CustomEvent(REQUEST_FLOATING_GUIDE_EVENT));
      return;
    }
    onLaunch?.();
    panelModeManager.setModeTransient('sidebar');
    locationService.push(`${url.pathname}${url.search}${url.hash}`);
    if (prepared) {
      window.__pathfinderKioskSessionId = sessionId;
      const launchKey = guideLaunchStore.stage({
        url: prepared.url,
        preparedContent: prepared.preparedContent,
        packageInfo: prepared.packageInfo,
      });
      if (sidebarState.getIsSidebarMounted()) {
        document.dispatchEvent(
          new CustomEvent(AUTO_OPEN_DOCS_EVENT, {
            detail: { url: prepared.url, title: prepared.title, source: 'url_param', launchKey },
          })
        );
      } else {
        sidebarState.setPendingOpenSource('url_param');
        sidebarState.openSidebar('Interactive learning', {
          url: prepared.url,
          title: prepared.title,
          timestamp: Date.now(),
        });
        linkInterceptionState.addToQueue({
          url: prepared.url,
          title: prepared.title,
          timestamp: Date.now(),
          launchKey,
        });
      }
    }
  } else {
    window.open(url.toString(), '_blank', 'noopener,noreferrer');
  }
}
