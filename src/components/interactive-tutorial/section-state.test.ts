/**
 * PERMANENT — section-state reducer + derivation unit tests.
 *
 * After C2 the reducer owns one bit (`acknowledged`); step completion
 * lives in the canonical completion store. These tests pin the
 * post-collapse invariants:
 *
 *   - `ACKNOWLEDGE` requires `completedCount > 0` (#842 Bug 1).
 *   - `CLEAR_ACK` always flips ack back to null — the section's reset
 *     paths rely on this to keep the gate re-firing after a redo.
 *   - `deriveSectionState` is a pure function of (acknowledged, gate,
 *     completed set, objectives state, step roster).
 *   - The migration helper auto-acks pre-#842 completed sections exactly
 *     when the gate would otherwise reset them to "incomplete".
 */

import {
  computeCursor,
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

function makeState(over: { acknowledged?: true | null } = {}): SectionState {
  return {
    acknowledged: over.acknowledged ?? null,
  };
}

// ─── sectionReducer ─────────────────────────────────────────────────────────

describe('sectionReducer — RESTORE', () => {
  it('writes through the restored acknowledged value', () => {
    const next = sectionReducer(initialSectionState, { type: 'RESTORE', acknowledged: true });
    expect(next.acknowledged).toBe(true);
  });

  it('is a no-op when restored ack matches current state (referential equality)', () => {
    const prev = makeState({ acknowledged: null });
    const next = sectionReducer(prev, { type: 'RESTORE', acknowledged: null });
    expect(next).toBe(prev);
  });
});

describe('sectionReducer — ACKNOWLEDGE', () => {
  it('flips acknowledged to true when at least one step is completed', () => {
    const next = sectionReducer(initialSectionState, { type: 'ACKNOWLEDGE', completedCount: 1 });
    expect(next.acknowledged).toBe(true);
  });

  it('is a no-op when completedCount is 0 (#842 Bug 1 invariant)', () => {
    const prev = makeState({ acknowledged: null });
    const next = sectionReducer(prev, { type: 'ACKNOWLEDGE', completedCount: 0 });
    expect(next).toBe(prev);
    expect(next.acknowledged).toBeNull();
  });

  it('is a no-op when already acknowledged', () => {
    const prev = makeState({ acknowledged: true });
    expect(sectionReducer(prev, { type: 'ACKNOWLEDGE', completedCount: 3 })).toBe(prev);
  });
});

describe('sectionReducer — CLEAR_ACK', () => {
  it('flips acknowledged back to null', () => {
    const next = sectionReducer(makeState({ acknowledged: true }), { type: 'CLEAR_ACK' });
    expect(next.acknowledged).toBeNull();
  });

  it('is a no-op when ack is already null (referential equality)', () => {
    const prev = makeState({ acknowledged: null });
    expect(sectionReducer(prev, { type: 'CLEAR_ACK' })).toBe(prev);
  });
});

// ─── computeCursor ──────────────────────────────────────────────────────────

describe('computeCursor', () => {
  it('returns 0 when nothing is completed', () => {
    expect(computeCursor(['a', 'b', 'c'], new Set())).toBe(0);
  });

  it('returns the index of the first non-completed step', () => {
    expect(computeCursor(['a', 'b', 'c'], new Set(['a']))).toBe(1);
    expect(computeCursor(['a', 'b', 'c'], new Set(['a', 'b']))).toBe(2);
  });

  it('returns stepIds.length when every step is completed', () => {
    expect(computeCursor(['a', 'b'], new Set(['a', 'b']))).toBe(2);
  });

  it('skips holes — a completed later step does not advance the cursor past an open earlier step', () => {
    expect(computeCursor(['a', 'b', 'c'], new Set(['c']))).toBe(0);
  });
});

// ─── deriveSectionState ─────────────────────────────────────────────────────

describe('deriveSectionState — no-gate sections', () => {
  const steps = [makeStep('a'), makeStep('b')];

  it('returns kind=init for empty completed', () => {
    const derived = deriveSectionState(initialSectionState, steps, NO_GATE, false, new Set());
    expect(derived.kind).toBe('init');
    expect(derived.isCompleted).toBe(false);
  });

  it('returns kind=partial when some but not all steps are done', () => {
    const derived = deriveSectionState(initialSectionState, steps, NO_GATE, false, new Set(['a']));
    expect(derived.kind).toBe('partial');
    expect(derived.allInteractiveStepsCompleted).toBe(false);
  });

  it('returns kind=done with doneVia="no-gate-needed" when all steps are done', () => {
    const derived = deriveSectionState(initialSectionState, steps, NO_GATE, false, new Set(['a', 'b']));
    expect(derived.kind).toBe('done');
    expect(derived.doneVia).toBe('no-gate-needed');
    expect(derived.isCompleted).toBe(true);
  });
});

describe('deriveSectionState — trailing-passive gate sections', () => {
  const steps = [makeStep('a'), makeStep('b')];

  it('returns kind=awaiting-ack when all interactives done but ack is null', () => {
    const derived = deriveSectionState(initialSectionState, steps, TRAILING_GATE, false, new Set(['a', 'b']));
    expect(derived.kind).toBe('awaiting-ack');
    expect(derived.isCompleted).toBe(false);
    expect(derived.allInteractiveStepsCompleted).toBe(true);
  });

  it('returns kind=done(ack) once acknowledged', () => {
    const derived = deriveSectionState(
      makeState({ acknowledged: true }),
      steps,
      TRAILING_GATE,
      false,
      new Set(['a', 'b'])
    );
    expect(derived.kind).toBe('done');
    expect(derived.doneVia).toBe('ack');
    expect(derived.isCompleted).toBe(true);
  });

  it('returns kind=partial mid-section regardless of the gate', () => {
    const derived = deriveSectionState(initialSectionState, steps, TRAILING_GATE, false, new Set(['a']));
    expect(derived.kind).toBe('partial');
  });
});

describe('deriveSectionState — all-passive sections', () => {
  it('sits in awaiting-ack on first mount with no interactive steps', () => {
    const derived = deriveSectionState(initialSectionState, [], ALL_PASSIVE_GATE, false, new Set());
    expect(derived.kind).toBe('awaiting-ack');
    expect(derived.allInteractiveStepsCompleted).toBe(true);
  });

  it('flips to done(ack) once acknowledged — even with an empty completed set', () => {
    // The section component dispatches ACKNOWLEDGE with completedCount: 1
    // for all-passive sections (a synthetic count, no marker step in the
    // store). The derivation only inspects acknowledged + the gate.
    const derived = deriveSectionState(makeState({ acknowledged: true }), [], ALL_PASSIVE_GATE, false, new Set());
    expect(derived.kind).toBe('done');
    expect(derived.doneVia).toBe('ack');
  });
});

describe('deriveSectionState — objectives win', () => {
  const steps = [makeStep('a'), makeStep('b')];

  it('returns kind=done(objectives) regardless of completed/ack state', () => {
    const derived = deriveSectionState(initialSectionState, steps, TRAILING_GATE, true, new Set());
    expect(derived.kind).toBe('done');
    expect(derived.doneVia).toBe('objectives');
    expect(derived.isCompleted).toBe(true);
  });
});

describe('deriveSectionState — noop steps', () => {
  it('treats a section of all-noop steps as completed (preserves existing precedent)', () => {
    const noopSection = [makeStep('a', 'noop'), makeStep('b', 'noop')];
    const derived = deriveSectionState(initialSectionState, noopSection, NO_GATE, false, new Set());
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
});
