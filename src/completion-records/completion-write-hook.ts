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

// A bundled journey's sibling facts do NOT arrive in one synchronous burst:
// onGuideComplete calls markMilestoneDone un-awaited, and that helper emits its
// learning-journey and journey facts only after several awaits. A microtask
// flush would therefore only ever see the first (synchronous) fact. A fixed
// time window from the first fact is the smallest mechanism that spans those
// async ticks and collapses the triplet to one record.
const COALESCE_WINDOW_MS = 2000;

// Module-level session state. A single arm per session; reset only for tests.
let deps: WriteHookDeps = defaultDeps;
let armed = false;
let arming = false;
let attempted = false;
let queue: WriteQueue | null = null;
let unsubscribe: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let draining = false;

// Facts buffered within one coalescing window, flushed together so a bundled
// journey's siblings normalize to a single durable record (see flushWindow).
let windowBuffer: CompletionFact[] = [];
let windowTimer: ReturnType<typeof setTimeout> | null = null;

function durableKeyOf(fact: CompletionFact): string {
  // U+241F (SYMBOL FOR UNIT SEPARATOR) can't appear in an id, so it's a safe
  // joiner for the durable (guideSource, guideId) key.
  return `${fact.guideSource}␟${fact.guideId}`;
}

// completionRank orders facts by how canonical they are as the single record for
// a completion: a whole-journey completion outranks a milestone/learning-journey
// guide, which outranks the interactive-category duplicate, which outranks docs.
function completionRank(fact: CompletionFact): number {
  if (fact.kind === 'journey') {
    return 3;
  }
  if (fact.guideCategory === 'learning-journey') {
    return 2;
  }
  if (fact.guideCategory === 'interactive') {
    return 1;
  }
  return 0;
}

/**
 * Normalize one coalescing window to a single canonical fact.
 *
 * A completed bundled learning-journey drives BOTH branches of
 * DocsPanelContentArea.onGuideComplete: setJourneyCompletionPercentage emits an
 * interactive-category guide fact synchronously, while markMilestoneDone is
 * called UN-AWAITED and emits its learning-journey fact (and, on the final
 * milestone, a journey fact) only after several awaits. The recorder keeps these
 * distinct (different guide ids), which is deliberate parity for other consumers
 * — but Track 2 must persist exactly ONE durable record per completed bundled
 * journey (captain decision 2026-07-23).
 *
 * The window is intentionally BLANKET-scoped (not keyed to a journey): no
 * reliable relation key rides on the emitted CompletionFact — pathId is
 * undefined at the bundled onGuideComplete call sites, the package manifest is
 * not carried on the fact, and guideTitle is denormalized. This is safe because
 * distinct completions are user-paced (a user cannot finish two different guides
 * within COALESCE_WINDOW_MS) while a journey's triplet fires within
 * milliseconds; and the backend read-side collateByUser dedups per
 * (userId, guideSource, guideId) regardless.
 */
function flushWindow(): void {
  windowTimer = null;
  const facts = windowBuffer;
  windowBuffer = [];
  if (facts.length === 0 || !queue || queue.isDisarmed()) {
    return;
  }
  const canonical = facts.reduce((best, f) => (completionRank(f) > completionRank(best) ? f : best));
  queue.enqueue(toBody(canonical), durableKeyOf(canonical));
  scheduleDrain(0);
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
  // NEVER block or throw on the completion path: buffer and return. The window
  // is flushed on a later timer so a bundled journey's sibling facts (emitted
  // across separate async ticks) are normalized to one record before enqueue.
  try {
    if (!queue || queue.isDisarmed()) {
      return;
    }
    windowBuffer.push(fact);
    // Fixed window from the FIRST fact: never restarted on later facts, so it
    // stays bounded regardless of how many siblings arrive.
    if (windowTimer === null) {
      windowTimer = deps.setTimer(() => {
        try {
          flushWindow();
        } catch (error) {
          logger.debug('completion write: window flush failed (ignored)', { error: String(error) });
        }
      }, COALESCE_WINDOW_MS);
    }
  } catch (error) {
    logger.debug('completion write: enqueue failed (ignored)', { error: String(error) });
  }
}

function scheduleDrain(delayMs: number): void {
  if (!armed || timer !== null) {
    return;
  }
  timer = deps.setTimer(
    () => {
      timer = null;
      void drain();
    },
    Math.max(0, delayMs)
  );
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
  if (windowTimer !== null) {
    deps.clearTimer(windowTimer);
    windowTimer = null;
  }
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  queue = null;
  armed = false;
  windowBuffer = [];
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
  if (windowTimer !== null) {
    defaultDeps.clearTimer(windowTimer);
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
  windowTimer = null;
  draining = false;
  windowBuffer = [];
}
