/**
 * Auto-dock decision for the full-screen panel.
 *
 * When something navigates the user off `/a/<plugin>/fullscreen` (an
 * interactive `navigate` step, a link click in guide content, the Grafana
 * nav, browser back, ...) `FullScreenPanel` unmounts but `panelModeManager`
 * still says `'fullscreen'` — leaving the user with no panel to complete
 * the step in. This module decides where to send the panel next:
 *
 * - **Sidebar free / owned by us** → switch to `'sidebar'` mode and reopen
 *   the extension sidebar.
 * - **Sidebar owned by another plugin** (e.g. Grafana Assistant) → switch
 *   to `'floating'` mode so we co-exist as an overlay rather than steal
 *   the surface.
 *
 * The logic lives outside `FullScreenPanel.tsx` so it can be unit-tested
 * without spinning up the full Scenes panel.
 */

import { panelModeManager } from '../../global-state/panel-mode';
import { sidebarState } from '../../global-state/sidebar';
import { isExtensionSidebarOwnedByOther } from '../../utils/experiments/experiment-utils';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import type { LearningJourneyTab } from '../../types/content-panel.types';

export type AutoDockOutcome = 'sidebar' | 'floating' | 'noop';

export interface AutoDockInputs {
  /** New pathname after the navigation. */
  pathname: string;
  /** The fullscreen route's pathname (`/a/<plugin>/fullscreen`). */
  fullScreenPathname: string;
  /** Pathfinder's plugin id, used for the sidebar-ownership comparison. */
  myPluginId: string;
  /** Captured from `FullScreenPanel`'s active tab — used for the floating handoff. */
  guideUrl: string | undefined;
  title: string;
  activeTab: LearningJourneyTab | undefined;
}

/**
 * Decide and execute the auto-dock side effects after a location change.
 *
 * Returns the outcome ('sidebar' | 'floating' | 'noop') so callers /
 * tests can assert which branch fired without re-creating the guards
 * here.
 */
export function dockOnLeavingFullScreen(inputs: AutoDockInputs): AutoDockOutcome {
  // Guard 1: the explicit Exit / Switch-to-floating buttons set mode
  // BEFORE pushing the new route, so by the time their push reaches
  // us mode is already 'sidebar' / 'floating' and we skip — avoids
  // double-firing or fighting the user's explicit choice.
  if (panelModeManager.getMode() !== 'fullscreen') {
    return 'noop';
  }
  // Guard 2: search/hash-only changes (e.g. ?doc=… churn) keep us on
  // the fullscreen route — only react to actual pathname changes.
  if (inputs.pathname === inputs.fullScreenPathname) {
    return 'noop';
  }

  const { guideUrl, title, activeTab, myPluginId } = inputs;

  if (isExtensionSidebarOwnedByOther(myPluginId)) {
    // Sidebar is taken — pop out as a floating overlay so we co-exist
    // with whatever plugin owns the sidebar instead of stealing it.
    reportAppInteraction(UserInteraction.FullScreenExit, {
      destination: 'floating',
      guide_url: guideUrl || '',
      guide_title: title,
      reason: 'navigation_away_sidebar_occupied',
    });
    // Hand off the journey + packageInfo so the floating panel rebuilds
    // the milestone toolbar without round-tripping through tabStorage.
    if (guideUrl && activeTab) {
      const tabType = activeTab.type === 'learning-journey' ? 'learning-journey' : 'docs';
      panelModeManager.setPendingGuide({
        url: guideUrl,
        title,
        type: tabType,
        packageInfo: activeTab.packageInfo,
      });
    }
    panelModeManager.setMode('floating');
    return 'floating';
  }

  reportAppInteraction(UserInteraction.FullScreenExit, {
    destination: 'sidebar',
    guide_url: guideUrl || '',
    guide_title: title,
    reason: 'navigation_away',
  });

  panelModeManager.restoreSidebarTabSnapshot();
  panelModeManager.setMode('sidebar');
  sidebarState.setPendingOpenSource('fullscreen_handoff', 'open');
  sidebarState.openSidebar('Interactive learning');
  return 'sidebar';
}
