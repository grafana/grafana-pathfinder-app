/**
 * Tests for the completion-recorder boundary.
 *
 * Pins:
 *   - the emitter seam delivers each recorded completion to subscribers
 *   - exactly-once emission per (kind, guideSource, guideId) — the double-fire
 *     guard from research brief §4
 *   - guide and journey keys are independent; distinct guides emit separately
 *   - a throwing subscriber never breaks the completion path
 *   - with zero subscribers the recorder is a behavior-neutral no-op
 *   - the guard is durable across a reload (a fresh in-memory Set), and
 *     `invalidateEmittedCompletion`/`invalidateAllEmittedCompletions` are the
 *     only way to lift it — the reset-then-re-mark and duplicate-write fixes
 */
import {
  recordGuideCompletion,
  recordJourneyCompletion,
  onCompletionRecorded,
  invalidateEmittedCompletion,
  invalidateAllEmittedCompletions,
  __resetRecorderForTests,
} from './completion-recorder';
import type { CompletionFact, GuideCompletionFact, JourneyCompletionFact } from './types';

const persistedEmitted = new Map<string, true>();

jest.mock('../lib/user-storage', () => ({
  completionEmittedStorage: {
    isEmitted: (key: string) => persistedEmitted.has(key),
    markEmitted: async (key: string) => {
      persistedEmitted.set(key, true);
    },
    clear: async (key: string) => {
      persistedEmitted.delete(key);
    },
    clearAll: async () => {
      persistedEmitted.clear();
    },
  },
}));

function guideFact(overrides: Partial<GuideCompletionFact> = {}): GuideCompletionFact {
  return {
    kind: 'guide',
    guideSource: 'bundled',
    guideId: 'intro',
    guideTitle: 'Intro',
    guideCategory: 'interactive',
    completionPercent: 100,
    source: 'objectives',
    completedAt: '2026-07-20T00:00:00.000Z',
    ...overrides,
  };
}

function journeyFact(overrides: Partial<Omit<JourneyCompletionFact, 'kind'>> = {}): JourneyCompletionFact {
  return { ...guideFact(), ...overrides, kind: 'journey' };
}

beforeEach(() => {
  __resetRecorderForTests();
  persistedEmitted.clear();
});

describe('completion recorder — emitter seam', () => {
  it('delivers a recorded guide completion to a subscriber', () => {
    const seen: CompletionFact[] = [];
    onCompletionRecorded((fact) => seen.push(fact));

    recordGuideCompletion(guideFact());

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ kind: 'guide', guideSource: 'bundled', guideId: 'intro' });
  });

  it('delivers a recorded journey completion to a subscriber', () => {
    const seen: CompletionFact[] = [];
    onCompletionRecorded((fact) => seen.push(fact));

    recordJourneyCompletion(journeyFact({ guideId: 'linux-journey' }));

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ kind: 'journey', guideId: 'linux-journey' });
  });

  it('unsubscribe stops delivery', () => {
    const seen: CompletionFact[] = [];
    const unsubscribe = onCompletionRecorded((fact) => seen.push(fact));
    unsubscribe();

    recordGuideCompletion(guideFact());

    expect(seen).toHaveLength(0);
  });

  it('with zero subscribers is a no-op that does not throw', () => {
    expect(() => recordGuideCompletion(guideFact())).not.toThrow();
  });
});

describe('completion recorder — exactly-once (double-fire guard, brief §4)', () => {
  it('emits once per (kind, guideSource, guideId) even when recorded repeatedly', () => {
    const seen: CompletionFact[] = [];
    onCompletionRecorded((fact) => seen.push(fact));

    recordGuideCompletion(guideFact());
    recordGuideCompletion(guideFact());
    recordGuideCompletion(guideFact());

    expect(seen).toHaveLength(1);
  });

  it('distinct guide ids each emit once', () => {
    const seen: CompletionFact[] = [];
    onCompletionRecorded((fact) => seen.push(fact));

    recordGuideCompletion(guideFact({ guideId: 'a' }));
    recordGuideCompletion(guideFact({ guideId: 'b' }));

    expect(seen.map((f) => f.guideId)).toEqual(['a', 'b']);
  });

  it('same id but different source are distinct completions', () => {
    const seen: CompletionFact[] = [];
    onCompletionRecorded((fact) => seen.push(fact));

    recordGuideCompletion(guideFact({ guideSource: 'bundled', guideId: 'foo' }));
    recordGuideCompletion(guideFact({ guideSource: 'app-platform', guideId: 'foo' }));

    expect(seen).toHaveLength(2);
  });

  it('guide and journey with the same identity are separate emits', () => {
    const seen: CompletionFact[] = [];
    onCompletionRecorded((fact) => seen.push(fact));

    recordGuideCompletion(guideFact({ guideId: 'x' }));
    recordJourneyCompletion(journeyFact({ guideId: 'x' }));

    expect(seen.map((f) => f.kind)).toEqual(['guide', 'journey']);
  });

  it('journey threshold re-crossed emits journey_completed once', () => {
    const seen: CompletionFact[] = [];
    onCompletionRecorded((fact) => seen.push(fact));

    recordJourneyCompletion(journeyFact({ guideId: 'j' }));
    recordJourneyCompletion(journeyFact({ guideId: 'j' }));

    expect(seen.filter((f) => f.kind === 'journey')).toHaveLength(1);
  });
});

describe('completion recorder — durable guard survives a reload (duplicate-write defect)', () => {
  it('does not re-emit for the same identity after the in-memory Set resets, because the persisted guard remembers', () => {
    const seen: CompletionFact[] = [];
    onCompletionRecorded((fact) => seen.push(fact));

    recordGuideCompletion(guideFact({ guideId: 'marked-guide' }));
    expect(seen).toHaveLength(1);

    // Simulate a reload: the module's in-memory Set is empty again, but the
    // persisted guard (a mocked `completionEmittedStorage` here) is not — a
    // real reload does not clear localStorage either.
    __resetRecorderForTests();
    onCompletionRecorded((fact) => seen.push(fact));

    // Mirrors defect B: an already-marked guide's percentage short-circuits
    // to 100 on every later step write, re-dispatching the same 100%
    // completion signal into a fresh mount's automatic route.
    recordGuideCompletion(guideFact({ guideId: 'marked-guide' }));

    expect(seen).toHaveLength(1);
  });
});

describe('completion recorder — invalidateEmittedCompletion / invalidateAllEmittedCompletions (reset-then-re-mark defect)', () => {
  it('lifts the guard for the invalidated identity, letting a re-completion emit', () => {
    const seen: CompletionFact[] = [];
    onCompletionRecorded((fact) => seen.push(fact));

    recordGuideCompletion(guideFact({ guideSource: 'bundled', guideId: 'reset-me' }));
    expect(seen).toHaveLength(1);

    invalidateEmittedCompletion('bundled', 'reset-me');
    recordGuideCompletion(guideFact({ guideSource: 'bundled', guideId: 'reset-me' }));

    expect(seen).toHaveLength(2);
  });

  it('lifts the guard even across a reload, because it clears the persisted half too', () => {
    const seen: CompletionFact[] = [];
    onCompletionRecorded((fact) => seen.push(fact));

    recordGuideCompletion(guideFact({ guideSource: 'bundled', guideId: 'reset-me' }));
    __resetRecorderForTests();
    onCompletionRecorded((fact) => seen.push(fact));

    invalidateEmittedCompletion('bundled', 'reset-me');
    recordGuideCompletion(guideFact({ guideSource: 'bundled', guideId: 'reset-me' }));

    expect(seen).toHaveLength(2);
  });

  it('does not affect a different identity', () => {
    const seen: CompletionFact[] = [];
    onCompletionRecorded((fact) => seen.push(fact));

    recordGuideCompletion(guideFact({ guideSource: 'bundled', guideId: 'untouched' }));
    invalidateEmittedCompletion('bundled', 'reset-me');
    recordGuideCompletion(guideFact({ guideSource: 'bundled', guideId: 'untouched' }));

    expect(seen).toHaveLength(1);
  });

  it('also lifts the journey-kind guard for the same identity', () => {
    const seen: CompletionFact[] = [];
    onCompletionRecorded((fact) => seen.push(fact));

    recordJourneyCompletion(journeyFact({ guideSource: 'bundled', guideId: 'reset-me' }));
    invalidateEmittedCompletion('bundled', 'reset-me');
    recordJourneyCompletion(journeyFact({ guideSource: 'bundled', guideId: 'reset-me' }));

    expect(seen).toHaveLength(2);
  });

  it('invalidateAllEmittedCompletions lifts the guard for every identity', () => {
    const seen: CompletionFact[] = [];
    onCompletionRecorded((fact) => seen.push(fact));

    recordGuideCompletion(guideFact({ guideId: 'a' }));
    recordGuideCompletion(guideFact({ guideId: 'b' }));

    invalidateAllEmittedCompletions();

    recordGuideCompletion(guideFact({ guideId: 'a' }));
    recordGuideCompletion(guideFact({ guideId: 'b' }));

    expect(seen).toHaveLength(4);
  });
});

describe('completion recorder — resilience', () => {
  it('a throwing subscriber does not prevent other subscribers or the caller', () => {
    const seen: CompletionFact[] = [];
    onCompletionRecorded(() => {
      throw new Error('boom');
    });
    onCompletionRecorded((fact) => seen.push(fact));

    expect(() => recordGuideCompletion(guideFact())).not.toThrow();
    expect(seen).toHaveLength(1);
  });
});
