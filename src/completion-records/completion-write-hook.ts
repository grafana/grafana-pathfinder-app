import { logger } from '../lib/logging';

import { onCompletionRecorded } from './completion-recorder';
import {
  currentCompletionPlatform,
  postCompletionRecord,
  type CompletionPlatform,
  type CompletionWriteBody,
  type WriteOutcome,
} from './completion-write-client';
import { createWriteQueue, type WriteQueue } from './completion-write-queue';
import { MAX_ID_BYTES, MAX_TITLE_BYTES, isValidIdentifier, normalizeField } from './completion-write-normalize';
import {
  createCompletionWriteStorage,
  currentCompletionQueueOwnerKey,
  type CompletionWriteStorage,
} from './completion-write-storage';
import { reportCompletionWriteDegradation } from './completion-write-telemetry';
import type { CompletionFact } from './types';

export interface WriteHookDeps {
  send: (body: CompletionWriteBody, idempotencyKey: string) => Promise<WriteOutcome>;
  ownerKey: () => string | null;
  storage: (ownerKey: string) => CompletionWriteStorage;
  platform: () => CompletionPlatform;
  now: () => number;
  random: () => number;
  setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer: (handle: ReturnType<typeof setTimeout>) => void;
}

const defaultDeps: WriteHookDeps = {
  send: postCompletionRecord,
  ownerKey: currentCompletionQueueOwnerKey,
  storage: createCompletionWriteStorage,
  platform: currentCompletionPlatform,
  now: () => Date.now(),
  random: Math.random,
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle),
};

class CompletionWriteController {
  private readonly queue: WriteQueue | null;
  private unsubscribe: (() => void) | null = null;
  private unsubscribeStorage: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerFireAt: number | null = null;
  private draining = false;
  private started = false;
  private disposed = false;

  constructor(private readonly deps: WriteHookDeps) {
    const ownerKey = deps.ownerKey();
    this.queue = ownerKey
      ? createWriteQueue({
          now: deps.now,
          send: deps.send,
          random: deps.random,
          storage: deps.storage(ownerKey),
        })
      : null;
  }

  start(): void {
    if (this.started || this.disposed || !this.queue) {
      return;
    }
    this.started = true;
    this.unsubscribe = onCompletionRecorded((fact) => this.onFact(fact));
    this.unsubscribeStorage = this.queue.subscribe(() => this.scheduleDrain(0));
    if (this.queue.size() > 0) {
      this.scheduleDrain(0);
    }
  }

  dispose(): void {
    if (this.timer !== null) {
      this.deps.clearTimer(this.timer);
      this.timer = null;
    }
    this.timerFireAt = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.unsubscribeStorage?.();
    this.unsubscribeStorage = null;
    this.disposed = true;
  }

  /**
   * A structural 404 means the write route is not served on this stack. Stop all
   * network draining for the session — clear the pending timer and drop the
   * cross-tab storage listener whose only job is to trigger drains — but keep
   * the recorder subscription so later completions still enqueue and persist.
   * Those persisted facts drain on the next load once the route exists.
   */
  private suppressNetworkForSession(): void {
    if (this.timer !== null) {
      this.deps.clearTimer(this.timer);
      this.timer = null;
    }
    this.timerFireAt = null;
    this.unsubscribeStorage?.();
    this.unsubscribeStorage = null;
  }

  private onFact(fact: CompletionFact): void {
    try {
      if (this.disposed || !this.queue) {
        return;
      }
      // Reject a fact whose identifiers are invalid after normalization rather
      // than queue a guaranteed terminal 400. The backend stays authoritative;
      // this only spares the bounded queue and surfaces the drop.
      if (!isValidIdentifier(fact.guideSource) || !isValidIdentifier(fact.guideId)) {
        logger.warn('completion write: rejected fact with invalid identifier');
        reportCompletionWriteDegradation('enqueue-failed');
        return;
      }
      // Always enqueue+persist, even after a structural-404 disarm: the fact
      // survives to the next load and drains once the route exists. Only skip
      // scheduling a drain that would immediately no-op while network-disarmed.
      this.queue.enqueue(this.toBody(fact));
      if (!this.queue.isDisarmed()) {
        this.scheduleDrain(0);
      }
    } catch (error) {
      logger.warn('completion write: enqueue failed (ignored)', { error: String(error) });
      reportCompletionWriteDegradation('enqueue-failed');
    }
  }

  // Clamp descriptive/identifier fields at emission to the backend's byte bounds
  // (stripping control characters) so an oversized value can't fill the queue
  // and then be terminally rejected.
  private toBody(fact: CompletionFact): CompletionWriteBody {
    return {
      guideSource: normalizeField(fact.guideSource, MAX_ID_BYTES),
      guideId: normalizeField(fact.guideId, MAX_ID_BYTES),
      guideTitle: normalizeField(fact.guideTitle, MAX_TITLE_BYTES),
      guideCategory: fact.guideCategory,
      pathId: fact.pathId !== undefined ? normalizeField(fact.pathId, MAX_ID_BYTES) : undefined,
      completionPercent: fact.completionPercent,
      source: fact.source,
      completedAt: fact.completedAt,
      durationMs: fact.durationMs,
      platform: this.deps.platform(),
    };
  }

  private scheduleDrain(delayMs: number): void {
    if (this.disposed) {
      return;
    }
    const ms = Math.max(0, delayMs);
    const fireAt = this.deps.now() + ms;
    if (this.timer !== null) {
      if (this.timerFireAt !== null && fireAt >= this.timerFireAt) {
        return;
      }
      this.deps.clearTimer(this.timer);
    }
    this.timerFireAt = fireAt;
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      this.timerFireAt = null;
      void this.drain();
    }, ms);
  }

  private async drain(): Promise<void> {
    if (this.disposed || this.draining || !this.queue) {
      return;
    }
    this.draining = true;
    try {
      const result = await this.queue.processDue();
      if (result.disarmed) {
        this.suppressNetworkForSession();
      } else if (result.nextDelayMs !== null) {
        this.scheduleDrain(result.nextDelayMs);
      }
    } catch (error) {
      logger.warn('completion write: drain failed (ignored)', { error: String(error) });
      reportCompletionWriteDegradation('drain-failed');
    } finally {
      this.draining = false;
    }
  }
}

let controller: CompletionWriteController | null = null;

export function armCompletionWriteHook(overrides?: Partial<WriteHookDeps>): void {
  if (controller) {
    return;
  }
  controller = new CompletionWriteController({ ...defaultDeps, ...overrides });
  controller.start();
}

export function __resetCompletionWriteHookForTests(): void {
  controller?.dispose();
  controller = null;
}
