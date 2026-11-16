/**
 * Completion percentage from an evidenced position (docs/design/COMPLETION-MODEL.md).
 *
 * Progress is the furthest block reached that we have clear evidence the user
 * completed. A guide is complete once that reaches its final completable
 * block; a guide with none completes when its end has been seen on screen,
 * which arrives here as a guide-level mark.
 */

import type { GuideBlockIndex } from './block-index';

/** How a position came to be evidenced. */
export type CompletionEvidenceKind = 'do-it' | 'mark-section-complete' | 'mark-guide-complete';

/** One completion signal observed for a guide. */
export interface CompletionEvidence {
  kind: CompletionEvidenceKind;
  /**
   * Block id the signal came from: the interactive block for `do-it` — its
   * runtime step id, falling back to an author id — and the section
   * container's runtime id for `mark-section-complete`. Ignored for
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
 * `percent` is `position / totalBlockCount`, reserved: it reads 100 only when
 * `complete`, so trailing prose after the final completable block never shows
 * a partial figure for a finished guide.
 */
export function guideProgressAtPosition(index: GuideBlockIndex, position: number): GuideProgress {
  const total = index.totalBlockCount;
  // `Math.min`/`Math.max` pass NaN straight through, so the clamp has to reject
  // a non-finite position outright: `percent` feeds a durable record.
  const clamped = Number.isFinite(position) ? Math.max(0, Math.min(Math.floor(position), total)) : 0;

  const target = index.completableBlockCount > 0 ? index.finalCompletablePosition : total;
  const complete = total > 0 && clamped >= target;
  const fraction = total === 0 ? 0 : clamped / total;
  const percent = complete ? 100 : Math.min(99, Math.floor(fraction * 100));

  return { position: clamped, totalBlockCount: total, fraction, percent, complete };
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
  // Branch child positions are checked first to intercept step IDs from blocks
  // inside conditional branches, aliasing them to their parent conditional's
  // position. The runtime dispatches "Do it" under the parser's stepId; step
  // IDs for counted blocks are checked next, and only a handful of blocks in
  // the library carry an author id for `positionsById` to match on as a final
  // fallback.
  return (
    index.branchChildPositions.get(signal.blockId) ??
    index.positionsByStepId.get(signal.blockId) ??
    index.positionsById.get(signal.blockId) ??
    0
  );
}
