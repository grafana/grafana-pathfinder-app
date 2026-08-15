/**
 * Home panel
 *
 * SceneObjectBase wrapper + React composition root for the home page.
 * Renders MyLearningTab as the full-page learning hub at /a/grafana-pathfinder-app.
 *
 * When a guide is launched from My Learning it arrives here already fetched,
 * snippet-expanded, and classified (see `prepareGuideLaunch`). This handler
 * picks the display surface from that classification:
 *
 * - reading-only content (no Grafana-driving action) → full screen, so the
 *   whole viewport is used for reading;
 * - content that drives the Grafana UI → the sidebar, so its "show me / do it"
 *   actions have the Grafana main area to work on — or a floating overlay when
 *   another plugin owns the extension sidebar or the floating panel is already
 *   the current surface.
 *
 * The surface choice is transient: it never overwrites the user's persisted
 * panel-mode preference. The prepared content is carried through to the
 * destination so no second fetch happens.
 */

import React, { useCallback } from 'react';
import { SceneObjectBase, type SceneObjectState } from '@grafana/scenes';
import { locationService } from '@grafana/runtime';
import { useStyles2 } from '@grafana/ui';

import { sidebarState } from '../../global-state/sidebar';
import { guideLaunchStore } from '../../global-state/guide-launch';
import { linkInterceptionState } from '../../global-state/link-interception';
import { panelModeManager, type PendingGuide } from '../../global-state/panel-mode';
import { isExtensionSidebarOwnedByOther } from '../../lib/storage/extension-sidebar';
import {
  AUTO_OPEN_DOCS_EVENT,
  REQUEST_FLOATING_GUIDE_EVENT,
  REQUEST_FULLSCREEN_GUIDE_EVENT,
} from '../../lib/event-names';
import { PLUGIN_BASE_URL, ROUTES } from '../../constants';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { buildFullScreenRouteUrl } from '../../utils/pathfinder-search-params';
import pluginJson from '../../plugin.json';
import { MyLearningTab } from '../LearningPaths';
import type { PreparedGuideLaunch } from '../docs-panel/utils/prepare-guide-launch';
import { MyLearningErrorBoundary } from '../docs-panel/components';
import { getHomePageStyles } from './home.styles';
import { testIds } from '../../constants/testIds';

// ============================================================================
// SCENE OBJECT
// ============================================================================

interface HomePanelState extends SceneObjectState {}

export class HomePanel extends SceneObjectBase<HomePanelState> {
  public static Component = HomePanelRenderer;
}

// ============================================================================
// RENDERER
// ============================================================================

// Answers "is the classifier picking the right surface in the wild?" — the
// surface itself is also reported by mounts/mode changes, but only this event
// ties it to the content and the classification that chose it.
function reportSurfaceChoice(surface: 'sidebar' | 'floating' | 'fullscreen', launch: PreparedGuideLaunch): void {
  reportAppInteraction(UserInteraction.GuideLaunchSurfaceChosen, {
    surface,
    requires_grafana_ui: launch.requiresGrafanaUi,
    content_url: launch.url,
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

export function HomePanelRenderer() {
  const styles = useStyles2(getHomePageStyles);

  // Open beside Grafana: sidebar, or a floating overlay when another plugin
  // owns the extension sidebar. Carries the prepared content so the tab opens
  // without a second fetch.
  const openBesideGrafana = useCallback((launch: PreparedGuideLaunch) => {
    // A floating panel already IS beside Grafana — deliver the guide there.
    // Forcing 'sidebar' would unmount the floating panel without anything
    // opening the extension sidebar: `isSidebarMounted` stays true (the
    // floating cleanup leaves it for the expected sidebar mount), so the
    // auto-open event below would fire with no listener and the guide would
    // be lost. See #1450 for the listener-ownership gap.
    if (isExtensionSidebarOwnedByOther(pluginJson.id) || panelModeManager.getMode() === 'floating') {
      reportSurfaceChoice('floating', launch);
      panelModeManager.setPendingGuide(pendingGuideFrom(launch));
      panelModeManager.setModeTransient('floating');
      // A same-mode transient launch dispatches no mode-change event, so an
      // already-mounted floating panel never remounts to consume. Signal it
      // directly; unheard when the panel isn't up yet (mount consumes then).
      document.dispatchEvent(new CustomEvent(REQUEST_FLOATING_GUIDE_EVENT));
      return;
    }

    reportSurfaceChoice('sidebar', launch);
    panelModeManager.setModeTransient('sidebar');

    // The event and the cold-sidebar queue are public channels — stage the
    // prepared payload in module-owned memory and send only the opaque key.
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
  }, []);

  // Open full screen for reading-only content. Mirrors the sidebar→full-screen
  // handoff order (pending guide → prior path → mode → route), but selects the
  // mode transiently so the user's stored preference is untouched.
  const openFullScreen = useCallback((launch: PreparedGuideLaunch) => {
    reportSurfaceChoice('fullscreen', launch);
    panelModeManager.setPendingGuide(pendingGuideFrom(launch));
    panelModeManager.capturePriorPath(window.location.pathname + window.location.search);
    panelModeManager.setModeTransient('fullscreen');
    // @grafana/scenes caches the full-screen SceneAppPage by pathname only
    // (ignores ?doc=), so an already-mounted full-screen surface never
    // remounts to consume this — signal it directly, same as the floating
    // branch above. Unheard when the surface isn't up yet (mount consumes then).
    document.dispatchEvent(new CustomEvent(REQUEST_FULLSCREEN_GUIDE_EVENT));
    locationService.push(
      buildFullScreenRouteUrl({
        pluginBaseUrl: PLUGIN_BASE_URL,
        fullScreenRoute: ROUTES.FullScreen,
        doc: launch.url,
        guideType: launch.type,
      })
    );
  }, []);

  const handleOpenGuide = useCallback(
    (launch: PreparedGuideLaunch) => {
      if (launch.requiresGrafanaUi) {
        openBesideGrafana(launch);
      } else {
        openFullScreen(launch);
      }
    },
    [openBesideGrafana, openFullScreen]
  );

  return (
    <div className={styles.container} data-testid={testIds.homePage.container}>
      <MyLearningErrorBoundary>
        <MyLearningTab onOpenGuide={handleOpenGuide} />
      </MyLearningErrorBoundary>
    </div>
  );
}
