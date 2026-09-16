/**
 * The frozen block index for the currently-loaded guide.
 *
 * `computeGuideBlockIndex` runs once per content load, over the
 * PRE-inlining tree, and is frozen for the life of that content key —
 * later renders, snippet overlays, and re-parses never recompute it. Both
 * the denominator (`totalBlockCount`) and the numerator's positions
 * (`positionsById` / `positionsByStepId`) come from this one traversal, so
 * they can never disagree with each other or drift across a render.
 *
 * Why frozen: a live count is unstable twice over. `prepare-guide-launch.ts`
 * hands the renderer an already-expanded tree, so the pre-inlining tree is
 * gone before `ContentRenderer` ever sees it on that path; and on the
 * direct-open path, `content-renderer.tsx` parses the pre-inlining tree
 * synchronously for first paint, then swaps in a post-inlining overlay
 * asynchronously once the snippet CDN answers. A naive live count gives a
 * different answer depending on how the reader arrived, and a different
 * answer before and after the overlay lands, milliseconds apart, in one
 * session — progress is monotonic, so an earlier measurement can never be
 * corrected downward. Freezing the index at first paint removes both.
 *
 * Lives in `global-state/` (Tier 1) so the completion store (also Tier 1)
 * can read it without importing into a higher tier. `docs-retrieval` and
 * `snippet-engine` are Tier 2, so the tree is always pushed down by a
 * Tier 4 caller (`content-renderer.tsx`'s content-load seam) — never
 * pulled up.
 */

import type { GuideBlockIndex } from '../lib/guide-stats';

/** Where the frozen denominator came from. Reported in telemetry, never branched on by UI. */
export type ActiveGuideIndexDenominatorSource = 'live-pre-inlining' | 'live-post-inlining-degraded';

export interface ActiveGuideIndex {
  contentKey: string;
  index: GuideBlockIndex;
  denominatorSource: ActiveGuideIndexDenominatorSource;
}

const activeIndexes = new Map<string, ActiveGuideIndex>();

/**
 * Eviction is half a contract: a guide that is still mounted when its index is
 * dropped has no other producer, and its content-load seam has already run —
 * so without a signal it would never publish again and that guide would stop
 * reporting a percentage for the rest of the session. The seam subscribes to
 * this revision and republishes; the index stays frozen per content key
 * between one eviction and the next, because `publishGuideIndex` is
 * idempotent.
 */
const evictionListeners = new Set<() => void>();
let evictionRevision = 0;

function notifyEvicted(): void {
  evictionRevision += 1;
  evictionListeners.forEach((listener) => listener());
}

export function subscribeGuideIndexEvictions(listener: () => void): () => void {
  evictionListeners.add(listener);
  return () => {
    evictionListeners.delete(listener);
  };
}

export function getGuideIndexEvictionRevision(): number {
  return evictionRevision;
}

/**
 * Publish the frozen index for a content key. Idempotent: a later call for
 * a content key that already has one is ignored rather than overwriting —
 * the index is frozen for the life of that key, not just at first publish.
 */
export function publishGuideIndex(entry: ActiveGuideIndex): void {
  if (activeIndexes.has(entry.contentKey)) {
    return;
  }
  activeIndexes.set(entry.contentKey, entry);
}

export function getGuideIndex(contentKey: string): ActiveGuideIndex | undefined {
  return activeIndexes.get(contentKey);
}

/** Paired with `evictContentCache` — a reset must let the next load recompute a fresh index. */
export function evictGuideIndex(contentKey: string): void {
  if (activeIndexes.delete(contentKey)) {
    notifyEvicted();
  }
}

/** Paired with `evictAllContentCaches` — "Reset all learning progress". */
export function evictAllGuideIndexes(): void {
  if (activeIndexes.size === 0) {
    return;
  }
  activeIndexes.clear();
  notifyEvicted();
}
