/**
 * PERMANENT — section-state reducer + derivation unit tests.
 *
 * The reducer is pure and reactor-free; these tests run without rendering
 * any React. They lock in the transition contract that the rest of the
 * #842 refactor depends on:
 *
 *   - Every transition that clears `completed` also clears `acknowledged`
 *     (Bug 1 fix is structural).
 *   - Every transition is referentially-equality friendly: identical
 *     inputs return the same object so React skips redundant renders.
 *   - The all-passive branch of `deriveSectionState` flips between
 *     `awaiting-ack` and `done(ack)` based purely on `acknowledged`.
 *   - The migration helper auto-acks pre-#842 completed sections exactly
 *     when the gate would otherwise reset them to "incomplete".
 */

import {
  deriveSectionState,
  initialSectionState,
  restoreFromStorage,
  sectionReducer,
  type SectionState,
} from './section-state';
import type { StepInfo } from '../../types/component-props.types';
import type { AcknowledgementAnalysis } from './step-section-utils';

const NO_GATE: AcknowledgementAnalysis = { needsAcknowledgement: false, isAllPassive: false };
const TRAILING_GATE: AcknowledgementAnalysis = { needsAcknowledgement: true, isAllPassive: false };
const ALL_PASSIVE_GATE: AcknowledgementAnalysis = { needsAcknowledgement: true, isAllPassive: true };

function makeStep(stepId: string, targetAction = 'click'): StepInfo {
  return {
    stepId,
    element: null as any,
    index: 0,
    targetAction,
    isMultiStep: false,
    isGuided: false,
  };
}

function makeState(over: { completed?: string[]; cursor?: number; acknowledged?: true | null } = {}): SectionState {
  return {
    completed: new Set(over.completed ?? []),
    cursor: over.cursor ?? 0,
    acknowledged: over.acknowledged ?? null,
  };
}

// ─── sectionReducer ─────────────────────────────────────────────────────────

describe('sectionReducer — RESTORE', () => {
  it('filters out step ids that are not in the current roster', () => {
    const next = sectionReducer(initialSectionState, {
      type: 'RESTORE',
      completed: new Set(['a', 'b', 'stale-id']),
      acknowledged: null,
      allStepIds: ['a', 'b', 'c'],
    });
    expect(Array.from(next.completed).sort()).toEqual(['a', 'b']);
    expect(next.cursor).toBe(2);
    expect(next.acknowledged).toBeNull();
  });

  it('sets cursor to allStepIds.length when every step is completed', () => {
    const next = sectionReducer(initialSectionState, {
      type: 'RESTORE',
      completed: new Set(['a', 'b']),
      acknowledged: true,
      allStepIds: ['a', 'b'],
    });
    expect(next.cursor).toBe(2);
    expect(next.acknowledged).toBe(true);
  });
});

describe('sectionReducer — COMPLETE_STEP', () => {
  it('adds the step id and advances the cursor', () => {
    const next = sectionReducer(makeState({ completed: ['a'], cursor: 1 }), {
      type: 'COMPLETE_STEP',
      stepId: 'b',
      cursorAdvancedTo: 2,
    });
    expect(Array.from(next.completed).sort()).toEqual(['a', 'b']);
    expect(next.cursor).toBe(2);
  });

  it('is a no-op when the step is already completed (referential equality)', () => {
    const prev = makeState({ completed: ['a'], cursor: 1 });
    const next = sectionReducer(prev, { type: 'COMPLETE_STEP', stepId: 'a', cursorAdvancedTo: 2 });
    expect(next).toBe(prev);
  });

  it('does NOT clear acknowledgement on completion', () => {
    const next = sectionReducer(makeState({ completed: ['a'], acknowledged: true, cursor: 1 }), {
      type: 'COMPLETE_STEP',
      stepId: 'b',
      cursorAdvancedTo: 2,
    });
    expect(next.acknowledged).toBe(true);
  });
});

describe('sectionReducer — COMPLETE_ALL_STEPS (objectives)', () => {
  it('marks every step complete and parks the cursor at the end', () => {
    const next = sectionReducer(initialSectionState, {
      type: 'COMPLETE_ALL_STEPS',
      stepIds: ['a', 'b', 'c'],
    });
    expect(Array.from(next.completed).sort()).toEqual(['a', 'b', 'c']);
    expect(next.cursor).toBe(3);
  });

  it('is a no-op when the input set matches the current completed set', () => {
    const prev = makeState({ completed: ['a', 'b'], cursor: 2 });
    const next = sectionReducer(prev, { type: 'COMPLETE_ALL_STEPS', stepIds: ['a', 'b'] });
    expect(next).toBe(prev);
  });
});

describe('sectionReducer — RESET_STEP (Redo)', () => {
  it('removes the step and every tail step from `completed`', () => {
    const next = sectionReducer(makeState({ completed: ['a', 'b', 'c'], cursor: 3 }), {
      type: 'RESET_STEP',
      stepId: 'b',
      tailStepIds: ['b', 'c'],
      resetIndex: 1,
    });
    expect(Array.from(next.completed).sort()).toEqual(['a']);
    expect(next.cursor).toBe(1);
  });

  it('clears acknowledgement — Bug 1 fix is structural', () => {
    const next = sectionReducer(makeState({ completed: ['a', 'b', 'c'], cursor: 3, acknowledged: true }), {
      type: 'RESET_STEP',
      stepId: 'b',
      tailStepIds: ['b', 'c'],
      resetIndex: 1,
    });
    expect(next.acknowledged).toBeNull();
  });

  it('keeps cursor stable when reset index is past the cursor', () => {
    // Edge: a redo on a never-completed tail step shouldn't pull the
    // cursor backwards past where the user has actually advanced.
    const next = sectionReducer(makeState({ completed: ['a'], cursor: 1 }), {
      type: 'RESET_STEP',
      stepId: 'c',
      tailStepIds: ['c'],
      resetIndex: 2,
    });
    expect(next.cursor).toBe(1);
  });
});

describe('sectionReducer — ACKNOWLEDGE', () => {
  it('flips acknowledged to true when at least one step is completed', () => {
    const next = sectionReducer(makeState({ completed: ['a'], cursor: 1 }), { type: 'ACKNOWLEDGE' });
    expect(next.acknowledged).toBe(true);
  });

  it('is a no-op when the section has no completed steps (invariant: ack requires progress)', () => {
    // The reducer refuses to set up a state where completed is empty
    // and acknowledged is true — Bug 1's class of invariant violation
    // can't be constructed.
    const prev = makeState({ completed: [], cursor: 0 });
    const next = sectionReducer(prev, { type: 'ACKNOWLEDGE' });
    expect(next).toBe(prev);
    expect(next.acknowledged).toBeNull();
  });

  it('is a no-op when already acknowledged', () => {
    const prev = makeState({ completed: ['a'], cursor: 1, acknowledged: true });
    expect(sectionReducer(prev, { type: 'ACKNOWLEDGE' })).toBe(prev);
  });
});

describe('sectionReducer — RESET_SECTION', () => {
  it('clears completed, cursor, and acknowledgement together', () => {
    const next = sectionReducer(makeState({ completed: ['a', 'b'], cursor: 2, acknowledged: true }), {
      type: 'RESET_SECTION',
    });
    expect(Array.from(next.completed)).toEqual([]);
    expect(next.cursor).toBe(0);
    expect(next.acknowledged).toBeNull();
  });

  it('is a no-op when state is already cleared (referential equality)', () => {
    const prev = initialSectionState;
    expect(sectionReducer(prev, { type: 'RESET_SECTION' })).toBe(prev);
  });
});

// ─── deriveSectionState ─────────────────────────────────────────────────────

describe('deriveSectionState — no-gate sections', () => {
  const steps = [makeStep('a'), makeStep('b')];

  it('returns kind=init for empty completed', () => {
    const derived = deriveSectionState(initialSectionState, steps, NO_GATE, false);
    expect(derived.kind).toBe('init');
    expect(derived.isCompleted).toBe(false);
  });

  it('returns kind=partial when some but not all steps are done', () => {
    const derived = deriveSectionState(makeState({ completed: ['a'], cursor: 1 }), steps, NO_GATE, false);
    expect(derived.kind).toBe('partial');
    expect(derived.allInteractiveStepsCompleted).toBe(false);
  });

  it('returns kind=done with doneVia="no-gate-needed" when all steps are done', () => {
    const derived = deriveSectionState(makeState({ completed: ['a', 'b'], cursor: 2 }), steps, NO_GATE, false);
    expect(derived.kind).toBe('done');
    expect(derived.doneVia).toBe('no-gate-needed');
    expect(derived.isCompleted).toBe(true);
  });
});

describe('deriveSectionState — trailing-passive gate sections', () => {
  const steps = [makeStep('a'), makeStep('b')];

  it('returns kind=awaiting-ack when all interactives done but ack is null', () => {
    const derived = deriveSectionState(makeState({ completed: ['a', 'b'], cursor: 2 }), steps, TRAILING_GATE, false);
    expect(derived.kind).toBe('awaiting-ack');
    expect(derived.isCompleted).toBe(false);
    expect(derived.allInteractiveStepsCompleted).toBe(true);
  });

  it('returns kind=done(ack) once acknowledged', () => {
    const derived = deriveSectionState(
      makeState({ completed: ['a', 'b'], cursor: 2, acknowledged: true }),
      steps,
      TRAILING_GATE,
      false
    );
    expect(derived.kind).toBe('done');
    expect(derived.doneVia).toBe('ack');
    expect(derived.isCompleted).toBe(true);
  });

  it('returns kind=partial mid-section regardless of the gate', () => {
    const derived = deriveSectionState(makeState({ completed: ['a'], cursor: 1 }), steps, TRAILING_GATE, false);
    expect(derived.kind).toBe('partial');
  });
});

describe('deriveSectionState — all-passive sections', () => {
  it('sits in awaiting-ack on first mount with no interactive steps', () => {
    const derived = deriveSectionState(initialSectionState, [], ALL_PASSIVE_GATE, false);
    expect(derived.kind).toBe('awaiting-ack');
    expect(derived.allInteractiveStepsCompleted).toBe(true);
  });

  it('flips to done(ack) once acknowledged', () => {
    // Note: the reducer's invariant says ACKNOWLEDGE is a no-op when
    // `completed.size === 0`, so for an all-passive section the
    // section component must dispatch COMPLETE_STEP for a synthetic
    // marker before ACKNOWLEDGE. The phase-5 wiring will do that.
    // Here we just verify the derivation surface.
    const derived = deriveSectionState(
      makeState({ acknowledged: true, completed: ['marker'] }),
      [],
      ALL_PASSIVE_GATE,
      false
    );
    expect(derived.kind).toBe('done');
    expect(derived.doneVia).toBe('ack');
  });
});

describe('deriveSectionState — objectives win', () => {
  const steps = [makeStep('a'), makeStep('b')];

  it('returns kind=done(objectives) regardless of completed/ack state', () => {
    const derived = deriveSectionState(initialSectionState, steps, TRAILING_GATE, true);
    expect(derived.kind).toBe('done');
    expect(derived.doneVia).toBe('objectives');
    expect(derived.isCompleted).toBe(true);
  });
});

describe('deriveSectionState — noop steps', () => {
  it('treats a section of all-noop steps as completed (preserves existing precedent)', () => {
    const noopSection = [makeStep('a', 'noop'), makeStep('b', 'noop')];
    const derived = deriveSectionState(initialSectionState, noopSection, NO_GATE, false);
    // Per `nonNoop.length === 0` short-circuit: a section composed of
    // only noop steps is considered "done by default" even with empty
    // completed set. Matches the existing `stepsCompleted` derivation
    // in interactive-section.tsx.
    expect(derived.kind).toBe('done');
    expect(derived.doneVia).toBe('no-gate-needed');
  });
});

// ─── restoreFromStorage ─────────────────────────────────────────────────────

describe('restoreFromStorage — migration', () => {
  const steps = [makeStep('a'), makeStep('b')];

  it('auto-acknowledges a completed pre-#842 section under a trailing-passive gate', () => {
    const result = restoreFromStorage({
      completed: new Set(['a', 'b']),
      acknowledged: null,
      stepComponents: steps,
      gate: TRAILING_GATE,
    });
    expect(result.state.acknowledged).toBe(true);
    expect(result.migrated).toBe(true);
  });

  it('does NOT auto-acknowledge an incomplete section', () => {
    const result = restoreFromStorage({
      completed: new Set(['a']),
      acknowledged: null,
      stepComponents: steps,
      gate: TRAILING_GATE,
    });
    expect(result.state.acknowledged).toBeNull();
    expect(result.migrated).toBe(false);
  });

  it('does NOT auto-acknowledge when the gate does not apply', () => {
    const result = restoreFromStorage({
      completed: new Set(['a', 'b']),
      acknowledged: null,
      stepComponents: steps,
      gate: NO_GATE,
    });
    expect(result.state.acknowledged).toBeNull();
    expect(result.migrated).toBe(false);
  });

  it('preserves an explicit prior acknowledgement', () => {
    const result = restoreFromStorage({
      completed: new Set(['a', 'b']),
      acknowledged: true,
      stepComponents: steps,
      gate: TRAILING_GATE,
    });
    expect(result.state.acknowledged).toBe(true);
    expect(result.migrated).toBe(false);
  });

  it('filters stale step ids from the restored completed set', () => {
    const result = restoreFromStorage({
      completed: new Set(['a', 'b', 'removed-step']),
      acknowledged: null,
      stepComponents: steps,
      gate: NO_GATE,
    });
    expect(Array.from(result.state.completed).sort()).toEqual(['a', 'b']);
  });
});
