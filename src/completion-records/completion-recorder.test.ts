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
 */
import {
  recordGuideCompletion,
  recordJourneyCompletion,
  onCompletionRecorded,
  __resetRecorderForTests,
} from './completion-recorder';
import type { CompletionFact } from './types';

function guideFact(overrides: Partial<CompletionFact> = {}): CompletionFact {
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

beforeEach(() => {
  __resetRecorderForTests();
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

    recordJourneyCompletion(guideFact({ kind: 'journey', guideId: 'linux-journey' }));

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
    recordJourneyCompletion(guideFact({ kind: 'journey', guideId: 'x' }));

    expect(seen.map((f) => f.kind)).toEqual(['guide', 'journey']);
  });

  it('journey threshold re-crossed emits journey_completed once', () => {
    const seen: CompletionFact[] = [];
    onCompletionRecorded((fact) => seen.push(fact));

    recordJourneyCompletion(guideFact({ kind: 'journey', guideId: 'j' }));
    recordJourneyCompletion(guideFact({ kind: 'journey', guideId: 'j' }));

    expect(seen.filter((f) => f.kind === 'journey')).toHaveLength(1);
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
