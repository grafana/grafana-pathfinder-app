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

  // Defer the actual mode/sidebar side effects to the next macrotask.
  // The history listener fires synchronously on `locationService.push`,
  // which means it runs INSIDE `NavigateHandler.execute` between
  // `handleDoMode` (the push) and `markAsCompleted`. If we tear down
  // the FullScreenPanel React tree here, `markAsCompleted` is racing
  // against unmount and the step's persistence write may never happen.
  // A `setTimeout(0)` delay yields the microtask queue so the handler's
  // pending `await markAsCompleted()` chain can settle first.
  const deferred = (fn: () => void) => setTimeout(fn, 0);

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
    deferred(() => panelModeManager.setMode('floating'));
    return 'floating';
  }

  reportAppInteraction(UserInteraction.FullScreenExit, {
    destination: 'sidebar',
    guide_url: guideUrl || '',
    guide_title: title,
    reason: 'navigation_away',
  });

  // No `restoreSidebarTabSnapshot()`: we intentionally keep the latest
  // tabStorage state full-screen wrote (active milestone URL, completion,
  // etc.) so the docking sidebar restores the user where they left off,
  // not where they started. Sidebar and full-screen share intent — the
  // snapshot mechanism is only useful when surfaces have separate tab
  // sets (i.e. floating).
  deferred(() => {
    panelModeManager.setMode('sidebar');
    sidebarState.setPendingOpenSource('fullscreen_handoff', 'open');
    sidebarState.openSidebar('Interactive learning');
  });
  return 'sidebar';
}
