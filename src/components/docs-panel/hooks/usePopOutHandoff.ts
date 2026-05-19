/**
 * Owns the `pathfinder-request-pop-out` CustomEvent — the contract by which
 * the panel-mode action buttons request the docs panel switch from
 * `sidebar` to `floating`, handing off the active guide so the floating
 * instance lands on the user's current milestone instead of the cover page.
 *
 * Critical closure rule (addresses pre-mortem H1):
 *   The handler reads `model.state.tabs` and `model.state.activeTabId`
 *   *inside* the event-listener closure — not at hook scope and not via
 *   captured props. Scene state updates synchronously without remounting
 *   the renderer, so the listener must re-read state on every fire to see
 *   the current tab. Lifting the read to the effect body would freeze the
 *   handoff on whatever tab was active at mount.
 *
 * Behavior matrix preserved verbatim:
 *   - Editor tab: snapshot sidebar tabs, switch mode to `floating`. The
 *     floating instance detects the editor tab and renders the BlockEditor
 *     directly — no `setPendingGuide` payload needed.
 *   - No active guide (no active tab, recommendations tab, or no URL):
 *     publish an alert-info ("Open a guide before popping out the panel.")
 *     and return without changing modes.
 *   - Active guide: set `pendingGuide` ({ url, title, type, packageInfo }),
 *     snapshot sidebar tabs, switch mode to `floating`. `currentUrl` is
 *     preferred over `baseUrl` so the floating instance opens at the
 *     user's milestone, not the cover.
 *
 * Analytics: emits `UserInteraction.FloatingPanelPopOut` with `guide_url`
 * + `guide_title`, both branches (editor and guide). Editor branch sends
 * an empty `guide_url`.
 *
 * Contract surfaces preserved (Pattern J):
 *   - CustomEvent name: `pathfinder-request-pop-out`
 *   - `panelModeManager.setMode('floating')`
 *   - `panelModeManager.setPendingGuide(...)` payload shape
 *   - `panelModeManager.snapshotSidebarTabs()`
 */
import * as React from 'react';
import { getAppEvents } from '@grafana/runtime';
import { reportAppInteraction, UserInteraction } from '../../../lib/analytics';
import { panelModeManager } from '../../../global-state/panel-mode';
import type { CombinedPanelState } from '../../../types/content-panel.types';

/**
 * Structural type for the hook's model parameter. Defined here (not imported
 * from `../docs-panel`) to avoid a `hooks/ → docs-panel.tsx → hooks/` import
 * cycle. The real model is `CombinedLearningJourneyPanel`, which satisfies
 * this shape by virtue of extending `SceneObjectBase<CombinedPanelState>`.
 */
interface PopOutModel {
  state: CombinedPanelState;
}

export function usePopOutHandoff(model: PopOutModel): void {
  React.useEffect(() => {
    const handlePopOut = () => {
      // Read inside the closure — see "Critical closure rule" in the file header.
      const { tabs: currentTabs, activeTabId: currentActiveTabId } = model.state;
      const activeTab = currentTabs.find((tab) => tab.id === currentActiveTabId);
      // Prefer `currentUrl` so a popped-out learning journey lands on the
      // user's current milestone, not the cover page. For non-journey tabs
      // the two fields are equal.
      const guideUrl = activeTab?.currentUrl || activeTab?.baseUrl;

      // Editor tab popout: the block editor itself moves into the floating panel.
      // No pendingGuide handoff — the floating panel detects the editor tab and
      // renders <BlockEditor /> directly (see FloatingPanelManager).
      if (activeTab?.type === 'editor') {
        reportAppInteraction(UserInteraction.FloatingPanelPopOut, {
          guide_url: '',
          guide_title: activeTab.title,
        });
        panelModeManager.snapshotSidebarTabs();
        // The floating panel creates a new CombinedLearningJourneyPanel instance
        // with its own per-instance `_hasRestoredTabs` guard, so it can rehydrate
        // the editor tab from localStorage without any cross-instance reset.
        panelModeManager.setMode('floating');
        return;
      }

      // Refuse to pop out when there's no guide context — without this guard the
      // sidebar would close and the floating panel would have nothing to show.
      // Surface a notification so the user understands why nothing happened.
      if (!activeTab || activeTab.id === 'recommendations' || !guideUrl) {
        getAppEvents().publish({
          type: 'alert-info',
          payload: ['Open a guide before popping out the panel.'],
        });
        return;
      }

      panelModeManager.setPendingGuide({
        url: guideUrl,
        title: activeTab.title,
        type: activeTab.type === 'learning-journey' ? 'learning-journey' : 'docs',
        // Forward synthetic packageInfo (e.g. PR-tester journeys whose URL
        // is a raw GitHub URL, not a recognised package URL) so the floating
        // panel rebuilds the milestone toolbar after the handoff.
        packageInfo: activeTab.packageInfo,
      });

      reportAppInteraction(UserInteraction.FloatingPanelPopOut, {
        guide_url: guideUrl,
        guide_title: activeTab.title,
      });

      // Snapshot sidebar tabs before switching — the floating panel's model
      // will overwrite tabStorage via openDocsPage → saveTabsToStorage
      panelModeManager.snapshotSidebarTabs();
      panelModeManager.setMode('floating');
    };

    document.addEventListener('pathfinder-request-pop-out', handlePopOut);
    return () => {
      document.removeEventListener('pathfinder-request-pop-out', handlePopOut);
    };
  }, [model]);
}
