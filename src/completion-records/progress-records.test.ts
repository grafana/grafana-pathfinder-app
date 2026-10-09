/**
 * The records-mode wiring (incremental progress): mode resolution from the
 * flag and the backend capability, the observer handing partials to the write
 * queue, the hook's wire bodies, and the capability loader.
 */
const mockFetch = jest.fn();
jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({ fetch: mockFetch }),
  config: {
    buildInfo: { versionString: 'Grafana Cloud' },
    bootData: { user: { id: 7, orgId: 3 } },
  },
}));
jest.mock('../lib/analytics', () => ({
  ...jest.requireActual('../lib/analytics'),
  reportAppInteraction: jest.fn(),
}));
// No requireActual: the openfeature/openfeature-tracking import cycle breaks it inside a factory.
jest.mock('../utils/openfeature', () => ({
  getFeatureFlagValue: jest.fn(() => false),
}));

import { of, throwError } from 'rxjs';

import { dispatchProgress } from '../global-state/progress-events';
import { getFeatureFlagValue } from '../utils/openfeature';

import {
  invalidateAllEmittedCompletions,
  invalidateEmittedCompletion,
  recordGuideCompletion,
  __resetRecorderForTests,
} from './completion-recorder';
import type { CompletionWriteBody, WriteOutcome } from './completion-write-client';
import {
  armCompletionWriteHook,
  discardQueuedCompletionWrites,
  __resetCompletionWriteHookForTests,
  type WriteHookDeps,
} from './completion-write-hook';
import { PARTIAL_DEBOUNCE_MS } from './completion-write-queue';
import { closeAttempt, raiseHighWater, readAttempt, resolveAttemptMode } from './guide-attempts';
import { registerGuideIdentity, __resetGuideIdentityRegistryForTests } from './guide-identity-registry';
import { __resetProgressObserverForTests } from './progress-observer';
import {
  loadProgressRecordsCapability,
  progressRecordsCapability,
  __resetProgressRecordsCapabilityForTests,
  __setProgressRecordsCapabilityForTests,
  type ProgressRecordsCapability,
} from './progress-records-capability';
import type { GuideCompletionFact } from './types';

const flagMock = getFeatureFlagValue as jest.Mock;
const CONTENT_KEY = 'bundled:intro';
const KEY = { guideSource: 'bundled', guideId: 'intro' };

function setFlag(on: boolean): void {
  flagMock.mockImplementation((name: string, fallback: boolean) =>
    name === 'pathfinder.progress-records' ? on : fallback
  );
}

beforeEach(() => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (_name: string, work: () => void) => {
        work();
        return Promise.resolve();
      },
    },
  });
  localStorage.clear();
  mockFetch.mockReset();
  setFlag(false);
  __resetRecorderForTests();
  __resetCompletionWriteHookForTests();
  __resetProgressObserverForTests();
  __resetGuideIdentityRegistryForTests();
  __resetProgressRecordsCapabilityForTests();
});

describe('resolveAttemptMode', () => {
  it.each<[boolean, ProgressRecordsCapability, string]>([
    [true, 'yes', 'records'],
    [true, 'no', 'analytics'],
    [true, 'unknown', 'analytics'],
    [false, 'yes', 'analytics'],
  ])('flag %s and capability %s gives %s', (flag, capability, mode) => {
    setFlag(flag);
    __setProgressRecordsCapabilityForTests(capability);
    expect(resolveAttemptMode()).toBe(mode);
  });
});

describe('loadProgressRecordsCapability', () => {
  beforeEach(() => setFlag(true));

  it.each([
    [{ available: true, progressRecords: true }, 'yes'],
    [{ available: true }, 'no'],
    [{ available: false, reason: 'backend-unavailable' }, 'no'],
    [{ unexpected: 'shape' }, 'unknown'],
    [{ available: true, progressRecords: true, futureField: true }, 'unknown'],
  ])('reads %j as %s', async (data, expected) => {
    mockFetch.mockReturnValue(of({ data }));
    await expect(loadProgressRecordsCapability()).resolves.toBe(expected);
    expect(progressRecordsCapability()).toBe(expected);
  });

  it('stays unknown when the request fails, so a later call can retry', async () => {
    mockFetch.mockReturnValue(throwError(() => new Error('offline')));
    await expect(loadProgressRecordsCapability()).resolves.toBe('unknown');
    expect(progressRecordsCapability()).toBe('unknown');
  });
});

// --- Hook and observer, end to end -----------------------------------------

let drainCb: (() => void) | null = null;
let clock = 1_000_000;
let sent: Array<{ body: CompletionWriteBody; key: string }> = [];

function deps(capability: ProgressRecordsCapability): Partial<WriteHookDeps> {
  return {
    send: async (b, key): Promise<WriteOutcome> => {
      sent.push({ body: b, key });
      return { kind: 'created' };
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
    progressRecords: () => capability,
    loadProgressRecords: () => undefined,
  };
}

async function runTimer(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const cb = drainCb;
    drainCb = null;
    cb?.();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }
}

function guideFact(over: Partial<GuideCompletionFact> = {}): GuideCompletionFact {
  return {
    kind: 'guide',
    guideSource: 'bundled',
    guideId: 'intro',
    guideTitle: 'Intro',
    guideCategory: 'interactive',
    completionPercent: 100,
    source: 'manual',
    completedAt: new Date(clock).toISOString(),
    ...over,
  };
}

function arm(capability: ProgressRecordsCapability): void {
  setFlag(true);
  __setProgressRecordsCapabilityForTests(capability);
  sent = [];
  drainCb = null;
  armCompletionWriteHook(deps(capability));
  registerGuideIdentity(CONTENT_KEY, { ...KEY, guideTitle: 'Intro', guideCategory: 'interactive', pathId: 'p1' });
}

function progress(percentage: number): void {
  dispatchProgress({ kind: 'guide', contentKey: CONTENT_KEY, percentage, hasProgress: true, origin: 'change' });
}

describe('records mode end to end', () => {
  it('sends debounced partials then the completion, all naming one attempt', async () => {
    arm('yes');

    progress(20);
    progress(45);
    const attempt = readAttempt(KEY)!;
    expect(attempt.mode).toBe('records');
    await runTimer();
    expect(sent).toHaveLength(0); // still debouncing

    clock += PARTIAL_DEBOUNCE_MS;
    await runTimer();
    drainCb?.();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({
      guideSource: 'bundled',
      guideId: 'intro',
      guideTitle: 'Intro',
      pathId: 'p1',
      completionPercent: 45,
      source: 'objectives',
      attemptId: attempt.attemptId,
      platform: 'cloud',
    });
    expect(sent[0]!.key).toBe(`${attempt.attemptId}-45`);

    recordGuideCompletion(guideFact(), { attemptEligible: true });
    await runTimer();
    expect(sent).toHaveLength(2);
    expect(sent[1]!.body).toMatchObject({ completionPercent: 100, source: 'manual', attemptId: attempt.attemptId });
    expect(sent[1]!.key).toBe(`${attempt.attemptId}-100`);
  });

  it('in analytics mode sends no partials and the original completion body', async () => {
    arm('no');

    progress(30);
    expect(readAttempt(KEY)!.mode).toBe('analytics');
    clock += PARTIAL_DEBOUNCE_MS;
    await runTimer();
    expect(sent).toHaveLength(0);

    recordGuideCompletion(guideFact(), { attemptEligible: true });
    await runTimer();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).not.toHaveProperty('attemptId');
    expect(Object.keys(sent[0]!.body).sort()).toEqual(
      [
        'completedAt',
        'completionPercent',
        'guideCategory',
        'guideId',
        'guideSource',
        'guideTitle',
        'platform',
        'source',
      ].sort()
    );
  });

  it.each(['raiseHighWater', 'closeAttempt'])('keeps the wire identity when %s cannot persist', async (operation) => {
    arm('yes');
    progress(20);
    clock += PARTIAL_DEBOUNCE_MS;
    await runTimer();
    const attempt = readAttempt(KEY)!;
    expect(sent[0]!.body.attemptId).toBe(attempt.attemptId);
    const original = Storage.prototype.setItem;
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key.includes('guide-attempt-')) {
        throw new Error('quota');
      }
      original.call(this, key, value);
    });
    try {
      if (operation === 'raiseHighWater') {
        raiseHighWater(KEY, 40);
      } else {
        closeAttempt(KEY, attempt.attemptId);
      }
      recordGuideCompletion(guideFact(), { attemptEligible: true });
      await runTimer();
      expect(sent.at(-1)!.body).toMatchObject({ completionPercent: 100, attemptId: attempt.attemptId });
      expect(readAttempt(KEY)!.mode).toBe('records');
    } finally {
      spy.mockRestore();
    }
  });

  it('stops new and already queued partials when disabled, but completes the same attempt', async () => {
    arm('yes');
    progress(20);
    const attempt = readAttempt(KEY)!;
    setFlag(false);
    progress(50);
    clock += PARTIAL_DEBOUNCE_MS;
    await runTimer();
    expect(sent).toEqual([]);
    recordGuideCompletion(guideFact(), { attemptEligible: true });
    await runTimer();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({ completionPercent: 100, attemptId: attempt.attemptId });
  });

  it('discards an old attempt partial on reset and retains the new completion', async () => {
    arm('yes');
    progress(40);
    const old = readAttempt(KEY)!;
    invalidateEmittedCompletion(KEY.guideSource, KEY.guideId);
    recordGuideCompletion(guideFact(), { attemptEligible: true });
    clock += PARTIAL_DEBOUNCE_MS;
    await runTimer();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.completionPercent).toBe(100);
    expect(sent[0]!.body.attemptId).not.toBe(old.attemptId);
    expect(sent[0]!.body.attemptStartedAt).toBe(new Date(readAttempt(KEY)!.startedAt).toISOString());
  });

  it('keeps the high-water mark retryable after a queue persist failure', async () => {
    arm('yes');
    const original = Storage.prototype.setItem;
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key.includes('completion-write-queue-')) {
        throw new Error('quota');
      }
      original.call(this, key, value);
    });
    progress(40);
    expect(readAttempt(KEY)!.highWater).toBe(0);
    spy.mockRestore();
    progress(40);
    expect(readAttempt(KEY)!.highWater).toBe(40);
    clock += PARTIAL_DEBOUNCE_MS;
    await runTimer();
    expect(sent).toHaveLength(1);
  });

  it('serializes real progress and completion callbacks through the asynchronous lock', async () => {
    arm('yes');
    let pending = Promise.resolve();
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: (_name: string, work: () => void) => {
          pending = pending.then(work);
          return pending;
        },
      },
    });
    progress(20);
    progress(40);
    recordGuideCompletion(guideFact(), { attemptEligible: true });
    recordGuideCompletion(guideFact(), { attemptEligible: true });
    await pending;
    await runTimer();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.completionPercent).toBe(100);
    expect(readAttempt(KEY)).toMatchObject({ closed: true, highWater: 100, attemptId: sent[0]!.body.attemptId });
  });

  it('reset all also clears writes waiting on an asynchronous attempt lock', async () => {
    arm('yes');
    let pending = Promise.resolve();
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: (_name: string, work: () => void) => {
          pending = pending.then(work);
          return pending;
        },
      },
    });
    progress(20);
    recordGuideCompletion(guideFact(), { attemptEligible: true });
    invalidateAllEmittedCompletions();
    discardQueuedCompletionWrites();
    await pending;
    await runTimer();
    expect(sent).toEqual([]);
    expect(readAttempt(KEY)).toBeNull();
  });

  it('keeps an attempt in the mode it was minted in when the flag flips', async () => {
    arm('yes');
    progress(20);
    setFlag(false);

    recordGuideCompletion(guideFact(), { attemptEligible: true });
    await runTimer();

    expect(sent.at(-1)!.body.attemptId).toBe(readAttempt(KEY)!.attemptId);
  });
});
