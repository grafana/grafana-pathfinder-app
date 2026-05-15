/**
 * Section persistence-state reducer for `InteractiveSection`.
 *
 * Owns the completion-and-acknowledgement state machine — and only that.
 * Orthogonal UI concerns (`isRunning`, `isCollapsed`, requirement-check
 * status, scroll tracking, etc.) live as separate `useState` slots inside
 * the section component; they don't change what "completed" means.
 *
 * The reducer's purpose, per the #842 refactor:
 *   - Make Bug 1 (Redo bypasses the acknowledgement gate) structurally
 *     impossible. Every transition that clears `completed` also clears
 *     `acknowledged`; every transition that sets `acknowledged` requires
 *     `completed` to already be populated. There is no representable
 *     state where `completed.size === 0` and `acknowledged === true`.
 *   - Centralise the side-effect ordering. The component runs a single
 *     `useEffect` keyed off the reducer state to push changes into
 *     `interactiveStepStorage` and `sectionAcknowledgementStorage`,
 *     instead of every handler poking storage independently.
 *
 * The gate itself is wired up in phase 5 of the refactor. Phase 4 ships
 * the reducer with `gateNeedsAcknowledgement` always passed as `false`,
 * which keeps externally observable behaviour identical to pre-refactor.
 */

import type { StepInfo } from '../../types/component-props.types';
import type { AcknowledgementAnalysis } from './step-section-utils';

/**
 * Authoritative section state.
 *
 *   - `completed`: the set of step ids the user (or objectives auto-
 *     completion) has finished. May contain ids for noop steps; the
 *     derived `kind` calculation filters them.
 *   - `cursor`: the index of the next non-completed step. Used by
 *     `getResumeInfo` to drive the "Resume" button label.
 *   - `acknowledged`: two-state for the issue-#842 gate.
 *       - `null`  → user has never seen the gate (or no gate applies).
 *       - `true`  → user clicked "Mark section as complete".
 *     Modelled as `true | null` rather than `boolean | null` so the
 *     "unused state value" asymmetry the reducer was built to prevent
 *     cannot reappear by accident.
 */
export interface SectionState {
  completed: Set<string>;
  cursor: number;
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
  /** Mount-time restore from persisted storage. */
  | {
      type: 'RESTORE';
      completed: Set<string>;
      acknowledged: true | null;
      allStepIds: string[];
    }
  /** A single step reports completion. */
  | {
      type: 'COMPLETE_STEP';
      stepId: string;
      cursorAdvancedTo: number;
    }
  /** Objectives-based auto-completion — marks every step complete in one shot. */
  | {
      type: 'COMPLETE_ALL_STEPS';
      stepIds: string[];
    }
  /** A single step's Redo button — removes the step and all tail steps. */
  | {
      type: 'RESET_STEP';
      stepId: string;
      tailStepIds: string[];
      resetIndex: number;
    }
  /** The user clicked "Mark section as complete". */
  | { type: 'ACKNOWLEDGE' }
  /** The user clicked the per-section "Reset section" button. */
  | { type: 'RESET_SECTION' };

export const initialSectionState: SectionState = Object.freeze({
  completed: new Set<string>(),
  cursor: 0,
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
      // Filter restored ids against the current step roster so stale
      // entries (e.g. from a guide whose step ids have changed) don't
      // linger. The migration policy lives in `restoreFromStorage`
      // — by the time this action reaches the reducer, `acknowledged`
      // already reflects the auto-ack decision.
      const valid = new Set<string>();
      const allIds = new Set(action.allStepIds);
      action.completed.forEach((id) => {
        if (allIds.has(id)) {
          valid.add(id);
        }
      });
      const cursor = nextCursor(action.allStepIds, valid);
      return { completed: valid, cursor, acknowledged: action.acknowledged };
    }

    case 'COMPLETE_STEP': {
      if (state.completed.has(action.stepId)) {
        return state;
      }
      const completed = new Set(state.completed);
      completed.add(action.stepId);
      return { ...state, completed, cursor: action.cursorAdvancedTo };
    }

    case 'COMPLETE_ALL_STEPS': {
      const allIds = new Set(action.stepIds);
      if (allIds.size === state.completed.size && action.stepIds.every((id) => state.completed.has(id))) {
        return state;
      }
      return { ...state, completed: allIds, cursor: action.stepIds.length };
    }

    case 'RESET_STEP': {
      const completed = new Set(state.completed);
      action.tailStepIds.forEach((id) => completed.delete(id));
      const cursor = Math.min(state.cursor, action.resetIndex);
      // Bug 1 fix (structural): clearing any completed step also clears
      // acknowledgement. Re-completing must therefore re-trigger the gate.
      return { completed, cursor, acknowledged: null };
    }

    case 'ACKNOWLEDGE': {
      // Only meaningful when the section has at least one completion;
      // an empty section ack would set up Bug 1's invariant violation.
      if (state.completed.size === 0) {
        return state;
      }
      if (state.acknowledged === true) {
        return state;
      }
      return { ...state, acknowledged: true };
    }

    case 'RESET_SECTION': {
      if (state.completed.size === 0 && state.acknowledged === null && state.cursor === 0) {
        return state;
      }
      return { completed: new Set<string>(), cursor: 0, acknowledged: null };
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
function nextCursor(stepIds: string[], completed: Set<string>): number {
  for (let i = 0; i < stepIds.length; i++) {
    if (!completed.has(stepIds[i]!)) {
      return i;
    }
  }
  return stepIds.length;
}

/**
 * Derive the section's high-level state kind from the persistent state
 * + the current step roster + the gate analysis + objectives status.
 *
 * The reducer owns persistent state; this function owns the rendering-
 * time read model. Splitting them keeps the reducer pure and lets the
 * derived view recompute whenever children or objectives change without
 * touching authoritative state.
 *
 * Behaviour during phase 4 (gate not enabled): callers pass
 * `gate = { needsAcknowledgement: false, isAllPassive: false }` so the
 * `awaiting-ack` branch is unreachable. Phase 5 wires up the real
 * analysis and the gate begins to fire.
 */
export function deriveSectionState(
  state: SectionState,
  stepComponents: StepInfo[],
  gate: AcknowledgementAnalysis,
  isCompletedByObjectives: boolean
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
  const allInteractiveStepsCompleted = nonNoop.length === 0 || nonNoop.every((s) => state.completed.has(s.stepId));

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
      kind: state.completed.size > 0 ? 'partial' : 'init',
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
  const allStepIds = input.stepComponents.map((s) => s.stepId);
  const valid = new Set<string>();
  const allIds = new Set(allStepIds);
  const legacyIdMap = new Map<string, string>();
  input.stepComponents.forEach((step) => {
    if (step.legacyStepId && step.legacyStepId !== step.stepId) {
      legacyIdMap.set(step.legacyStepId, step.stepId);
    }
  });
  input.completed.forEach((id) => {
    if (allIds.has(id)) {
      valid.add(id);
      return;
    }
    const migratedId = legacyIdMap.get(id);
    if (migratedId) {
      valid.add(migratedId);
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
    state: {
      completed: valid,
      cursor: nextCursor(allStepIds, valid),
      acknowledged,
    },
    migrated,
  };
}
