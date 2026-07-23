/**
 * Track 2 subscriber: the first live consumer of the `onCompletionRecorded`
 * seam. It arms only when the stack supports durable recording, then enqueues
 * each recorded completion for a background POST — never blocking or throwing on
 * the completion path (badges/toasts/streaks paint exactly as before).
 *
 * Arming is capability-gated: on OSS instances without App Platform the
 * capability is false, no subscriber attaches, and behavior is byte-for-byte
 * unchanged. A route-missing outcome mid-session disarms the hook silently
 * (deployment-skew tolerance). Re-probed on a later session — never polled
 * within one.
 */

import { logger } from '../lib/logging';

import { onCompletionRecorded } from './completion-recorder';
import {
  currentCompletionPlatform,
  fetchCompletionCapability,
  postCompletionRecord,
  type CompletionPlatform,
  type CompletionWriteBody,
  type WriteOutcome,
} from './completion-write-client';
import { createWriteQueue, type WriteQueue } from './completion-write-queue';
import type { CompletionFact } from './types';

export interface WriteHookDeps {
  fetchCapability: () => Promise<boolean>;
  send: (body: CompletionWriteBody) => Promise<WriteOutcome>;
  platform: () => CompletionPlatform;
  now: () => number;
  random: () => number;
  setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer: (handle: ReturnType<typeof setTimeout>) => void;
}

const defaultDeps: WriteHookDeps = {
  fetchCapability: fetchCompletionCapability,
  send: postCompletionRecord,
  platform: currentCompletionPlatform,
  now: () => Date.now(),
  random: Math.random,
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle),
};

// Module-level session state. A single arm per session; reset only for tests.
let deps: WriteHookDeps = defaultDeps;
let armed = false;
let arming = false;
let attempted = false;
let queue: WriteQueue | null = null;
let unsubscribe: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let timerFireAt: number | null = null;
let draining = false;

function durableKeyOf(fact: CompletionFact): string {
  // U+241F (SYMBOL FOR UNIT SEPARATOR) can't appear in an id, so it's a safe
  // joiner for the durable (guideSource, guideId) key.
  return `${fact.guideSource}␟${fact.guideId}`;
}

function toBody(fact: CompletionFact): CompletionWriteBody {
  return {
    guideSource: fact.guideSource,
    guideId: fact.guideId,
    kind: fact.kind,
    guideTitle: fact.guideTitle,
    guideCategory: fact.guideCategory,
    pathId: fact.pathId,
    completionPercent: fact.completionPercent,
    source: fact.source,
    completedAt: fact.completedAt,
    durationMs: fact.durationMs,
    platform: deps.platform(),
  };
}

function onFact(fact: CompletionFact): void {
  // NEVER block or throw on the completion path: enqueue to the persisted queue
  // and return. Emission is normalized upstream (the milestone path owns the
  // single guide-kind fact per completion), so the queue's durable-key dedupe is
  // the only dedupe needed.
  try {
    if (!queue || queue.isDisarmed()) {
      return;
    }
    queue.enqueue(toBody(fact), durableKeyOf(fact));
    scheduleDrain(0);
  } catch (error) {
    logger.debug('completion write: enqueue failed (ignored)', { error: String(error) });
  }
}

function scheduleDrain(delayMs: number): void {
  if (!armed) {
    return;
  }
  const ms = Math.max(0, delayMs);
  const fireAt = deps.now() + ms;
  // A pending timer must never strand a sooner (immediately-due) completion
  // behind an in-backoff item's far-future delay: preempt and reschedule to the
  // earlier time. A sooner-or-equal timer is left as-is (single-timer invariant).
  if (timer !== null) {
    if (timerFireAt !== null && fireAt >= timerFireAt) {
      return;
    }
    deps.clearTimer(timer);
    timer = null;
  }
  timerFireAt = fireAt;
  timer = deps.setTimer(() => {
    timer = null;
    timerFireAt = null;
    void drain();
  }, ms);
}

async function drain(): Promise<void> {
  // Single-drain re-entrancy guard: a completion enqueued during processDue's
  // `await send()` schedules a fresh timer (timer is nulled before the async
  // drain runs), which would start a second concurrent processDue and re-POST
  // the still-in-flight item. Only one drain runs at a time; work enqueued
  // during it is picked up by the reschedule below (processDue's result
  // reflects the full queue at completion).
  if (!queue || draining) {
    return;
  }
  draining = true;
  let result;
  try {
    result = await queue.processDue();
  } catch (error) {
    logger.debug('completion write: drain failed (ignored)', { error: String(error) });
    return;
  } finally {
    draining = false;
  }
  if (result.disarmed) {
    teardown();
    return;
  }
  if (result.nextDelayMs !== null) {
    scheduleDrain(result.nextDelayMs);
  }
}

function teardown(): void {
  if (timer !== null) {
    deps.clearTimer(timer);
    timer = null;
  }
  timerFireAt = null;
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  queue = null;
  armed = false;
}

/**
 * Arm the durable completion-write hook. Idempotent and safe to call once at
 * plugin start. Resolves after the capability probe; if the feature is
 * unavailable, it never subscribes (behavior unchanged). Optional deps override
 * the client/timer/clock for tests.
 */
export async function armCompletionWriteHook(overrides?: Partial<WriteHookDeps>): Promise<void> {
  if (armed || arming || attempted) {
    return;
  }
  arming = true;
  attempted = true;
  deps = { ...defaultDeps, ...overrides };
  try {
    const available = await deps.fetchCapability();
    if (!available) {
      return;
    }
    queue = createWriteQueue({ now: deps.now, send: deps.send, random: deps.random });
    unsubscribe = onCompletionRecorded(onFact);
    armed = true;
    // Drain anything persisted from an earlier load (best-effort resume).
    scheduleDrain(0);
  } catch (error) {
    logger.debug('completion write: arm failed (ignored)', { error: String(error) });
  } finally {
    arming = false;
  }
}

/**
 * Test-only reset of all module-level session state.
 */
export function __resetCompletionWriteHookForTests(): void {
  if (timer !== null) {
    defaultDeps.clearTimer(timer);
  }
  if (unsubscribe) {
    unsubscribe();
  }
  deps = defaultDeps;
  armed = false;
  arming = false;
  attempted = false;
  queue = null;
  unsubscribe = null;
  timer = null;
  timerFireAt = null;
  draining = false;
}
