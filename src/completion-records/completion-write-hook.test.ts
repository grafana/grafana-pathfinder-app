/**
 * Unit tests for the Track 2 write hook: capability-gated arming, a provably
 * non-blocking completion path, direct-enqueue with durable-key dedupe, the
 * concurrent-drain guard, terminal-drop / transient-retry, and the
 * deployment-skew missing-route matrix. The recorder is the REAL module; all
 * client/timer/clock deps are injected so the drain state machine is driven
 * deterministically.
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
    setTimer: (fn) => {
      drainCb = fn;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => {
      drainCb = null;
    },
    ...over,
  };
}

async function flushMicro(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
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
    await runTimer();
    expect(sent).toHaveLength(0);
  });

  it('arms when available and writes an enqueued completion', async () => {
    await armCompletionWriteHook(deps());
    await runTimer(); // initial (empty) persisted drain

    recordGuideCompletion(guideFact({ guideId: 'dash' }));
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
    // The send is deferred to the drain timer, so nothing has been sent yet.
    expect(sent).toHaveLength(0);
  });
});

describe('direct enqueue with durable-key dedupe', () => {
  it('enqueues each distinct completion as its own record', async () => {
    await armCompletionWriteHook(deps());
    await runTimer();

    recordGuideCompletion(guideFact({ guideId: 'guide-a' }));
    recordGuideCompletion(guideFact({ guideId: 'guide-b' }));
    await runTimer();

    expect(sent.map((b) => b.guideId).sort()).toEqual(['guide-a', 'guide-b']);
  });

  it('records exactly one journey-kind record per completed bundled journey', async () => {
    // Emission is normalized upstream: a completed bundled journey emits one
    // guide-kind fact (the milestone) plus one journey-kind fact. Distinct
    // durable keys, so both persist — one journey record per journey.
    await armCompletionWriteHook(deps());
    await runTimer();

    recordGuideCompletion(guideFact({ guideId: 'select-platform', guideCategory: 'learning-journey' }));
    recordJourneyCompletion(journeyFact({ guideId: 'linux-journey' }));
    await runTimer();

    const journeys = sent.filter((b) => b.kind === 'journey');
    expect(journeys).toHaveLength(1);
    expect(journeys[0]).toMatchObject({ guideId: 'linux-journey', kind: 'journey' });
  });

  it('drops a same-durable-key re-enqueue while the first is still pending', async () => {
    await armCompletionWriteHook(deps());
    await runTimer();

    // Same (guideSource, guideId) enqueued twice before the drain sends it:
    // the second is deduped by the queue's durable-key guard.
    recordGuideCompletion(guideFact({ guideId: 'dup' }));
    recordGuideCompletion(guideFact({ guideId: 'dup' }));
    await runTimer();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ guideId: 'dup' });
  });
});

describe('error handling', () => {
  it('drops a terminal write without retrying', async () => {
    sendResults = [{ kind: 'terminal' }];
    await armCompletionWriteHook(deps());
    await runTimer();

    recordGuideCompletion(guideFact({ guideId: 'bad' }));
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

    // Fire the drain: processDue starts and suspends on the first send's await.
    fireTimer();
    await flushMicro();
    expect(sendCalls).toHaveLength(1);

    // A second completion arrives mid-send and schedules a fresh timer. Firing
    // it must NOT start a concurrent processDue that re-sends the in-flight item.
    recordGuideCompletion(guideFact({ guideId: 'second' }));
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

describe('drain timer preemption (regression: fresh completion not stranded behind backoff)', () => {
  it('reschedules a far-future backoff timer sooner when a fresh completion is due', async () => {
    let scheduledMs: number[] = [];
    const setTimer = (fn: () => void, ms: number): ReturnType<typeof setTimeout> => {
      drainCb = fn;
      scheduledMs.push(ms);
      return 1 as unknown as ReturnType<typeof setTimeout>;
    };
    // First send is transient with a 5-minute Retry-After, so the stuck item's
    // drain timer is scheduled far into the future.
    sendResults = [{ kind: 'transient', retryAfterMs: 5 * 60 * 1000 }, { kind: 'created' }, { kind: 'created' }];
    await armCompletionWriteHook(deps({ setTimer }));
    await runTimer(); // initial empty drain

    recordGuideCompletion(guideFact({ guideId: 'stuck' }));
    await runTimer(); // attempt 1 → transient, reschedules ~5min out
    expect(sent).toHaveLength(1);
    expect(scheduledMs[scheduledMs.length - 1]).toBeGreaterThan(60 * 1000);

    // A fresh, immediately-due completion must preempt the far-future timer and
    // reschedule it to fire now rather than waiting out the stuck item's backoff.
    scheduledMs = [];
    recordGuideCompletion(guideFact({ guideId: 'fresh' }));
    expect(scheduledMs).toEqual([0]);

    // The clock has NOT advanced past the backoff, yet the fresh item drains.
    await runTimer();
    expect(sent.map((b) => b.guideId)).toContain('fresh');
  });
});

describe('deployment-skew: missing route matrix', () => {
  it('capability 404 (route family absent) never arms', async () => {
    // fetchCompletionCapability maps 404 → false; the hook sees `false`.
    await armCompletionWriteHook(deps({ fetchCapability: async () => false }));
    recordGuideCompletion(guideFact());
    await runTimer();
    expect(sent).toHaveLength(0);
  });

  it('write 404 mid-session (skew) disarms silently with no retry storm', async () => {
    sendResults = [{ kind: 'route-missing' }];
    await armCompletionWriteHook(deps());
    await runTimer();

    recordGuideCompletion(guideFact({ guideId: 'a' }));
    await runTimer(); // route-missing → disarm + teardown
    expect(sent).toHaveLength(1);

    // Subsequent completions do not enqueue or send, and there is no retry loop.
    recordGuideCompletion(guideFact({ guideId: 'b' }));
    clock += 10 * 60 * 1000;
    await runTimer();
    expect(sent).toHaveLength(1);
  });
});
