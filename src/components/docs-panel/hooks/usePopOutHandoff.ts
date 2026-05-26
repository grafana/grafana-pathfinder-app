/**
 * Owns the `pathfinder-request-pop-out` CustomEvent — the contract by which
 * the panel-mode action buttons request the docs panel switch from
 * `sidebar` to `floating`. The floating panel restores tabs (including
 * the active guide's `currentUrl`) from the shared `tabStorage`, so the
 * handoff is just: flush tabs to storage, then flip the mode.
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
 *   - Editor tab: flush tabs to storage, switch mode to `floating`. The
 *     floating instance detects the editor tab on restore and renders
 *     the BlockEditor directly.
 *   - No active guide (no active tab, recommendations tab, or no URL):
 *     publish an alert-info ("Open a guide before popping out the panel.")
 *     and return without changing modes.
 *   - Active guide: flush tabs to storage, switch mode to `floating`.
 *     The floating instance restores from `tabStorage` and lands on the
 *     active tab at its current milestone (`currentUrl`).
 *
 * Analytics: emits `UserInteraction.FloatingPanelPopOut` with `guide_url`
 * + `guide_title`, both branches (editor and guide). Editor branch sends
 * an empty `guide_url`.
 *
 * Contract surfaces preserved (Pattern J):
 *   - CustomEvent name: `pathfinder-request-pop-out`
 *   - `panelModeManager.setMode('floating')`
 *   - `model.saveTabsToStorage()` awaited before the mode flip
 */
import * as React from 'react';
import { getAppEvents } from '@grafana/runtime';
import { reportAppInteraction, UserInteraction } from '../../../lib/analytics';
import { panelModeManager } from '../../../global-state/panel-mode';
import type { CombinedPanelState } from '../../../types/content-panel.types';

interface PopOutModel {
  state: CombinedPanelState;
  saveTabsToStorage(): Promise<void>;
}

export function usePopOutHandoff(model: PopOutModel): void {
  React.useEffect(() => {
    const handlePopOut = async () => {
      const { tabs: currentTabs, activeTabId: currentActiveTabId } = model.state;
      const activeTab = currentTabs.find((tab) => tab.id === currentActiveTabId);
      const guideUrl = activeTab?.currentUrl || activeTab?.baseUrl;

      if (activeTab?.type === 'editor') {
        reportAppInteraction(UserInteraction.FloatingPanelPopOut, {
          guide_url: '',
          guide_title: activeTab.title,
        });
        await model.saveTabsToStorage();
        panelModeManager.setMode('floating');
        return;
      }

      if (!activeTab || activeTab.id === 'recommendations' || !guideUrl) {
        getAppEvents().publish({
          type: 'alert-info',
          payload: ['Open a guide before popping out the panel.'],
        });
        return;
      }

      reportAppInteraction(UserInteraction.FloatingPanelPopOut, {
        guide_url: guideUrl,
        guide_title: activeTab.title,
      });

      await model.saveTabsToStorage();
      panelModeManager.setMode('floating');
    };

    document.addEventListener('pathfinder-request-pop-out', handlePopOut);
    return () => {
      document.removeEventListener('pathfinder-request-pop-out', handlePopOut);
    };
  }, [model]);
}
