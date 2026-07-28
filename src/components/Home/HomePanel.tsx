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
 *   another plugin owns the extension sidebar.
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
import { linkInterceptionState } from '../../global-state/link-interception';
import { panelModeManager, type PendingGuide } from '../../global-state/panel-mode';
import { isExtensionSidebarOwnedByOther } from '../../lib/storage/extension-sidebar';
import { PLUGIN_BASE_URL, ROUTES } from '../../constants';
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

function pendingGuideFrom(launch: PreparedGuideLaunch): PendingGuide {
  return {
    url: launch.url,
    title: launch.title,
    type: launch.type,
    packageInfo: launch.packageInfo,
    preparedContent: launch.preparedContent,
  };
}

export function HomePanelRenderer() {
  const styles = useStyles2(getHomePageStyles);

  // Open beside Grafana: sidebar, or a floating overlay when another plugin
  // owns the extension sidebar. Carries the prepared content so the tab opens
  // without a second fetch.
  const openBesideGrafana = useCallback((launch: PreparedGuideLaunch) => {
    if (isExtensionSidebarOwnedByOther(pluginJson.id)) {
      panelModeManager.setPendingGuide(pendingGuideFrom(launch));
      panelModeManager.setModeTransient('floating');
      return;
    }

    const detail = {
      url: launch.url,
      title: launch.title,
      source: launch.source,
      preparedContent: launch.preparedContent,
    };
    if (sidebarState.getIsSidebarMounted()) {
      document.dispatchEvent(new CustomEvent('pathfinder-auto-open-docs', { detail }));
    } else {
      sidebarState.setPendingOpenSource('home_page');
      sidebarState.openSidebar('Interactive learning', {
        url: detail.url,
        title: detail.title,
        timestamp: Date.now(),
      });
      linkInterceptionState.addToQueue({
        url: launch.url,
        title: launch.title,
        timestamp: Date.now(),
        preparedContent: launch.preparedContent,
      });
    }
  }, []);

  // Open full screen for reading-only content. Mirrors the sidebar→full-screen
  // handoff order (pending guide → prior path → mode → route), but selects the
  // mode transiently so the user's stored preference is untouched.
  const openFullScreen = useCallback((launch: PreparedGuideLaunch) => {
    panelModeManager.setPendingGuide(pendingGuideFrom(launch));
    panelModeManager.capturePriorPath(window.location.pathname + window.location.search);
    panelModeManager.setModeTransient('fullscreen');
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
