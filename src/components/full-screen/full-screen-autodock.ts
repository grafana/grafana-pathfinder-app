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
import { isExtensionSidebarOwnedByOther } from '../../lib/storage/extension-sidebar';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';

export type AutoDockOutcome = 'sidebar' | 'floating' | 'noop' | 'transient_back' | 'transient_navigation';

/**
 * Every `reason` value reported on `UserInteraction.FullScreenExit`, across
 * both this module's automatic auto-dock decisions and `FullScreenPanel.tsx`'s
 * manual/handoff exit paths — one shared union so the two files can't drift
 * into colliding or undocumented values for the same analytics dimension.
 */
export type FullScreenExitReason =
  | 'transient_back'
  | 'transient_navigation'
  | 'navigation_away_sidebar_occupied'
  | 'navigation_away'
  | 'manual_exit'
  | 'empty_state_fallback'
  | 'dock_request'
  | 'content_requires_grafana_ui';

/** history@4 navigation actions (`history.listen`'s second argument). */
export type HistoryAction = 'PUSH' | 'REPLACE' | 'POP';

export interface AutoDockInputs {
  /** New pathname after the navigation. */
  pathname: string;
  /** The fullscreen route's pathname (`/a/<plugin>/fullscreen`). */
  fullScreenPathname: string;
  /** Pathfinder's plugin id, used for the sidebar-ownership comparison. */
  myPluginId: string;
  /** Captured from `FullScreenPanel`'s active tab — reported as analytics context. */
  guideUrl: string | undefined;
  title: string;
  /** history action driving the navigation — `'POP'` is browser Back and `'PUSH'` includes Grafana nav clicks. */
  action: HistoryAction;
}

/**
 * Decide and execute the auto-dock side effects after a location change.
 *
 * Returns the outcome so callers and tests can assert which branch fired
 * without re-creating the guards here.
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

  const { guideUrl, title, myPluginId, action } = inputs;

  // Defer the actual mode/sidebar side effects to the next macrotask.
  // The history listener fires synchronously on `locationService.push`,
  // which means it runs INSIDE `NavigateHandler.execute` between
  // `handleDoMode` (the push) and `markAsCompleted`. If we tear down
  // the FullScreenPanel React tree here, `markAsCompleted` is racing
  // against unmount and the step's persistence write may never happen.
  // A `setTimeout(0)` delay yields the microtask queue so the handler's
  // pending `await markAsCompleted()` chain can settle first. The transient
  // quiet-exit branch below relies on the same deferral for a second reason.
  const deferred = (fn: () => void) => setTimeout(fn, 0);

  // Guard 3: Back or ordinary navigation out of a transient prose launch. An
  // interactive action requests its sidebar handoff before pushing, which
  // changes mode and exits through Guard 1; fixLocationRequirement uses the
  // same facade. A PUSH that reaches this branch therefore has no interactive
  // continuation to preserve and should not force a surface open (#1472).
  // REPLACE and every non-transient navigation keep the docking behavior.
  //
  // Deferring `endTransientSession` is load-bearing: `FullScreenPanel`'s unmount
  // cleanup must run first, while `getMode()` is still `'fullscreen'`, so it
  // clears `isSidebarMounted`. Ending the session synchronously would flip
  // `getMode()` to the stored preference before the cleanup's mode check and
  // strand the mount flag stale-true with no surface.
  const transientExitReason =
    action === 'POP' ? 'transient_back' : action === 'PUSH' ? 'transient_navigation' : undefined;
  if (transientExitReason && panelModeManager.isTransient()) {
    reportAppInteraction(UserInteraction.FullScreenExit, {
      destination: 'none',
      guide_url: guideUrl || '',
      guide_title: title,
      reason: transientExitReason satisfies FullScreenExitReason,
    });
    deferred(() => panelModeManager.endTransientSession());
    return transientExitReason;
  }

  if (isExtensionSidebarOwnedByOther(myPluginId)) {
    // Sidebar is taken — pop out as a floating overlay so we co-exist
    // with whatever plugin owns the sidebar instead of stealing it.
    reportAppInteraction(UserInteraction.FullScreenExit, {
      destination: 'floating',
      guide_url: guideUrl || '',
      guide_title: title,
      reason: 'navigation_away_sidebar_occupied' satisfies FullScreenExitReason,
    });
    deferred(() => panelModeManager.setMode('floating'));
    return 'floating';
  }

  reportAppInteraction(UserInteraction.FullScreenExit, {
    destination: 'sidebar',
    guide_url: guideUrl || '',
    guide_title: title,
    reason: 'navigation_away' satisfies FullScreenExitReason,
  });

  // All surfaces share `tabStorage` — the docking sidebar restores the
  // latest milestone URL full-screen wrote during the session, not the
  // pre-fullscreen position.
  deferred(() => {
    panelModeManager.setMode('sidebar');
    sidebarState.setPendingOpenSource('fullscreen_handoff', 'open');
    sidebarState.openSidebar('Interactive learning');
  });
  return 'sidebar';
}
