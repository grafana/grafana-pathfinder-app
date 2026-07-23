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
import {
  createCompletionWriteStorage,
  currentCompletionQueueOwnerKey,
  type CompletionWriteStorage,
} from './completion-write-storage';
import type { CompletionFact } from './types';

export interface WriteHookDeps {
  send: (body: CompletionWriteBody) => Promise<WriteOutcome>;
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

  private onFact(fact: CompletionFact): void {
    try {
      if (this.disposed || !this.queue || this.queue.isDisarmed()) {
        return;
      }
      this.queue.enqueue(this.toBody(fact));
      this.scheduleDrain(0);
    } catch (error) {
      logger.debug('completion write: enqueue failed (ignored)', { error: String(error) });
    }
  }

  private toBody(fact: CompletionFact): CompletionWriteBody {
    return {
      guideSource: fact.guideSource,
      guideId: fact.guideId,
      guideTitle: fact.guideTitle,
      guideCategory: fact.guideCategory,
      pathId: fact.pathId,
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
        this.dispose();
      } else if (result.nextDelayMs !== null) {
        this.scheduleDrain(result.nextDelayMs);
      }
    } catch (error) {
      logger.debug('completion write: drain failed (ignored)', { error: String(error) });
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
