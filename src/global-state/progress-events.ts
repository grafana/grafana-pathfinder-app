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

/**
 * Sentinel `contentKey` value that means "every guide". Used by
 * "reset all progress" and "reset learning path" flows to broadcast a
 * `kind: 'guide'` clear that any listener (regardless of its tracked
 * key) should react to. Listeners must accept this in addition to an
 * exact `contentKey` match.
 */
export const PROGRESS_CONTENT_KEY_WILDCARD = '*' as const;

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
  | {
      /**
       * Guide-level aggregate progress. `hasProgress: false` is the
       * canonical "cleared" signal — supersedes the legacy
       * `interactive-progress-cleared` window event. `contentKey` may
       * be `PROGRESS_CONTENT_KEY_WILDCARD` (`'*'`) to broadcast a clear
       * across every guide (e.g. "reset all progress" / path reset).
       */
      kind: 'guide';
      contentKey: string;
      percentage: number;
      hasProgress: boolean;
    };

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

/**
 * Returns true when an event's `contentKey` either matches `expected`
 * exactly or is the wildcard sentinel (`'*'`). Use at every
 * key-scoped listener that needs to react to broadcast clears.
 */
export function matchesContentKey(detail: { contentKey: string }, expected: string): boolean {
  return detail.contentKey === expected || detail.contentKey === PROGRESS_CONTENT_KEY_WILDCARD;
}
