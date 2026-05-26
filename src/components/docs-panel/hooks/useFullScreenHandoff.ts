/**
 * Owns the `pathfinder-request-full-screen` CustomEvent — the contract by
 * which the panel-mode action buttons request the docs panel switch into
 * the full-screen page, handing off the active guide so the receiving
 * surface lands on the user's current milestone.
 *
 * Mirrors usePopOutHandoff's structure (editor branch, refusal branch,
 * active-guide handoff) with two full-screen-specific differences:
 *   1. Live session block: when a session is active, surface an alert and
 *      return without switching. A fresh SessionProvider on the new page
 *      would disconnect the session, which is worse than refusing.
 *   2. devtools tabs are refused alongside `recommendations` (not popped
 *      out). Pop-out has no equivalent block because devtools has its
 *      own UX in the floating mode.
 *
 * Critical closure rule (addresses pre-mortem H1):
 *   Reads `model.state.tabs` and `model.state.activeTabId` *inside* the
 *   listener closure. The renderer doesn't remount on tab changes, so the
 *   handler must observe the latest state. `isSessionActive` lands in the
 *   effect's dependency array so the gate re-evaluates correctly when the
 *   user joins or leaves a session.
 *
 * Behavior matrix preserved verbatim:
 *   - Live session active: alert "Leave the live session before switching
 *     to full screen." and return.
 *   - Editor tab: capturePriorPath → setPendingGuide({ title, type: 'editor' })
 *     → setMode('fullscreen') → push the bare FullScreen route. No
 *     snapshot, no guideUrl in the route.
 *   - No supported guide (no tab, recommendations, devtools, or no URL):
 *     alert "Open a guide before switching to full screen." and return.
 *   - Active guide: setPendingGuide({ url, title, type, packageInfo }),
 *     capturePriorPath, setMode('fullscreen'), push the full-screen route
 *     with `doc` and `guideType` query params (so a refresh rehydrates
 *     the right tab kind via the URL fallback in FullScreenPanel).
 *
 * Contract surfaces preserved (Pattern J):
 *   - CustomEvent name: `pathfinder-request-full-screen`
 *   - `panelModeManager.setMode('fullscreen')`
 *   - `panelModeManager.setPendingGuide(...)` payload shapes (editor vs guide)
 *   - `panelModeManager.capturePriorPath(...)`
 *   - Full-screen route built via `buildFullScreenRouteUrl` (URL contract
 *     pinned by VIEWER-DEEP-LINK-CONTRACT)
 */
import * as React from 'react';
import { getAppEvents, locationService } from '@grafana/runtime';
import { PLUGIN_BASE_URL, ROUTES } from '../../../constants';
import { reportAppInteraction, UserInteraction, getContentTypeForAnalytics } from '../../../lib/analytics';
import { panelModeManager } from '../../../global-state/panel-mode';
import { buildFullScreenRouteUrl } from '../../../utils/pathfinder-search-params';
import type { CombinedPanelState } from '../../../types/content-panel.types';

interface FullScreenModel {
  state: CombinedPanelState;
}

export function useFullScreenHandoff(model: FullScreenModel, isSessionActive: boolean): void {
  React.useEffect(() => {
    const handleFullScreenRequest = () => {
      if (isSessionActive) {
        getAppEvents().publish({
          type: 'alert-info',
          payload: ['Leave the live session before switching to full screen.'],
        });
        return;
      }

      const { tabs: currentTabs, activeTabId: currentActiveTabId } = model.state;
      const activeTab = currentTabs.find((tab) => tab.id === currentActiveTabId);

      // Editor tab: the block editor itself moves into full screen.
      // We set a pending editor handoff so when the user clicks "Full screen"
      // on the editor while another guide is already in fullscreen
      // (`setMode('fullscreen')` no-ops in that case), the receiving panel
      // still switches its active tab to the editor — replacing the journey.
      if (activeTab?.type === 'editor') {
        reportAppInteraction(UserInteraction.FullScreenEnter, {
          guide_url: '',
          guide_title: activeTab.title,
          content_type: 'editor',
        });
        // Remember where we came from so explicit Exit can land back on the
        // user's prior Grafana page instead of the plugin home.
        panelModeManager.capturePriorPath(window.location.pathname + window.location.search);
        panelModeManager.setPendingGuide({ title: activeTab.title, type: 'editor' });
        panelModeManager.setMode('fullscreen');
        locationService.push(`${PLUGIN_BASE_URL}/${ROUTES.FullScreen}`);
        return;
      }

      // Prefer `currentUrl` (the milestone the user is reading) over the
      // cover-page `baseUrl` so the milestone position carries through to
      // full screen. The dock-back direction already worked because the
      // sidebar restores `currentUrl` from tabStorage on remount — this is
      // the symmetric fix for the forward handoff. For non-journey tabs the
      // two are equal so the swap is a no-op.
      const guideUrl = activeTab?.currentUrl || activeTab?.baseUrl;
      const supportedTab = activeTab && activeTab.id !== 'recommendations' && activeTab.type !== 'devtools' && guideUrl;

      if (!supportedTab) {
        getAppEvents().publish({
          type: 'alert-info',
          payload: ['Open a guide before switching to full screen.'],
        });
        return;
      }

      panelModeManager.setPendingGuide({
        url: guideUrl,
        title: activeTab.title,
        type: activeTab.type === 'learning-journey' ? 'learning-journey' : 'docs',
        // Forward synthetic packageInfo (e.g. PR-tester journeys whose URL
        // is a raw GitHub URL, not a recognised package URL) so the
        // full-screen page rebuilds the milestone toolbar after the handoff.
        packageInfo: activeTab.packageInfo,
      });

      reportAppInteraction(UserInteraction.FullScreenEnter, {
        guide_url: guideUrl,
        guide_title: activeTab.title,
        content_type: getContentTypeForAnalytics(guideUrl, activeTab.type || 'docs'),
      });

      // Remember where we came from so explicit Exit can land back on the
      // user's prior Grafana page instead of the plugin home.
      panelModeManager.capturePriorPath(window.location.pathname + window.location.search);
      panelModeManager.setMode('fullscreen');
      // Encode the tab type in the URL so a refresh / shared link rehydrates
      // the right kind of tab. Without this, FullScreenPanel's URL fallback
      // would call findDocPage and classify a journey package URL as
      // 'interactive', losing the milestone toolbar on reload.
      const tabType = activeTab.type === 'learning-journey' ? 'learning-journey' : 'docs';
      locationService.push(
        buildFullScreenRouteUrl({
          pluginBaseUrl: PLUGIN_BASE_URL,
          fullScreenRoute: ROUTES.FullScreen,
          doc: guideUrl,
          guideType: tabType,
        })
      );
    };

    document.addEventListener('pathfinder-request-full-screen', handleFullScreenRequest);
    return () => {
      document.removeEventListener('pathfinder-request-full-screen', handleFullScreenRequest);
    };
  }, [model, isSessionActive]);
}
