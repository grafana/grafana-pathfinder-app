/**
 * Completion percentage from an evidenced position, per the 2026-08-19 rule.
 *
 * Progress is the furthest block reached that we have clear evidence the user
 * completed. Evidence is exactly one of: the user clicked "Do it", or clicked
 * "Mark as complete" (on a section or on the whole guide). Anything softer —
 * scroll position, time on page — is deliberately not evidence.
 */

import type { GuideBlockIndex } from './block-index';

/** How a position came to be evidenced. */
export type CompletionEvidenceKind = 'do-it' | 'mark-section-complete' | 'mark-guide-complete';

/** One completion signal observed for a guide. */
export interface CompletionEvidence {
  kind: CompletionEvidenceKind;
  /**
   * Block id the signal came from: the interactive block for `do-it`, the
   * section container for `mark-section-complete`. Ignored for
   * `mark-guide-complete`, which always evidences the whole guide.
   */
  blockId?: string;
}

export interface GuideProgress {
  /** Furthest evidenced position; 0 when nothing is evidenced yet. */
  position: number;
  /** The denominator this position was measured against. */
  totalBlockCount: number;
  /** Completion as a 0..1 fraction. */
  fraction: number;
  /** Completion as an integer 0..100, for display and for the record's percentage field. */
  percent: number;
  complete: boolean;
}

/**
 * Completion for a guide whose furthest evidenced position is `position`.
 *
 * The base formula is `position / totalBlockCount`. The one special case: when
 * the guide's final interactive block is evidenced, completion is 100% even if
 * non-interactive blocks follow it. Without that, a guide ending in "Well
 * done!" markdown could never reach 100% from its final "Do it" — and per the
 * same decision such a guide carries no "Mark as complete" button either,
 * because its final operative step *is* interactive.
 */
export function guideProgressAtPosition(index: GuideBlockIndex, position: number): GuideProgress {
  const total = index.totalBlockCount;
  const clamped = Math.max(0, Math.min(Math.floor(position), total));

  const reachedEnd = total > 0 && clamped >= total;
  const reachedFinalInteractive = index.finalInteractivePosition > 0 && clamped >= index.finalInteractivePosition;
  const complete = reachedEnd || reachedFinalInteractive;

  const fraction = total === 0 ? 0 : complete ? 1 : clamped / total;

  return { position: clamped, totalBlockCount: total, fraction, percent: Math.round(fraction * 100), complete };
}

/**
 * Furthest position evidenced by a set of completion signals.
 *
 * Completion is monotonic, so this is a max: order of arrival does not matter
 * and a later signal never lowers progress. Signals naming a block that is not
 * in the index (deleted, or inside a conditional branch the traversal does not
 * enter) evidence nothing.
 */
export function furthestEvidencedPosition(index: GuideBlockIndex, evidence: readonly CompletionEvidence[]): number {
  let furthest = 0;

  for (const signal of evidence) {
    const position = evidencedPosition(index, signal);
    if (position > furthest) {
      furthest = position;
    }
  }

  return furthest;
}

/** Completion for a guide given every signal observed for it. */
export function guideProgress(index: GuideBlockIndex, evidence: readonly CompletionEvidence[]): GuideProgress {
  return guideProgressAtPosition(index, furthestEvidencedPosition(index, evidence));
}

function evidencedPosition(index: GuideBlockIndex, signal: CompletionEvidence): number {
  if (signal.kind === 'mark-guide-complete') {
    return index.totalBlockCount;
  }
  if (signal.blockId === undefined) {
    return 0;
  }
  if (signal.kind === 'mark-section-complete') {
    return index.containerEndPositions.get(signal.blockId) ?? 0;
  }
  return index.positionsById.get(signal.blockId) ?? 0;
}
