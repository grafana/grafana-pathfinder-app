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

export type AutoDockOutcome = 'sidebar' | 'floating' | 'noop' | 'transient_back';

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
  /** history action driving the navigation — `'POP'` is the browser Back path. */
  action: HistoryAction;
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

  const { guideUrl, title, myPluginId, action } = inputs;

  // Defer the actual mode/sidebar side effects to the next macrotask.
  // The history listener fires synchronously on `locationService.push`,
  // which means it runs INSIDE `NavigateHandler.execute` between
  // `handleDoMode` (the push) and `markAsCompleted`. If we tear down
  // the FullScreenPanel React tree here, `markAsCompleted` is racing
  // against unmount and the step's persistence write may never happen.
  // A `setTimeout(0)` delay yields the microtask queue so the handler's
  // pending `await markAsCompleted()` chain can settle first. The Back
  // branch below relies on the same deferral for a second reason (see there).
  const deferred = (fn: () => void) => setTimeout(fn, 0);

  // Guard 3: browser Back (history POP) out of a transient prose full-screen
  // launch. The launch picked full screen automatically and never expressed a
  // durable surface preference, so the return gesture must not force the
  // extension sidebar open with the prose squeezed in (#1448) — quietly end
  // the transient session so `getMode()` falls back to the stored preference.
  // PUSH/REPLACE keep today's dock (an interactive `navigate` step leaving full
  // screen still needs a panel to continue in); a non-transient POP (a
  // deliberately-adopted full screen) docks too. history v4 can't tell Back
  // from Forward — both are POP — which is acceptable for this quiet exit.
  //
  // Deferring `endTransientSession` is load-bearing: `FullScreenPanel`'s unmount
  // cleanup must run first, while `getMode()` is still `'fullscreen'`, so it
  // clears `isSidebarMounted`. Ending the session synchronously would flip
  // `getMode()` to the stored preference before the cleanup's mode check and
  // strand the mount flag stale-true with no surface.
  if (action === 'POP' && panelModeManager.isTransient()) {
    reportAppInteraction(UserInteraction.FullScreenExit, {
      destination: 'none',
      guide_url: guideUrl || '',
      guide_title: title,
      reason: 'transient_back',
    });
    deferred(() => panelModeManager.endTransientSession());
    return 'transient_back';
  }

  if (isExtensionSidebarOwnedByOther(myPluginId)) {
    // Sidebar is taken — pop out as a floating overlay so we co-exist
    // with whatever plugin owns the sidebar instead of stealing it.
    reportAppInteraction(UserInteraction.FullScreenExit, {
      destination: 'floating',
      guide_url: guideUrl || '',
      guide_title: title,
      reason: 'navigation_away_sidebar_occupied',
    });
    deferred(() => panelModeManager.setMode('floating'));
    return 'floating';
  }

  reportAppInteraction(UserInteraction.FullScreenExit, {
    destination: 'sidebar',
    guide_url: guideUrl || '',
    guide_title: title,
    reason: 'navigation_away',
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
