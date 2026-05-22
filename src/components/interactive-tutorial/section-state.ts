/**
 * Section persistence-state reducer for `InteractiveSection`.
 *
 * After C2 the reducer owns one bit of state: `acknowledged`. Step
 * completion lives in the canonical `completion-store`, and the
 * cursor + "completed?" derivations are pure functions of
 * `completed: ReadonlySet<string>` (from `useSectionCompletion`) plus
 * the section's step roster.
 *
 * The #842 ack-gate invariant is preserved:
 *   - `ACKNOWLEDGE` requires `completedCount > 0` (rejected otherwise).
 *   - `CLEAR_ACK` fires from every reset path (handleStepReset,
 *     handleResetSection) so re-completing always re-triggers the gate.
 *
 * The reducer no longer has access to `completed` directly; instead the
 * caller passes `completedCount` on `ACKNOWLEDGE`. This makes the
 * invariant explicit at the call site rather than implicit in the
 * reducer's parallel-state set.
 */

import type { StepInfo } from '../../types/component-props.types';
import type { AcknowledgementAnalysis } from './step-section-utils';

/**
 * Authoritative section state.
 *
 *   - `acknowledged`: two-state for the issue-#842 gate.
 *       - `null`  → user has never seen the gate (or no gate applies).
 *       - `true`  → user clicked "Mark section as complete".
 *     Modelled as `true | null` rather than `boolean | null` so the
 *     "unused state value" asymmetry the reducer was built to prevent
 *     cannot reappear by accident.
 */
export interface SectionState {
  acknowledged: true | null;
}

export type SectionStateKind = 'init' | 'partial' | 'awaiting-ack' | 'done';

export type DoneReason = 'ack' | 'no-gate-needed' | 'objectives';

export interface DerivedSectionState {
  kind: SectionStateKind;
  /** Populated only when `kind === 'done'`. */
  doneVia: DoneReason | null;
  /** Convenience: `kind === 'done'`. */
  isCompleted: boolean;
  /** Convenience: all non-noop interactive steps are in `completed`. */
  allInteractiveStepsCompleted: boolean;
}

export type SectionAction =
  /** Mount-time restore from persisted ack storage. */
  | { type: 'RESTORE'; acknowledged: true | null }
  /**
   * The user clicked "Mark section as complete". Caller passes the
   * current completion count from the store so the reducer can enforce
   * the #842 "no empty ack" invariant.
   */
  | { type: 'ACKNOWLEDGE'; completedCount: number }
  /**
   * Clear the acknowledgement bit. Fired by every reset path
   * (`handleStepReset`, `handleResetSection`) so re-completing the
   * section always re-triggers the gate.
   */
  | { type: 'CLEAR_ACK' };

export const initialSectionState: SectionState = Object.freeze({
  acknowledged: null,
});

/**
 * Pure reducer. No I/O, no React hooks, no DOM. Every transition either
 * returns the same object (when a no-op) or a fresh state — so React's
 * referential-equality short-circuit kicks in for skipped renders.
 */
export function sectionReducer(state: SectionState, action: SectionAction): SectionState {
  switch (action.type) {
    case 'RESTORE': {
      if (state.acknowledged === action.acknowledged) {
        return state;
      }
      return { acknowledged: action.acknowledged };
    }

    case 'ACKNOWLEDGE': {
      // #842 Bug 1: refuse to set ack when there is nothing completed.
      // Without this, a guide could land in a state where ack=true but
      // completed is empty — the gate would then read as "satisfied"
      // for a never-started section.
      if (action.completedCount === 0) {
        return state;
      }
      if (state.acknowledged === true) {
        return state;
      }
      return { acknowledged: true };
    }

    case 'CLEAR_ACK': {
      if (state.acknowledged === null) {
        return state;
      }
      return { acknowledged: null };
    }

    default: {
      // Exhaustive-check anchor — TypeScript flags any future action that
      // forgets to handle a case.
      const _never: never = action;
      void _never;
      return state;
    }
  }
}

/**
 * Compute the next-cursor position given an ordered step roster and a
 * set of completed ids. Returns the index of the first non-completed
 * step, or `stepIds.length` if every step is in the set.
 */
export function computeCursor(stepIds: readonly string[], completed: ReadonlySet<string>): number {
  for (let i = 0; i < stepIds.length; i++) {
    if (!completed.has(stepIds[i]!)) {
      return i;
    }
  }
  return stepIds.length;
}

/**
 * Derive the section's high-level state kind from the persistent ack
 * state + the current step roster + the gate analysis + objectives
 * status + completion data from the store.
 *
 * The reducer owns `acknowledged`; this function owns the rendering-
 * time read model. Splitting them keeps the reducer pure and lets the
 * derived view recompute whenever children or objectives change without
 * touching authoritative state.
 */
export function deriveSectionState(
  state: SectionState,
  stepComponents: StepInfo[],
  gate: AcknowledgementAnalysis,
  isCompletedByObjectives: boolean,
  completed: ReadonlySet<string>
): DerivedSectionState {
  if (isCompletedByObjectives) {
    return {
      kind: 'done',
      doneVia: 'objectives',
      isCompleted: true,
      allInteractiveStepsCompleted: true,
    };
  }

  if (stepComponents.length === 0 && !gate.isAllPassive) {
    return { kind: 'init', doneVia: null, isCompleted: false, allInteractiveStepsCompleted: false };
  }

  const nonNoop = stepComponents.filter((s) => s.targetAction !== 'noop');
  const allInteractiveStepsCompleted = nonNoop.length === 0 || nonNoop.every((s) => completed.has(s.stepId));

  if (gate.isAllPassive) {
    // The section has zero interactive steps. The only path to DONE
    // is through ACKNOWLEDGE. Until then, the section sits in
    // `awaiting-ack`.
    if (state.acknowledged === true) {
      return { kind: 'done', doneVia: 'ack', isCompleted: true, allInteractiveStepsCompleted: true };
    }
    return { kind: 'awaiting-ack', doneVia: null, isCompleted: false, allInteractiveStepsCompleted: true };
  }

  if (!allInteractiveStepsCompleted) {
    return {
      kind: completed.size > 0 ? 'partial' : 'init',
      doneVia: null,
      isCompleted: false,
      allInteractiveStepsCompleted: false,
    };
  }

  // All interactive steps are done. Gate decides the next state.
  if (gate.needsAcknowledgement && state.acknowledged !== true) {
    return { kind: 'awaiting-ack', doneVia: null, isCompleted: false, allInteractiveStepsCompleted: true };
  }

  return {
    kind: 'done',
    doneVia: state.acknowledged === true ? 'ack' : 'no-gate-needed',
    isCompleted: true,
    allInteractiveStepsCompleted: true,
  };
}

/**
 * Build the initial reducer state from persisted storage values, applying
 * the issue-#842 upgrade migration:
 *
 *   - If the user has previously completed every interactive step under
 *     pre-#842 rules AND the section requires acknowledgement under
 *     post-#842 rules AND there is no ack entry in storage (`null`), we
 *     auto-acknowledge — existing finished work should not spontaneously
 *     become incomplete after upgrade.
 *
 * Returns the migrated state plus a flag indicating whether the migration
 * fired (so the caller can write `ack = true` back to storage).
 */
export function restoreFromStorage(input: {
  completed: Set<string>;
  acknowledged: true | null;
  stepComponents: StepInfo[];
  gate: AcknowledgementAnalysis;
}): { state: SectionState; migrated: boolean } {
  const allIds = new Set(input.stepComponents.map((s) => s.stepId));
  const valid = new Set<string>();
  input.completed.forEach((id) => {
    if (allIds.has(id)) {
      valid.add(id);
    }
  });

  const nonNoop = input.stepComponents.filter((s) => s.targetAction !== 'noop');
  const allInteractiveStepsCompleted = nonNoop.length === 0 || nonNoop.every((s) => valid.has(s.stepId));

  let acknowledged = input.acknowledged;
  let migrated = false;
  if (acknowledged === null && input.gate.needsAcknowledgement && allInteractiveStepsCompleted && valid.size > 0) {
    acknowledged = true;
    migrated = true;
  }

  return {
    state: { acknowledged },
    migrated,
  };
}
