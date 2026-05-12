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
 * The receiving surface still owns the in-flight bookkeeping
 * (`guideOpenInFlightRef`) and reads `panelModeManager.consumePendingGuide()`
 * itself; this helper is just the routing decision so it stays consistent.
 */

import type { PendingGuide } from '../../global-state/panel-mode';
import type { CombinedLearningJourneyPanel } from './docs-panel';
import type { LaunchSource } from '../../recovery';

/**
 * Apply a consumed pending guide to the receiving panel model.
 *
 * The branch order is load-bearing:
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
  if (pending.type === 'editor') {
    panel.openEditorTab();
    return;
  }
  if (!pending.url) {
    return;
  }
  if (pending.packageInfo) {
    panel.openDocsPage(pending.url, pending.title, { source, packageInfo: pending.packageInfo });
  } else if (pending.type === 'learning-journey') {
    panel.openLearningJourney(pending.url, pending.title, { source });
  } else {
    panel.openDocsPage(pending.url, pending.title, { source });
  }
}
