/**
 * Unified progress event channel.
 *
 * Replaces five legacy events:
 *   - `interactive-step-completed`
 *   - `section-completed`
 *   - `interactive-section-completed`
 *   - `interactive-progress-saved`
 *   - `interactive-progress-cleared` (`kind: 'guide'` with `hasProgress: false`)
 *
 * The discriminated payload makes intent explicit at the dispatch site
 * and at every listener. Lives in `global-state` (Tier 1) so both the
 * engines tier (e.g. `requirements-manager`) and the UI tier
 * (`components/interactive-tutorial`) can subscribe without violating
 * the import-graph tier ratchet.
 *
 * `ProgressReason` is a structural duplicate of
 * `requirements-manager/step-state.CompletionReason` — Tier 1 cannot
 * import from Tier 2, and the union is small + stable enough that
 * keeping them aligned is cheaper than moving the type to Tier 0.
 */

export type ProgressReason = 'none' | 'objectives' | 'manual' | 'skipped';

/** Broadcast `contentKey` — every key-scoped listener must accept this. */
export const PROGRESS_CONTENT_KEY_WILDCARD = '*' as const;

export interface GuideProgressDetail {
  kind: 'guide';
  contentKey: string;
  percentage: number;
  hasProgress: boolean;
}

/** Narrowed shape: the canonical "guide cleared" signal. */
export type GuideClearDetail = GuideProgressDetail & { hasProgress: false };

export type ProgressEventDetail =
  | {
      kind: 'step';
      stepId: string;
      sectionId?: string;
      completed: boolean;
      reason: ProgressReason;
    }
  | {
      kind: 'section';
      sectionId: string;
      completed: boolean;
      percentage?: number;
    }
  // Guide-level aggregate. `hasProgress: false` is the canonical
  // clear signal; `contentKey: '*'` broadcasts across every guide.
  | GuideProgressDetail;

export const PROGRESS_EVENT = 'pathfinder:progress' as const;

export function dispatchProgress(detail: ProgressEventDetail): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent(PROGRESS_EVENT, { detail }));
}

export function subscribeProgressEvent(listener: (detail: ProgressEventDetail) => void): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }
  const handler = (event: Event): void => {
    listener((event as CustomEvent<ProgressEventDetail>).detail);
  };
  window.addEventListener(PROGRESS_EVENT, handler);
  return () => window.removeEventListener(PROGRESS_EVENT, handler);
}

/** Exact match OR the wildcard sentinel. */
export function matchesContentKey(detail: { contentKey: string }, expected: string): boolean {
  return detail.contentKey === expected || detail.contentKey === PROGRESS_CONTENT_KEY_WILDCARD;
}

/**
 * Type-guard for clear-only listeners: narrows to `GuideClearDetail` and
 * — when `expectedKey` is supplied — also accepts the wildcard sentinel.
 *
 * Collapses the three checks (`kind === 'guide'` + `!hasProgress` +
 * `matchesContentKey`) every clear-only subscriber must perform into a
 * single call so a future site can't forget the `!hasProgress` half and
 * silently treat a fresh-progress event as a clear.
 */
export function isGuideClear(detail: ProgressEventDetail, expectedKey?: string): detail is GuideClearDetail {
  if (detail.kind !== 'guide' || detail.hasProgress) {
    return false;
  }
  return expectedKey === undefined || matchesContentKey(detail, expectedKey);
}
