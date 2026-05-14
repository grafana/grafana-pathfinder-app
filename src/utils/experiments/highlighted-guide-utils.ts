/**
 * Highlighted-Guide Experiment Utilities
 *
 * Pure helpers (localStorage only — no DOM events) for the
 * `pathfinder.highlighted-guide-experiment` A/B test.
 *
 * Two responsibilities:
 * 1. Once-per-browser auto-open markers keyed by `(hostname, guideId)`. Changing
 *    the flag's `guideId` automatically re-arms auto-open because the marker
 *    key changes.
 * 2. Page-pattern matching against the flag's `pages[]`. Empty `pages` ⇒ no
 *    match (different from `pathfinder.experiment-variant`, where empty = all
 *    pages — that semantic difference is intentional: the safe default for the
 *    new flag is "do nothing").
 *
 * Also exposes a guide-id → synthetic `Recommendation` builder used by the
 * context-engine's featured-injection seam.
 */

import { StorageKeys } from '../../lib/storage-keys';
import type { Recommendation } from '../../types/context.types';
import { findDocPage } from '../find-doc-page';
import { matchPathPattern, type HighlightedGuideDocType } from '../openfeature';

// ============================================================================
// MARKER LIFECYCLE
// ============================================================================

export function getHighlightedGuideMarkerKey(hostname: string, guideId: string): string {
  return `${StorageKeys.HIGHLIGHTED_GUIDE_AUTO_OPEN_PREFIX}${hostname}:${guideId}`;
}

export function hasHighlightedGuideAutoOpened(hostname: string, guideId: string): boolean {
  if (!guideId) {
    return false;
  }
  try {
    return localStorage.getItem(getHighlightedGuideMarkerKey(hostname, guideId)) === 'true';
  } catch {
    return false;
  }
}

export function markHighlightedGuideAutoOpened(hostname: string, guideId: string): void {
  if (!guideId) {
    return;
  }
  try {
    localStorage.setItem(getHighlightedGuideMarkerKey(hostname, guideId), 'true');
  } catch {
    // localStorage unavailable — auto-open will re-fire next load, which is acceptable
  }
}

export function clearHighlightedGuideMarkers(hostname: string): void {
  try {
    const prefix = `${StorageKeys.HIGHLIGHTED_GUIDE_AUTO_OPEN_PREFIX}${hostname}:`;
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        toRemove.push(key);
      }
    }
    toRemove.forEach((key) => localStorage.removeItem(key));
  } catch {
    // localStorage unavailable
  }
}

// ============================================================================
// PAGE MATCHING
// ============================================================================

/**
 * Does the current path match any pattern in the flag's `pages[]`?
 *
 * Empty `pages` returns `false` (no match) — intentionally different from
 * `pathfinder.experiment-variant`'s "empty = all" semantics, so the default
 * flag value never triggers anything.
 */
export function matchesHighlightedGuidePage(pages: string[], currentPath: string): boolean {
  if (!Array.isArray(pages) || pages.length === 0) {
    return false;
  }
  return pages.some((pattern) => matchPathPattern(pattern, currentPath));
}

// ============================================================================
// SYNTHETIC FEATURED RECOMMENDATION
// ============================================================================

/**
 * Build a synthetic `Recommendation` for the configured `guideId` so it can be
 * injected into the Featured slot.
 *
 * Returns `null` if the `guideId` cannot be resolved (e.g. blank, unknown
 * bundled id, URL not on the docs/interactive-learning allowlists). Callers
 * should skip injection silently on `null` — flag misconfig must never crash
 * the panel.
 *
 * `docTypeOverride` lets an operator force the card type (and therefore the
 * click-through flow). When omitted, the auto-detected type from `findDocPage`
 * is used — which is fine for most URLs but can mis-classify (e.g. a docs
 * URL that's actually a learning journey gets returned as `'docs-page'`).
 *
 * The card is intentionally sparse: only `title`, `url`, `type`, and
 * `matchAccuracy` are set. The existing renderer at
 * `src/components/docs-panel/context-panel.tsx:380` tolerates missing
 * `summary` / `totalSteps` / `completionPercentage` gracefully.
 */
export function buildSyntheticFeaturedRecommendation(
  guideId: string,
  docTypeOverride?: HighlightedGuideDocType
): Recommendation | null {
  const trimmed = guideId?.trim();
  if (!trimmed) {
    return null;
  }
  const docPage = findDocPage(trimmed);
  if (!docPage) {
    return null;
  }
  return {
    title: docPage.title,
    url: docPage.url,
    type: docTypeOverride ?? docPage.type,
    matchAccuracy: 1,
    summary: '',
  };
}
