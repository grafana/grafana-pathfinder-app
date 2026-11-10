import { logger } from '../../lib/logging';
import { StorageKeys } from '../../lib/storage-keys';
import { evaluateFeatureFlag } from '../../utils/openfeature';
import type { AchievementEventsResponseWire } from '../../types/backend-api.schema';
import { onCompletionObserved } from '../completion-recorder';
import { MAX_ID_BYTES, isValidIdentifier, normalizeField } from '../completion-write-normalize';
import {
  createCompletionEventId,
  createQueueStorage,
  currentCompletionQueueOwnerKey,
  type QueueStorage,
} from '../completion-write-storage';
import type { CompletionFact } from '../types';

import { createEventQueue, type EventQueue } from './achievement-event-queue';
import { announceEvaluated } from './achievement-display';
import {
  ACHIEVEMENT_EVENT_SCHEMA_VERSION,
  postAchievementEvent,
  type AchievementEventBody,
  type EventOutcome,
} from './achievements-client';

export interface AchievementEventsDeps {
  enabled: () => Promise<boolean>;
  ownerKey: () => string | null;
  storage: (ownerKey: string) => QueueStorage<AchievementEventBody>;
  send: (body: AchievementEventBody) => Promise<EventOutcome>;
  onEvaluated: (response: AchievementEventsResponseWire) => void;
  newId: () => string;
  now: () => number;
  random: () => number;
  setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer: (handle: ReturnType<typeof setTimeout>) => void;
}

// Facts seen before the flag resolves wait here, as the RFC's early ring buffer does.
const MAX_BUFFERED_EVENTS = 50;

const defaultDeps: AchievementEventsDeps = {
  enabled: () => evaluateFeatureFlag('pathfinder.achievements'),
  ownerKey: currentCompletionQueueOwnerKey,
  storage: (ownerKey) => createQueueStorage<AchievementEventBody>(StorageKeys.ACHIEVEMENT_EVENT_QUEUE_PREFIX, ownerKey),
  send: postAchievementEvent,
  onEvaluated: (response) => void announceEvaluated(response),
  newId: createCompletionEventId,
  now: () => Date.now(),
  random: Math.random,
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle),
};

export function toGuideCompletedEvent(fact: CompletionFact, eventId: string, now: number): AchievementEventBody | null {
  if (fact.kind !== 'guide' || !isValidIdentifier(fact.guideSource) || !isValidIdentifier(fact.guideId)) {
    return null;
  }
  const completedAt = Date.parse(fact.completedAt);
  return {
    schemaVersion: ACHIEVEMENT_EVENT_SCHEMA_VERSION,
    eventId,
    entity: 'guides',
    action: 'completed',
    occurredAt: new Date(Number.isFinite(completedAt) ? completedAt : now).toISOString(),
    context: {
      guideSource: normalizeField(fact.guideSource, MAX_ID_BYTES),
      guideId: normalizeField(fact.guideId, MAX_ID_BYTES),
      guideCategory: fact.guideCategory,
      ...(fact.pathId !== undefined && { pathId: normalizeField(fact.pathId, MAX_ID_BYTES) }),
    },
  };
}

class AchievementEventsController {
  private queue: EventQueue | null = null;
  private buffered: AchievementEventBody[] = [];
  private enabled: boolean | null = null;
  private unsubscribeFacts: (() => void) | null = null;
  private unsubscribeStorage: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerFireAt: number | null = null;
  private draining = false;
  private disposed = false;

  constructor(
    private readonly deps: AchievementEventsDeps,
    private readonly ownerKey: string
  ) {}

  start(): void {
    this.unsubscribeFacts = onCompletionObserved((fact) => this.onFact(fact));
    void this.deps
      .enabled()
      .catch(() => false)
      .then((enabled) => this.resolveFlag(enabled));
  }

  discardQueued(): void {
    this.buffered = [];
    if (this.queue) {
      this.queue.clear();
    } else {
      this.deps.storage(this.ownerKey).clear();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribeFacts?.();
    this.unsubscribeStorage?.();
    if (this.timer !== null) {
      this.deps.clearTimer(this.timer);
    }
    this.timer = null;
  }

  private resolveFlag(enabled: boolean): void {
    if (this.disposed) {
      return;
    }
    this.enabled = enabled;
    const buffered = this.buffered;
    this.buffered = [];
    if (!enabled) {
      this.unsubscribeFacts?.();
      this.unsubscribeFacts = null;
      return;
    }
    this.queue = createEventQueue({
      now: this.deps.now,
      send: this.deps.send,
      storage: this.deps.storage(this.ownerKey),
      random: this.deps.random,
      onEvaluated: this.deps.onEvaluated,
    });
    this.unsubscribeStorage = this.queue.subscribe(() => this.scheduleDrain(0));
    for (const body of buffered) {
      this.queue.enqueue(body);
    }
    this.scheduleDrain(0);
  }

  private onFact(fact: CompletionFact): void {
    if (this.disposed || this.enabled === false) {
      return;
    }
    const body = toGuideCompletedEvent(fact, this.deps.newId(), this.deps.now());
    if (!body) {
      return;
    }
    if (!this.queue) {
      if (this.buffered.length < MAX_BUFFERED_EVENTS) {
        this.buffered.push(body);
      }
      return;
    }
    this.queue.enqueue(body);
    if (!this.queue.isDisarmed()) {
      this.scheduleDrain(0);
    }
  }

  private scheduleDrain(delayMs: number): void {
    if (this.disposed || this.queue?.isDisarmed()) {
      return;
    }
    const fireAt = this.deps.now() + Math.max(0, delayMs);
    if (this.timer !== null) {
      if (this.timerFireAt !== null && fireAt >= this.timerFireAt) {
        return;
      }
      this.deps.clearTimer(this.timer);
    }
    this.timerFireAt = fireAt;
    this.timer = this.deps.setTimer(
      () => {
        this.timer = null;
        this.timerFireAt = null;
        void this.drain();
      },
      Math.max(0, delayMs)
    );
  }

  private async drain(): Promise<void> {
    if (this.disposed || this.draining || !this.queue) {
      return;
    }
    this.draining = true;
    try {
      const result = await this.queue.processDue();
      if (result.disarmed) {
        this.unsubscribeStorage?.();
        this.unsubscribeStorage = null;
      } else if (result.nextDelayMs !== null) {
        this.scheduleDrain(result.nextDelayMs);
      }
    } catch (error) {
      logger.warn('achievement events: drain failed (ignored)', { error: String(error) });
    } finally {
      this.draining = false;
    }
  }
}

let controller: AchievementEventsController | null = null;

export function armAchievementEvents(overrides?: Partial<AchievementEventsDeps>): void {
  if (controller) {
    return;
  }
  const deps = { ...defaultDeps, ...overrides };
  const ownerKey = deps.ownerKey();
  if (!ownerKey) {
    return;
  }
  controller = new AchievementEventsController(deps, ownerKey);
  controller.start();
}

/** Backs "Reset all learning progress": unsent events for the guides being reset are the user's to withdraw. */
export function discardQueuedAchievementEvents(overrides?: Partial<AchievementEventsDeps>): void {
  if (controller) {
    controller.discardQueued();
    return;
  }
  const deps = { ...defaultDeps, ...overrides };
  const ownerKey = deps.ownerKey();
  if (ownerKey) {
    deps.storage(ownerKey).clear();
  }
}

export function __resetAchievementEventsForTests(): void {
  controller?.dispose();
  controller = null;
}
