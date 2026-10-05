/**
 * Tests for the completion-recorder boundary.
 *
 * Pins:
 *   - the emitter seam delivers each recorded completion to subscribers
 *   - exactly-once emission per (kind, guideSource, guideId) — the double-fire
 *     guard from research brief §4
 *   - guide and journey keys are independent; distinct guides emit separately
 *   - a throwing subscriber never breaks the completion path
 *   - early completions wait for the write subscriber
 *   - the guard is durable across a reload (a fresh in-memory Set) until a
 *     reset or a dropped queued write lifts it — the reset-then-re-mark and
 *     duplicate-write fixes
 *   - the Track 1 analytics event fires once per terminal completion on its
 *     own guard, ahead of the startup buffer and independent of durable acceptance
 */
import { logger } from '../lib/logging';
import { reportCompletionAnalytics } from './completion-analytics';
import {
  recordGuideCompletion,
  recordJourneyCompletion,
  onCompletionRecorded,
  invalidateEmittedCompletion,
  invalidateAllEmittedCompletions,
  discardPendingCompletions,
  liftDurableCompletionGuard,
  __resetRecorderForTests,
} from './completion-recorder';
import type { CompletionFact, CompletionListener, GuideCompletionFact, JourneyCompletionFact } from './types';

let mockOwner: string | null = 'user-1:org-1';
jest.mock('./completion-write-storage', () => ({ currentCompletionQueueOwnerKey: () => mockOwner }));

jest.mock('./completion-analytics', () => ({ reportCompletionAnalytics: jest.fn() }));

const reportAnalytics = jest.mocked(reportCompletionAnalytics);

const persistedEmitted = new Map<string, true>();
const persistedReported = new Map<string, true>();

jest.mock('../lib/user-storage', () => {
  const guardStorage = (store: () => Map<string, true>) => ({
    isEmitted: (key: string) => store().has(key),
    markEmitted: async (key: string) => {
      store().set(key, true);
    },
    clear: async (key: string) => {
      store().delete(key);
    },
    clearAll: async () => {
      store().clear();
    },
  });
  return {
    completionEmittedStorage: guardStorage(() => persistedEmitted),
    completionReportedStorage: guardStorage(() => persistedReported),
  };
});

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

/**
 * A subscriber that durably accepts, which is what the write queue reports
 * when its `storage.put` persisted. The recorder's guard is set on that
 * acceptance, so a collecting-only subscriber would not arm it.
 */
function acceptInto(sink: CompletionFact[]): CompletionListener {
  return (fact) => {
    sink.push(fact);
    return true;
  };
}

beforeEach(() => {
  mockOwner = 'user-1:org-1';
  __resetRecorderForTests();
  persistedEmitted.clear();
  persistedReported.clear();
  reportAnalytics.mockClear();
});

describe('completion recorder — emitter seam', () => {
  it('delivers a recorded guide completion to a subscriber', () => {
    const seen: CompletionFact[] = [];
    onCompletionRecorded(acceptInto(seen));

    recordGuideCompletion(guideFact());

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ kind: 'guide', guideSource: 'bundled', guideId: 'intro' });
  });

  it('delivers a recorded journey completion to a subscriber', () => {
    const seen: CompletionFact[] = [];
    onCompletionRecorded(acceptInto(seen));

    recordJourneyCompletion(journeyFact({ guideId: 'linux-journey' }));

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ kind: 'journey', guideId: 'linux-journey' });
  });

  // Migration read-both on the WRITE path. A package-path completion persisted by
  // 2.17.0 lives under the suffixed id; the normalized writer must still see it so
  // a reload-to-100% does not mint a duplicate durable record.
  it('does not re-emit when a legacy suffixed completion is already recorded', () => {
    persistedEmitted.set('guide:bundled:intro/content.json', true);
    const seen: CompletionFact[] = [];
    onCompletionRecorded(acceptInto(seen));

    recordGuideCompletion(guideFact({ guideId: 'intro' }));

    expect(seen).toHaveLength(0);
  });

  // ...but an explicit reset clears BOTH spellings, so a genuine re-completion
  // after reset still fires exactly once under the canonical id.
  it('re-emits after a reset lifts the legacy suffixed guard', () => {
    persistedEmitted.set('guide:bundled:intro/content.json', true);
    const seen: CompletionFact[] = [];
    onCompletionRecorded(acceptInto(seen));

    invalidateEmittedCompletion('bundled', 'intro');
    recordGuideCompletion(guideFact({ guideId: 'intro' }));

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ kind: 'guide', guideId: 'intro' });
  });

  it('unsubscribe stops delivery', () => {
    const seen: CompletionFact[] = [];
    const unsubscribe = onCompletionRecorded(acceptInto(seen));
    unsubscribe();

    recordGuideCompletion(guideFact());

    expect(seen).toHaveLength(0);
  });

  it('buffers with zero subscribers without throwing', () => {
    expect(() => recordGuideCompletion(guideFact())).not.toThrow();
  });
});

describe('completion recorder — exactly-once (double-fire guard, brief §4)', () => {
  it('emits once per (kind, guideSource, guideId) even when recorded repeatedly', () => {
    const seen: CompletionFact[] = [];
    onCompletionRecorded(acceptInto(seen));

    recordGuideCompletion(guideFact());
    recordGuideCompletion(guideFact());
    recordGuideCompletion(guideFact());

    expect(seen).toHaveLength(1);
  });

  it('distinct guide ids each emit once', () => {
    const seen: CompletionFact[] = [];
    onCompletionRecorded(acceptInto(seen));

    recordGuideCompletion(guideFact({ guideId: 'a' }));
    recordGuideCompletion(guideFact({ guideId: 'b' }));

    expect(seen.map((f) => f.guideId)).toEqual(['a', 'b']);
  });

  it('same id but different source are distinct completions', () => {
    const seen: CompletionFact[] = [];
    onCompletionRecorded(acceptInto(seen));

    recordGuideCompletion(guideFact({ guideSource: 'bundled', guideId: 'foo' }));
    recordGuideCompletion(guideFact({ guideSource: 'app-platform', guideId: 'foo' }));

    expect(seen).toHaveLength(2);
  });

  it('guide and journey with the same identity are separate emits', () => {
    const seen: CompletionFact[] = [];
    onCompletionRecorded(acceptInto(seen));

    recordGuideCompletion(guideFact({ guideId: 'x' }));
    recordJourneyCompletion(journeyFact({ guideId: 'x' }));

    expect(seen.map((f) => f.kind)).toEqual(['guide', 'journey']);
  });

  it('journey threshold re-crossed emits journey_completed once', () => {
    const seen: CompletionFact[] = [];
    onCompletionRecorded(acceptInto(seen));

    recordJourneyCompletion(journeyFact({ guideId: 'j' }));
    recordJourneyCompletion(journeyFact({ guideId: 'j' }));

    expect(seen.filter((f) => f.kind === 'journey')).toHaveLength(1);
  });
});

describe('completion recorder — durable guard survives a reload (duplicate-write defect)', () => {
  it('does not re-emit for the same identity after the in-memory Set resets, because the persisted guard remembers', () => {
    const seen: CompletionFact[] = [];
    onCompletionRecorded(acceptInto(seen));

    recordGuideCompletion(guideFact({ guideId: 'marked-guide' }));
    expect(seen).toHaveLength(1);

    // Simulate a reload: the module's in-memory Set is empty again, but the
    // persisted guard (a mocked `completionEmittedStorage` here) is not — a
    // real reload does not clear localStorage either.
    __resetRecorderForTests();
    onCompletionRecorded(acceptInto(seen));

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
    onCompletionRecorded(acceptInto(seen));

    recordGuideCompletion(guideFact({ guideSource: 'bundled', guideId: 'reset-me' }));
    expect(seen).toHaveLength(1);

    invalidateEmittedCompletion('bundled', 'reset-me');
    recordGuideCompletion(guideFact({ guideSource: 'bundled', guideId: 'reset-me' }));

    expect(seen).toHaveLength(2);
  });

  it('lifts the guard even across a reload, because it clears the persisted half too', () => {
    const seen: CompletionFact[] = [];
    onCompletionRecorded(acceptInto(seen));

    recordGuideCompletion(guideFact({ guideSource: 'bundled', guideId: 'reset-me' }));
    __resetRecorderForTests();
    onCompletionRecorded(acceptInto(seen));

    invalidateEmittedCompletion('bundled', 'reset-me');
    recordGuideCompletion(guideFact({ guideSource: 'bundled', guideId: 'reset-me' }));

    expect(seen).toHaveLength(2);
  });

  it('does not affect a different identity', () => {
    const seen: CompletionFact[] = [];
    onCompletionRecorded(acceptInto(seen));

    recordGuideCompletion(guideFact({ guideSource: 'bundled', guideId: 'untouched' }));
    invalidateEmittedCompletion('bundled', 'reset-me');
    recordGuideCompletion(guideFact({ guideSource: 'bundled', guideId: 'untouched' }));

    expect(seen).toHaveLength(1);
  });

  it('also lifts the journey-kind guard for the same identity', () => {
    const seen: CompletionFact[] = [];
    onCompletionRecorded(acceptInto(seen));

    recordJourneyCompletion(journeyFact({ guideSource: 'bundled', guideId: 'reset-me' }));
    invalidateEmittedCompletion('bundled', 'reset-me');
    recordJourneyCompletion(journeyFact({ guideSource: 'bundled', guideId: 'reset-me' }));

    expect(seen).toHaveLength(2);
  });

  it('invalidateAllEmittedCompletions lifts the guard for every identity', () => {
    const seen: CompletionFact[] = [];
    onCompletionRecorded(acceptInto(seen));

    recordGuideCompletion(guideFact({ guideId: 'a' }));
    recordGuideCompletion(guideFact({ guideId: 'b' }));

    invalidateAllEmittedCompletions();

    recordGuideCompletion(guideFact({ guideId: 'a' }));
    recordGuideCompletion(guideFact({ guideId: 'b' }));

    expect(seen).toHaveLength(4);
  });
});

describe('completion recorder — the guard is set only on durable acceptance', () => {
  it('leaves the identity recordable when no subscriber is armed at all', () => {
    // The write hook arms through a dynamic import, so a completion can be
    // recorded before any subscriber exists. Guarding it then would lose the
    // completion outright: nothing durable holds it and nobody tries again.
    recordGuideCompletion(guideFact({ guideId: 'unarmed' }));

    expect(persistedEmitted.has('guide:bundled:unarmed')).toBe(false);

    // A later session: fresh in-memory state, the subscriber now armed.
    __resetRecorderForTests();
    const seen: CompletionFact[] = [];
    onCompletionRecorded(acceptInto(seen));

    recordGuideCompletion(guideFact({ guideId: 'unarmed' }));

    expect(seen).toHaveLength(1);
    expect(persistedEmitted.has('guide:bundled:unarmed')).toBe(true);
  });

  it('leaves the identity recordable when the subscriber does not durably accept', () => {
    // What an anonymous session looks like: the hook is subscribed but has no
    // queue to persist into, so it reports no acceptance.
    const seen: CompletionFact[] = [];
    onCompletionRecorded((fact) => {
      seen.push(fact);
      return false;
    });

    recordGuideCompletion(guideFact({ guideId: 'unowned' }));
    recordGuideCompletion(guideFact({ guideId: 'unowned' }));

    expect(seen).toHaveLength(2);
    expect(persistedEmitted.has('guide:bundled:unowned')).toBe(false);
  });

  it('still emits exactly once for the same identity once someone accepted it', () => {
    const seen: CompletionFact[] = [];
    onCompletionRecorded(acceptInto(seen));

    recordGuideCompletion(guideFact({ guideId: 'accepted' }));
    recordGuideCompletion(guideFact({ guideId: 'accepted' }));

    expect(seen).toHaveLength(1);
    expect(persistedEmitted.has('guide:bundled:accepted')).toBe(true);
  });

  it('accepts when any subscriber accepts, even alongside one that does not', () => {
    const accepted: CompletionFact[] = [];
    onCompletionRecorded(() => false);
    onCompletionRecorded(acceptInto(accepted));

    recordGuideCompletion(guideFact({ guideId: 'mixed' }));
    recordGuideCompletion(guideFact({ guideId: 'mixed' }));

    expect(accepted).toHaveLength(1);
    expect(persistedEmitted.has('guide:bundled:mixed')).toBe(true);
  });
});

describe('completion recorder — resilience', () => {
  it('a throwing subscriber does not prevent other subscribers or the caller', () => {
    const seen: CompletionFact[] = [];
    onCompletionRecorded(() => {
      throw new Error('boom');
    });
    onCompletionRecorded(acceptInto(seen));

    expect(() => recordGuideCompletion(guideFact())).not.toThrow();
    expect(seen).toHaveLength(1);
  });
});

describe('completion recorder startup recovery', () => {
  it('keeps the first 100 startup facts and warns when dropping the newest', () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      const facts = Array.from({ length: 101 }, (_, index) => guideFact({ guideId: `guide-${index}` }));
      facts.forEach(recordGuideCompletion);
      const seen: CompletionFact[] = [];
      onCompletionRecorded(acceptInto(seen));
      expect(seen).toEqual(facts.slice(0, 100));
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith('completion write: startup buffer is full');
    } finally {
      warn.mockRestore();
    }
  });

  it('drops a rejected replay without marking it emitted and allows a later completion to retry', () => {
    const fact = guideFact();
    recordGuideCompletion(fact);
    const reject = jest.fn(() => false);
    const unsubscribe = onCompletionRecorded(reject);
    expect(reject).toHaveBeenCalledWith(fact);
    expect(persistedEmitted.size).toBe(0);
    unsubscribe();
    const seen: CompletionFact[] = [];
    onCompletionRecorded(acceptInto(seen));
    expect(seen).toEqual([]);
    recordGuideCompletion(fact);
    expect(seen).toEqual([fact]);
    expect(persistedEmitted.size).toBe(1);
  });

  it('invalidates both pending completion kinds through a legacy guide id without clearing other guides', () => {
    recordGuideCompletion(guideFact());
    recordJourneyCompletion(journeyFact());
    const other = guideFact({ guideId: 'other' });
    recordGuideCompletion(other);
    invalidateEmittedCompletion('bundled', 'intro/content.json');
    const seen: CompletionFact[] = [];
    onCompletionRecorded(acceptInto(seen));
    expect(seen).toEqual([other]);
  });

  it('replays early completions once when the write hook becomes available', () => {
    const fact = guideFact();
    recordGuideCompletion(fact);
    recordGuideCompletion(fact);
    expect(persistedEmitted.size).toBe(0);
    const seen: CompletionFact[] = [];
    onCompletionRecorded(acceptInto(seen));
    recordGuideCompletion(fact);
    expect(seen).toEqual([fact]);
    expect(persistedEmitted.size).toBe(1);
  });

  it.each(['guide', 'all'])('does not replay a completion reset before startup recovers (%s)', (scope) => {
    recordGuideCompletion(guideFact());
    if (scope === 'guide') {
      invalidateEmittedCompletion('bundled', 'intro');
    } else {
      invalidateAllEmittedCompletions();
    }
    const seen: CompletionFact[] = [];
    onCompletionRecorded(acceptInto(seen));
    expect(seen).toEqual([]);
  });

  it('does not replay completions from another user or organization', () => {
    recordGuideCompletion(guideFact());
    mockOwner = 'user-1:org-2';
    const seen: CompletionFact[] = [];
    onCompletionRecorded(acceptInto(seen));
    expect(seen).toEqual([]);
  });

  it('does not replay anonymous completions after sign in', () => {
    mockOwner = null;
    recordGuideCompletion(guideFact());
    mockOwner = 'user-1:org-1';
    const seen: CompletionFact[] = [];
    onCompletionRecorded(acceptInto(seen));
    expect(seen).toEqual([]);
  });
});

describe('completion recorder — Track 1 analytics event', () => {
  it('reports once per terminal completion alongside the durable write', () => {
    const seen: CompletionFact[] = [];
    onCompletionRecorded(acceptInto(seen));

    recordGuideCompletion(guideFact({ guideId: 'track1' }));
    recordGuideCompletion(guideFact({ guideId: 'track1' }));

    expect(seen).toHaveLength(1);
    expect(reportAnalytics).toHaveBeenCalledTimes(1);
    expect(reportAnalytics).toHaveBeenCalledWith(expect.objectContaining({ kind: 'guide', guideId: 'track1' }));
  });

  it('reports once when nothing durably accepts, even across a reload', () => {
    onCompletionRecorded(() => false);

    recordGuideCompletion(guideFact({ guideId: 'unowned' }));
    recordGuideCompletion(guideFact({ guideId: 'unowned' }));
    __resetRecorderForTests();
    recordGuideCompletion(guideFact({ guideId: 'unowned' }));

    expect(reportAnalytics).toHaveBeenCalledTimes(1);
    expect(persistedEmitted.has('guide:bundled:unowned')).toBe(false);
  });

  it('reports before the write hook arms, and the replay does not report again', () => {
    recordGuideCompletion(guideFact({ guideId: 'late-arm' }));
    expect(reportAnalytics).toHaveBeenCalledTimes(1);

    const seen: CompletionFact[] = [];
    onCompletionRecorded(acceptInto(seen));
    recordGuideCompletion(guideFact({ guideId: 'late-arm' }));

    expect(seen).toHaveLength(1);
    expect(persistedEmitted.has('guide:bundled:late-arm')).toBe(true);
    expect(reportAnalytics).toHaveBeenCalledTimes(1);
  });

  it('reports a completion the full startup buffer drops', () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      for (let index = 0; index <= 100; index++) {
        recordGuideCompletion(guideFact({ guideId: `guide-${index}` }));
      }

      expect(warn).toHaveBeenCalledWith('completion write: startup buffer is full');
      expect(reportAnalytics).toHaveBeenCalledTimes(101);
      expect(reportAnalytics).toHaveBeenLastCalledWith(expect.objectContaining({ guideId: 'guide-100' }));
    } finally {
      warn.mockRestore();
    }
  });

  it('does not report again after the startup buffer is discarded', () => {
    recordGuideCompletion(guideFact({ guideId: 'discarded' }));
    discardPendingCompletions();
    recordGuideCompletion(guideFact({ guideId: 'discarded' }));

    expect(reportAnalytics).toHaveBeenCalledTimes(1);
  });

  it.each(['guide', 'all'])('reports a buffered completion again after a reset (%s)', (scope) => {
    recordGuideCompletion(guideFact({ guideId: 'buffered' }));
    if (scope === 'guide') {
      invalidateEmittedCompletion('bundled', 'buffered');
    } else {
      invalidateAllEmittedCompletions();
    }
    recordGuideCompletion(guideFact({ guideId: 'buffered' }));
    const seen: CompletionFact[] = [];
    onCompletionRecorded(acceptInto(seen));

    expect(seen).toHaveLength(1);
    expect(reportAnalytics).toHaveBeenCalledTimes(2);
  });

  it('does not report an identity durably recorded before the event existed', () => {
    persistedEmitted.set('guide:bundled:recorded-before-upgrade', true);

    recordGuideCompletion(guideFact({ guideId: 'recorded-before-upgrade' }));

    expect(reportAnalytics).not.toHaveBeenCalled();
  });

  it('reports again after each kind of reset', () => {
    onCompletionRecorded(acceptInto([]));

    recordGuideCompletion(guideFact({ guideId: 'again' }));
    invalidateEmittedCompletion('bundled', 'again');
    recordGuideCompletion(guideFact({ guideId: 'again' }));
    invalidateAllEmittedCompletions();
    recordGuideCompletion(guideFact({ guideId: 'again' }));

    expect(reportAnalytics).toHaveBeenCalledTimes(3);
  });

  it('does not report again when a dropped durable write lifts only the durable guard', () => {
    const seen: CompletionFact[] = [];
    onCompletionRecorded(acceptInto(seen));

    recordGuideCompletion(guideFact({ guideId: 'dropped' }));
    liftDurableCompletionGuard('bundled', 'dropped');
    recordGuideCompletion(guideFact({ guideId: 'dropped' }));

    expect(seen).toHaveLength(2);
    expect(reportAnalytics).toHaveBeenCalledTimes(1);
  });

  it('reports a guide and a journey with the same identity separately', () => {
    recordGuideCompletion(guideFact({ guideId: 'x' }));
    recordJourneyCompletion(journeyFact({ guideId: 'x' }));

    expect(reportAnalytics.mock.calls.map(([fact]) => fact.kind)).toEqual(['guide', 'journey']);
  });
});
