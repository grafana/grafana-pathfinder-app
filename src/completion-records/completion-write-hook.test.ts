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
import { createCompletionWriteStorage } from './completion-write-storage';
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
    armCompletionWriteHook(deps());

    recordGuideCompletion(guideFact({ guideId: 'dash' }));
    await runTimer();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ guideId: 'dash', platform: 'cloud' });
  });

  it('is idempotent and does not double-subscribe', async () => {
    armCompletionWriteHook(deps());
    armCompletionWriteHook(deps());
    recordGuideCompletion(guideFact());
    await runTimer();
    expect(sent).toHaveLength(1);
  });

  it('does not subscribe or persist when the user and org identity is unavailable', async () => {
    armCompletionWriteHook(deps({ ownerKey: () => null }));

    recordGuideCompletion(guideFact({ guideId: 'unowned' }));
    await runTimer();

    expect(sent).toHaveLength(0);
    expect(localStorage.length).toBe(0);
  });
});

describe('completion path is non-blocking', () => {
  it('recording returns synchronously without invoking the sender', async () => {
    armCompletionWriteHook(deps());
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
    armCompletionWriteHook(deps());
    await runTimer();

    recordGuideCompletion(guideFact({ guideId: 'guide-a' }));
    recordGuideCompletion(guideFact({ guideId: 'guide-b' }));
    await runTimer();

    expect(sent.map((b) => b.guideId).sort()).toEqual(['guide-a', 'guide-b']);
  });

  it('records the milestone and completed bundled journey once each', async () => {
    armCompletionWriteHook(deps());
    await runTimer();

    recordGuideCompletion(guideFact({ guideId: 'select-platform', guideCategory: 'learning-journey' }));
    recordJourneyCompletion(journeyFact({ guideId: 'linux-journey' }));
    await runTimer();

    const journeys = sent.filter((b) => b.guideId === 'linux-journey');
    expect(journeys).toHaveLength(1);
    expect(journeys[0]).toMatchObject({ guideId: 'linux-journey', guideCategory: 'learning-journey' });
  });

  it('keeps separately recorded guide and journey facts', async () => {
    armCompletionWriteHook(deps());
    await runTimer();

    recordGuideCompletion(guideFact({ guideId: 'shared' }));
    recordJourneyCompletion(journeyFact({ guideId: 'shared' }));
    await runTimer();

    expect(sent).toHaveLength(2);
    expect(sent.map((body) => body.guideCategory).sort()).toEqual(['interactive', 'learning-journey']);
  });
});

describe('universal bootstrap arming (surface-agnostic; not root-page scoped)', () => {
  // Production arms the hook from the universal plugin bootstrap (module.tsx
  // plugin.init), which fires for every entry surface — the extension sidebar,
  // floating, and full-screen included — not only the root App page. This
  // exercises that contract: with NO App root involved, a completion recorded
  // after the bootstrap call still drains.
  it('drains a completion recorded when only a non-root surface (e.g. the sidebar) is active', async () => {
    armCompletionWriteHook(deps()); // the exact call plugin.init makes
    await runTimer();

    recordGuideCompletion(guideFact({ guideId: 'sidebar-guide' }));
    await runTimer();

    expect(sent.map((b) => b.guideId)).toEqual(['sidebar-guide']);
  });
});

describe('payload boundary normalization (payload-boundary-normalization)', () => {
  const CONTROL = String.fromCharCode(7); // BEL
  const CONTROL_RE = new RegExp('[\\u0000-\\u001f\\u007f]');

  it('clamps an oversized title and strips control characters at emission', async () => {
    armCompletionWriteHook(deps());
    await runTimer();

    recordGuideCompletion(guideFact({ guideId: 'clamp', guideTitle: 'a'.repeat(5000) + CONTROL }));
    await runTimer();

    expect(sent).toHaveLength(1);
    expect(sent[0]!.guideTitle.length).toBeLessThanOrEqual(1024);
    expect(CONTROL_RE.test(sent[0]!.guideTitle)).toBe(false);
  });

  it('rejects a fact whose identifier normalizes to empty rather than queueing a terminal 400', async () => {
    armCompletionWriteHook(deps());
    await runTimer();

    recordGuideCompletion(guideFact({ guideSource: CONTROL, guideId: 'x' }));
    await runTimer();

    expect(sent).toHaveLength(0);
  });
});

describe('error handling', () => {
  it('drops a terminal write without retrying', async () => {
    sendResults = [{ kind: 'terminal' }];
    armCompletionWriteHook(deps());
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
    armCompletionWriteHook(deps());
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

    armCompletionWriteHook(deps({ send }));

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
    armCompletionWriteHook(deps({ setTimer }));

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

describe('startup drain (reload durability)', () => {
  it('drains items persisted by a previous session as soon as the hook arms', async () => {
    // Seed the real per-owner storage (bootData mock: user 7, org 3) with a
    // due item, as if a prior session enqueued it and reloaded before sending.
    createCompletionWriteStorage('user-7:org-3').put({
      id: 'leftover-1',
      body: {
        guideSource: 'bundled',
        guideId: 'leftover',
        guideTitle: 'Leftover',
        guideCategory: 'interactive',
        completionPercent: 100,
        source: 'objectives',
        completedAt: '2026-07-20T00:00:00.000Z',
        platform: 'cloud',
      },
      attempts: 1,
      createdAt: 0,
      nextAttemptAt: 0,
    });

    sendResults = [{ kind: 'created' }];
    armCompletionWriteHook(deps());
    expect(drainCb).not.toBeNull(); // arming alone schedules the drain

    await runTimer();
    expect(sent.map((b) => b.guideId)).toEqual(['leftover']);
  });
});

describe('deployment-skew: missing route matrix', () => {
  it('write 404 mid-session disarms network drains with no retry storm', async () => {
    sendResults = [{ kind: 'route-missing' }];
    armCompletionWriteHook(deps());
    await runTimer();

    recordGuideCompletion(guideFact({ guideId: 'a' }));
    await runTimer(); // route-missing → suppress network drains this session
    expect(sent).toHaveLength(1);

    // A later completion no longer SENDS this session, and there is no retry loop.
    recordGuideCompletion(guideFact({ guideId: 'b' }));
    clock += 10 * 60 * 1000;
    await runTimer();
    expect(sent).toHaveLength(1);
  });

  it('keeps persisting later facts after a structural 404 and drains all on the next arm', async () => {
    sendResults = [{ kind: 'route-missing' }];
    armCompletionWriteHook(deps());
    await runTimer();

    recordGuideCompletion(guideFact({ guideId: 'a' }));
    await runTimer(); // 'a' send → route-missing → network disarmed; 'a' stays persisted
    expect(sent).toHaveLength(1);

    // A later same-session completion still enqueues + persists (no send now).
    recordGuideCompletion(guideFact({ guideId: 'b' }));
    await runTimer();
    expect(sent).toHaveLength(1);
    // Both facts are durably persisted for a future load.
    expect(createCompletionWriteStorage('user-7:org-3').list()).toHaveLength(2);

    // Reload / rearm on a session where the route now exists: both drain.
    __resetCompletionWriteHookForTests();
    sent = [];
    sendResults = [{ kind: 'created' }];
    sendIdx = 0;
    armCompletionWriteHook(deps());
    await runTimer();
    await runTimer();
    expect(sent.map((b) => b.guideId).sort()).toEqual(['a', 'b']);
  });
});
