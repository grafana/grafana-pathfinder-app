/**
 * Unified progress event channel.
 *
 * Replaces five legacy events:
 *   - `interactive-step-completed`
 *   - `section-completed`
 *   - `interactive-section-completed`
 *   - `interactive-progress-saved`
 *   - `pathfinder-step-progress` (document-wide aggregate)
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
      kind: 'guide';
      contentKey: string;
      percentage: number;
      hasProgress: boolean;
    }
  | {
      // Document-wide aggregate progress for the "X of Y steps" panel chip.
      // Emitted by `use-document-step-progress` on section mount, step
      // start/stop, and step completion. `documentStepIndex` is omitted
      // while no step is currently executing.
      kind: 'document';
      contentKey: string;
      sectionId: string;
      totalSteps: number;
      completedCount: number;
      documentStepIndex?: number;
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
