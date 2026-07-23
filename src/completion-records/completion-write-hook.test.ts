/**
 * Unit tests for the Track 2 write hook: capability-gated arming, a provably
 * non-blocking completion path, bundled-journey window normalization (exactly one
 * record), terminal-drop / transient-retry, and the deployment-skew missing-route
 * matrix. The recorder is the REAL module; all client/timer/clock deps are
 * injected so the coalescing-window + drain state machine is driven
 * deterministically. The harness routes injected timers by delay: the 2000ms
 * coalescing window and the 0/backoff drain timers are tracked separately.
 */

// The hook imports the client module (for defaults); mock @grafana/runtime so
// that import loads. Injected deps mean the real client is never called.
jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({ fetch: jest.fn() }),
  config: { bootData: { settings: { buildInfo: { versionString: 'Grafana Cloud' } } } },
}));

import { recordGuideCompletion, recordJourneyCompletion, __resetRecorderForTests } from './completion-recorder';
import {
  armCompletionWriteHook,
  __resetCompletionWriteHookForTests,
  type WriteHookDeps,
} from './completion-write-hook';
import type { CompletionWriteBody, WriteOutcome } from './completion-write-client';
import type { GuideCompletionFact, JourneyCompletionFact } from './types';

const COALESCE_WINDOW_MS = 2000;
const WINDOW_HANDLE = 2 as unknown as ReturnType<typeof setTimeout>;
const DRAIN_HANDLE = 1 as unknown as ReturnType<typeof setTimeout>;

let windowCb: (() => void) | null = null;
let drainCb: (() => void) | null = null;
let clock = 0;
let sent: CompletionWriteBody[] = [];
let sendResults: WriteOutcome[] = [];
let sendIdx = 0;
let capabilityCalls = 0;

function guideFact(over: Partial<GuideCompletionFact> = {}): GuideCompletionFact {
  return {
    kind: 'guide',
    guideSource: 'bundled',
    guideId: 'g1',
    guideTitle: 'G1',
    guideCategory: 'interactive',
    completionPercent: 100,
    source: 'objectives',
    completedAt: '2026-07-20T00:00:00.000Z',
    ...over,
  };
}

function journeyFact(over: Partial<JourneyCompletionFact> = {}): JourneyCompletionFact {
  return {
    kind: 'journey',
    guideSource: 'bundled',
    guideId: 'linux-journey',
    guideTitle: 'Linux journey',
    guideCategory: 'learning-journey',
    completionPercent: 100,
    source: 'objectives',
    completedAt: '2026-07-20T00:00:00.000Z',
    ...over,
  };
}

function deps(over: Partial<WriteHookDeps> = {}): Partial<WriteHookDeps> {
  return {
    fetchCapability: async () => {
      capabilityCalls += 1;
      return true;
    },
    send: async (b) => {
      sent.push(b);
      const r = sendResults[Math.min(sendIdx, sendResults.length - 1)] ?? { kind: 'created' };
      sendIdx += 1;
      return r;
    },
    platform: () => 'cloud',
    now: () => clock,
    random: () => 0.5,
    setTimer: (fn, ms) => {
      if (ms === COALESCE_WINDOW_MS) {
        windowCb = fn;
        return WINDOW_HANDLE;
      }
      drainCb = fn;
      return DRAIN_HANDLE;
    },
    clearTimer: (handle) => {
      if (handle === WINDOW_HANDLE) {
        windowCb = null;
      } else {
        drainCb = null;
      }
    },
    ...over,
  };
}

async function flushMicro(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function runWindow(): void {
  const cb = windowCb;
  windowCb = null;
  cb?.();
}

async function runTimer(): Promise<void> {
  const cb = drainCb;
  drainCb = null;
  cb?.();
  await flushMicro();
  await flushMicro();
}

beforeEach(() => {
  __resetCompletionWriteHookForTests();
  __resetRecorderForTests();
  try {
    localStorage.clear();
  } catch {
    // no-op
  }
  windowCb = null;
  drainCb = null;
  clock = 0;
  sent = [];
  sendResults = [];
  sendIdx = 0;
  capabilityCalls = 0;
});

describe('arming is capability-gated', () => {
  it('does not arm when capability is unavailable — no subscriber, no writes', async () => {
    await armCompletionWriteHook(deps({ fetchCapability: async () => false }));
    recordGuideCompletion(guideFact());
    runWindow();
    await runTimer();
    expect(sent).toHaveLength(0);
  });

  it('arms when available and writes an enqueued completion', async () => {
    await armCompletionWriteHook(deps());
    await runTimer(); // initial (empty) persisted drain

    recordGuideCompletion(guideFact({ guideId: 'dash' }));
    runWindow();
    await runTimer();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ guideId: 'dash', platform: 'cloud' });
  });

  it('is idempotent: a second arm does not re-probe or double-subscribe', async () => {
    await armCompletionWriteHook(deps());
    await armCompletionWriteHook(deps());
    expect(capabilityCalls).toBe(1);
  });
});

describe('completion path is non-blocking', () => {
  it('recording returns synchronously without invoking the sender', async () => {
    await armCompletionWriteHook(deps());
    await runTimer();

    // Even if the send would reject, recording must not throw or await it.
    sendResults = [{ kind: 'transient' }];
    expect(() => recordGuideCompletion(guideFact({ guideId: 'x' }))).not.toThrow();
    // The send is deferred (coalescing window + drain timer), so nothing has
    // been sent yet.
    expect(sent).toHaveLength(0);
  });
});

describe('bundled-journey normalization (regression: exactly one record)', () => {
  it('collapses the interactive + learning-journey facts of one window to a single record', async () => {
    await armCompletionWriteHook(deps());
    await runTimer();

    // One completed bundled learning-journey drives both branches:
    // an interactive-category guide fact (journey base id) and a learning-journey
    // guide fact (milestone slug id) — distinct facts at the recorder.
    recordGuideCompletion(guideFact({ guideId: 'linux-journey', guideCategory: 'interactive' }));
    recordGuideCompletion(guideFact({ guideId: 'select-platform', guideCategory: 'learning-journey' }));
    runWindow(); // flush the coalescing window → normalize to one
    await runTimer();

    expect(sent).toHaveLength(1);
    // The learning-journey fact outranks the interactive duplicate.
    expect(sent[0]).toMatchObject({ guideId: 'select-platform', guideCategory: 'learning-journey' });
  });

  it('collapses the bundled-journey triplet emitted across SEPARATE async ticks to one journey record', async () => {
    await armCompletionWriteHook(deps());
    await runTimer();

    // The real emission order is NOT synchronous: onGuideComplete emits the
    // interactive fact synchronously, then calls markMilestoneDone un-awaited,
    // which emits the learning-journey fact and finally the journey fact only
    // after several awaits. Simulate that with microtask gaps between facts —
    // all still land inside the single fixed window opened by the first fact.
    recordGuideCompletion(guideFact({ guideId: 'linux-journey', guideCategory: 'interactive' }));
    await flushMicro();
    recordGuideCompletion(guideFact({ guideId: 'select-platform', guideCategory: 'learning-journey' }));
    await flushMicro();
    recordJourneyCompletion(journeyFact({ guideId: 'linux-journey' }));
    await flushMicro();

    runWindow(); // fixed window fires once, spanning all three ticks
    await runTimer();

    expect(sent).toHaveLength(1);
    // The whole-journey fact outranks both guide facts.
    expect(sent[0]).toMatchObject({ guideId: 'linux-journey', kind: 'journey' });
  });

  it('a standalone completion in its own window still produces one record', async () => {
    await armCompletionWriteHook(deps());
    await runTimer();

    recordGuideCompletion(guideFact({ guideId: 'solo' }));
    runWindow();
    await runTimer();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ guideId: 'solo' });
  });

  it('blanket-window tradeoff: distinct completions in one window coalesce; a later window records separately', async () => {
    await armCompletionWriteHook(deps());
    await runTimer();

    // Two DISTINCT completions inside the same fixed window collapse to ONE
    // record. This is the documented blanket-window tradeoff: the window is not
    // keyed to a journey (no reliable relation key rides on the fact), so it
    // relies on distinct completions being user-paced beyond COALESCE_WINDOW_MS.
    recordGuideCompletion(guideFact({ guideId: 'guide-a' }));
    recordGuideCompletion(guideFact({ guideId: 'guide-b' }));
    runWindow();
    await runTimer();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ guideId: 'guide-a' });

    // A completion emitted AFTER the window has flushed opens a fresh window and
    // is recorded separately — proving separate windows yield separate records.
    clock += COALESCE_WINDOW_MS + 1;
    recordGuideCompletion(guideFact({ guideId: 'guide-c' }));
    runWindow();
    await runTimer();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ guideId: 'guide-c' });
  });
});

describe('error handling', () => {
  it('drops a terminal write without retrying', async () => {
    sendResults = [{ kind: 'terminal' }];
    await armCompletionWriteHook(deps());
    await runTimer();

    recordGuideCompletion(guideFact({ guideId: 'bad' }));
    runWindow();
    await runTimer();
    expect(sent).toHaveLength(1);

    // No retry: advancing time and firing again sends nothing more.
    clock += 10 * 60 * 1000;
    await runTimer();
    expect(sent).toHaveLength(1);
  });

  it('retries a transient write until it lands', async () => {
    sendResults = [{ kind: 'transient' }, { kind: 'created' }];
    await armCompletionWriteHook(deps());
    await runTimer();

    recordGuideCompletion(guideFact({ guideId: 'flaky' }));
    runWindow();
    await runTimer(); // attempt 1 → transient, reschedules ~1000ms out
    expect(sent).toHaveLength(1);

    clock = 1000;
    await runTimer(); // attempt 2 → created
    expect(sent).toHaveLength(2);
  });
});

describe('concurrent drains (regression: no double-send)', () => {
  function fireTimer(): void {
    const cb = drainCb;
    drainCb = null;
    cb?.();
  }

  it('does not re-POST an in-flight item when a second drain fires mid-send', async () => {
    const releases: Array<(o: WriteOutcome) => void> = [];
    const sendCalls: CompletionWriteBody[] = [];
    const send = (b: CompletionWriteBody): Promise<WriteOutcome> => {
      sendCalls.push(b);
      // Hold the first send open so a second drain can start while it is in
      // flight; resolve later sends immediately.
      if (sendCalls.length === 1) {
        return new Promise<WriteOutcome>((resolve) => {
          releases.push(resolve);
        });
      }
      return Promise.resolve({ kind: 'created' });
    };

    await armCompletionWriteHook(deps({ send }));
    await runTimer(); // initial empty drain

    recordGuideCompletion(guideFact({ guideId: 'first' }));
    runWindow();

    // Fire the drain: processDue starts and suspends on the first send's await.
    fireTimer();
    await flushMicro();
    expect(sendCalls).toHaveLength(1);

    // A second completion arrives mid-send and schedules a fresh timer. Firing
    // it must NOT start a concurrent processDue that re-sends the in-flight item.
    recordGuideCompletion(guideFact({ guideId: 'second' }));
    runWindow();
    fireTimer();
    await flushMicro();
    expect(sendCalls).toHaveLength(1); // still only the first item

    // Release the first send; the reschedule then drains the second item once.
    releases[0]?.({ kind: 'created' });
    await flushMicro();
    await runTimer();

    const ids = sendCalls.map((b) => b.guideId).sort();
    expect(ids).toEqual(['first', 'second']);
  });
});

describe('deployment-skew: missing route matrix', () => {
  it('capability 404 (route family absent) never arms', async () => {
    // fetchCompletionCapability maps 404 → false; the hook sees `false`.
    await armCompletionWriteHook(deps({ fetchCapability: async () => false }));
    recordGuideCompletion(guideFact());
    runWindow();
    await runTimer();
    expect(sent).toHaveLength(0);
  });

  it('write 404 mid-session (skew) disarms silently with no retry storm', async () => {
    sendResults = [{ kind: 'route-missing' }];
    await armCompletionWriteHook(deps());
    await runTimer();

    recordGuideCompletion(guideFact({ guideId: 'a' }));
    runWindow();
    await runTimer(); // route-missing → disarm + teardown
    expect(sent).toHaveLength(1);

    // Subsequent completions do not enqueue or send, and there is no retry loop.
    recordGuideCompletion(guideFact({ guideId: 'b' }));
    runWindow();
    clock += 10 * 60 * 1000;
    await runTimer();
    expect(sent).toHaveLength(1);
  });
});
