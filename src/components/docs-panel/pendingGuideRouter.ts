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
 * sidebar mode (PR #1446 review finding 3).
 */

import { panelModeManager, type PendingGuide } from '../../global-state/panel-mode';
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
