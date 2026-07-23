/**
 * Unit tests for the Track 2 write hook: synchronous arming, a provably
 * non-blocking completion path, direct enqueue, the
 * concurrent-drain guard, terminal-drop / transient-retry, and the
 * deployment-skew missing-route matrix. The recorder is the REAL module; all
 * client/timer/clock deps are injected so the drain state machine is driven
 * deterministically.
 */

// The hook imports the client module (for defaults); mock @grafana/runtime so
// that import loads. Injected deps mean the real client is never called.
jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({ fetch: jest.fn() }),
  config: {
    bootData: {
      user: { id: 7, orgId: 3 },
      settings: { buildInfo: { versionString: 'Grafana Cloud' } },
    },
  },
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
});

describe('arming', () => {
  it('subscribes immediately and writes an enqueued completion', async () => {
    await armCompletionWriteHook(deps());

    recordGuideCompletion(guideFact({ guideId: 'dash' }));
    await runTimer();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ guideId: 'dash', platform: 'cloud' });
  });

  it('is idempotent and does not double-subscribe', async () => {
    await armCompletionWriteHook(deps());
    await armCompletionWriteHook(deps());
    recordGuideCompletion(guideFact());
    await runTimer();
    expect(sent).toHaveLength(1);
  });

  it('does not subscribe or persist when the user and org identity is unavailable', async () => {
    await armCompletionWriteHook(deps({ ownerKey: () => null }));

    recordGuideCompletion(guideFact({ guideId: 'unowned' }));
    await runTimer();

    expect(sent).toHaveLength(0);
    expect(localStorage.length).toBe(0);
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

describe('direct enqueue', () => {
  it('enqueues each distinct completion as its own record', async () => {
    await armCompletionWriteHook(deps());
    await runTimer();

    recordGuideCompletion(guideFact({ guideId: 'guide-a' }));
    recordGuideCompletion(guideFact({ guideId: 'guide-b' }));
    await runTimer();

    expect(sent.map((b) => b.guideId).sort()).toEqual(['guide-a', 'guide-b']);
  });

  it('records the milestone and completed bundled journey once each', async () => {
    await armCompletionWriteHook(deps());
    await runTimer();

    recordGuideCompletion(guideFact({ guideId: 'select-platform', guideCategory: 'learning-journey' }));
    recordJourneyCompletion(journeyFact({ guideId: 'linux-journey' }));
    await runTimer();

    const journeys = sent.filter((b) => b.guideId === 'linux-journey');
    expect(journeys).toHaveLength(1);
    expect(journeys[0]).toMatchObject({ guideId: 'linux-journey', guideCategory: 'learning-journey' });
  });

  it('keeps separately recorded guide and journey facts', async () => {
    await armCompletionWriteHook(deps());
    await runTimer();

    recordGuideCompletion(guideFact({ guideId: 'shared' }));
    recordJourneyCompletion(journeyFact({ guideId: 'shared' }));
    await runTimer();

    expect(sent).toHaveLength(2);
    expect(sent.map((body) => body.guideCategory).sort()).toEqual(['interactive', 'learning-journey']);
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
  it('reschedules a pending backoff timer sooner when a fresh completion is due', async () => {
    let scheduledMs: number[] = [];
    const setTimer = (fn: () => void, ms: number): ReturnType<typeof setTimeout> => {
      drainCb = fn;
      scheduledMs.push(ms);
      return 1 as unknown as ReturnType<typeof setTimeout>;
    };
    // First send is transient, so the stuck item's drain timer is scheduled a
    // full backoff into the future (1s base, zero jitter with random()=0.5).
    sendResults = [{ kind: 'transient' }, { kind: 'created' }, { kind: 'created' }];
    await armCompletionWriteHook(deps({ setTimer }));

    recordGuideCompletion(guideFact({ guideId: 'stuck' }));
    await runTimer(); // attempt 1 → transient, reschedules a backoff out
    expect(sent).toHaveLength(1);
    expect(scheduledMs[scheduledMs.length - 1]).toBeGreaterThanOrEqual(1000);

    // A fresh, immediately-due completion must preempt the pending timer and
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
