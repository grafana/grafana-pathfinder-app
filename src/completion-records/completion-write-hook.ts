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
  /** Defers the burst flush to a later microtask; injected for deterministic tests. */
  defer: (fn: () => void) => void;
}

const defaultDeps: WriteHookDeps = {
  fetchCapability: fetchCompletionCapability,
  send: postCompletionRecord,
  platform: currentCompletionPlatform,
  now: () => Date.now(),
  random: Math.random,
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle),
  defer: (fn) => queueMicrotask(fn),
};

// Module-level session state. A single arm per session; reset only for tests.
let deps: WriteHookDeps = defaultDeps;
let armed = false;
let arming = false;
let attempted = false;
let queue: WriteQueue | null = null;
let unsubscribe: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

// Facts buffered within one synchronous completion burst, flushed together so
// the burst can be normalized to a single durable record (see flushBurst).
let burst: CompletionFact[] = [];
let burstScheduled = false;

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
 * Normalize one synchronous completion burst to a single canonical fact.
 *
 * A completed bundled learning-journey drives BOTH branches of
 * DocsPanelContentArea.onGuideComplete in one synchronous call:
 * setJourneyCompletionPercentage emits an interactive-category guide fact and
 * markMilestoneDone emits a learning-journey fact (and, on the final milestone, a
 * journey fact). The recorder keeps these distinct (different guide ids), which
 * is deliberate parity for other consumers — but Track 2 must persist exactly ONE
 * durable record per completed bundled journey (captain decision 2026-07-23).
 *
 * Because every such fact arrives in the same synchronous burst (one completion
 * event), collapsing a multi-fact burst to its highest-ranked fact yields exactly
 * one record without touching the recorder. Single-fact bursts (standalone guide
 * completions) pass through unchanged.
 */
function flushBurst(): void {
  burstScheduled = false;
  const facts = burst;
  burst = [];
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
  // NEVER block or throw on the completion path: buffer and return. The burst is
  // flushed on a later microtask so a bundled journey's sibling facts (emitted in
  // the same synchronous call) are normalized to one record before enqueue.
  try {
    if (!queue || queue.isDisarmed()) {
      return;
    }
    burst.push(fact);
    if (!burstScheduled) {
      burstScheduled = true;
      deps.defer(() => {
        try {
          flushBurst();
        } catch (error) {
          logger.debug('completion write: burst flush failed (ignored)', { error: String(error) });
        }
      });
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
  if (!queue) {
    return;
  }
  let result;
  try {
    result = await queue.processDue();
  } catch (error) {
    logger.debug('completion write: drain failed (ignored)', { error: String(error) });
    return;
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
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  queue = null;
  armed = false;
  burst = [];
  burstScheduled = false;
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
  burst = [];
  burstScheduled = false;
}
