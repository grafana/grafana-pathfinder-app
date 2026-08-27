/**
 * Open a pending guide handed off via `panelModeManager.setPendingGuide(...)`.
 *
 * Why this exists: the same `editor` / `packageInfo` / `learning-journey` /
 * fallback branch was duplicated three times across the surfaces that
 * consume `panelModeManager.consumePendingGuide()` — the floating panel mount
 * effect, the fullscreen panel mount effect, and the fullscreen
 * `pathfinder-request-full-screen` swap handler. Drift between those copies
 * has produced real bugs (e.g. one branch used to forget to forward
 * `packageInfo`, breaking the milestone toolbar for synthetic PR-tester
 * journeys whose URL is a raw GitHub URL rather than a recognised package URL).
 *
 * `consumePendingGuideOnMount` bundles the full consume step (consume →
 * mark in-flight → route) for surface mount effects, so a surface cannot
 * forget one of the three parts — the floating panel shipped exactly that
 * bug once: it set pending guides but never consumed them, so an
 * occupied-sidebar launch showed stale restored tabs or fell back to
 * sidebar mode.
 */

import { panelModeManager, type PendingGuide } from '../../global-state/panel-mode';
import type { CombinedLearningJourneyPanel } from './docs-panel';
import type { LaunchSource } from '../../recovery';

/**
 * Apply a consumed pending guide to the receiving panel model.
 *
 * The branch order is load-bearing:
 * 0. `tabId` naming a tab that already exists — the surface restored the strip
 *    first, so the handoff target is a tab we already have. Focus it; every
 *    open method below appends unconditionally and would duplicate the guide.
 * 1. `editor` handoffs carry no URL — switch the active tab to the editor.
 * 2. URL + `packageInfo` → `openDocsPage` with the manifest, so synthetic
 *    journeys (PR-tester) get a journey tab with the milestone toolbar even
 *    when the URL isn't a recognised package URL.
 * 3. `type === 'learning-journey'` → preserve the journey type so the tab
 *    keeps its milestone navigation; without this, calling `openDocsPage` on
 *    a recognised journey URL would create a flat 'docs' tab.
 * 4. Otherwise → plain `openDocsPage` (auto-detects interactive content).
 */
export function openPendingGuide(
  panel: CombinedLearningJourneyPanel,
  pending: PendingGuide,
  source: LaunchSource
): void {
  if (pending.tabId && panel.state.tabs.some((tab) => tab.id === pending.tabId)) {
    // Restore already made it active and kicked off its content load, so
    // re-selecting it would only risk a second fetch for the same tab.
    if (panel.state.activeTabId !== pending.tabId) {
      panel.setActiveTab(pending.tabId);
    }
    return;
  }

  if (pending.type === 'editor') {
    panel.openEditorTab();
    return;
  }
  if (!pending.url) {
    return;
  }
  const preparedContent = pending.preparedContent;
  if (pending.packageInfo) {
    panel.openDocsPage(pending.url, pending.title, { source, packageInfo: pending.packageInfo, preparedContent });
  } else if (pending.type === 'learning-journey') {
    panel.openLearningJourney(pending.url, pending.title, { source, preparedContent });
  } else {
    panel.openDocsPage(pending.url, pending.title, { source, preparedContent });
  }
}

/**
 * Consume any pending guide: consume-once read → mark the open as in-flight
 * (BEFORE routing, so the surface's empty-state fallback and tab restoration
 * cannot race the open) → route via `openPendingGuide`. Called from surface
 * mount effects and from already-mounted consume signals (the floating
 * panel's `REQUEST_FLOATING_GUIDE_EVENT` listener, the fullscreen swap
 * handler); the consume-once read makes overlapping consumers safe.
 *
 * The guide's own `source` (carried from the original launch so alignment
 * semantics survive the handoff) wins over `fallbackSource`, which is the
 * surface's legacy handoff source for pending guides set before the field
 * existed.
 *
 * Returns true when a pending guide was consumed.
 */
export function consumePendingGuideOnMount(
  panel: CombinedLearningJourneyPanel,
  fallbackSource: LaunchSource,
  markInFlight: () => void
): boolean {
  const pending = panelModeManager.consumePendingGuide();
  if (!pending) {
    return false;
  }
  markInFlight();
  openPendingGuide(panel, pending, pending.source ?? fallbackSource);
  return true;
}

/**
 * Restore the complete workspace before applying a one-tab launch intent.
 *
 * Order is the whole point. Opening the handoff first makes the strip
 * non-empty, which skips restore — the surface then owns a single-tab model
 * and the next `saveTabsToStorage()` erases every sibling tab from the shared
 * workspace. Consuming the pending guide up front (before the await) keeps the
 * consume-once read synchronous with mount, so the in-flight flag is set
 * before the empty-state fallback can look at it.
 *
 * The flip side of restoring first is that the handoff target is now already
 * in the strip — `openPendingGuide` relies on `pending.tabId` to focus it
 * rather than append a duplicate.
 *
 * Returns true when a pending guide was consumed.
 */
export async function initializePanelTabsOnMount(
  panel: CombinedLearningJourneyPanel,
  fallbackSource: LaunchSource,
  markInFlight: () => void
): Promise<boolean> {
  const pending = panelModeManager.consumePendingGuide();
  if (pending) {
    markInFlight();
  }

  await panel.restoreTabsAsync();

  if (pending) {
    openPendingGuide(panel, pending, pending.source ?? fallbackSource);
  }
  return pending !== null;
}
