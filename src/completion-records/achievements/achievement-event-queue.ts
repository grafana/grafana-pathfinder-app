import { logger } from '../../lib/logging';
import type { AchievementEventsResponseWire } from '../../types/backend-api.schema';
import { DRAIN_BUDGET_PER_PASS, MAX_RETENTION_MS } from '../completion-write-timing';
import type { QueuedItem, QueueStorage } from '../completion-write-storage';

import type { AchievementEventBody, EventOutcome } from './achievements-client';

export type QueuedEvent = QueuedItem<AchievementEventBody>;

export interface EventQueueDeps {
  now: () => number;
  send: (body: AchievementEventBody) => Promise<EventOutcome>;
  storage: QueueStorage<AchievementEventBody>;
  random?: () => number;
  /** Fired for every 200, including `retry: true`, which can still carry awards. */
  onEvaluated?: (response: AchievementEventsResponseWire) => void;
}

export interface EventProcessResult {
  nextDelayMs: number | null;
  disarmed: boolean;
}

export interface EventQueue {
  enqueue(body: AchievementEventBody): boolean;
  processDue(): Promise<EventProcessResult>;
  isDisarmed(): boolean;
  snapshot(): QueuedEvent[];
  subscribe(listener: () => void): () => void;
}

// The completion write queue's bounds (RFC §6.6).
export const MAX_QUEUED_EVENTS = 100;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

export function createEventQueue(deps: EventQueueDeps): EventQueue {
  const { now, send, storage, onEvaluated } = deps;
  const random = deps.random ?? Math.random;
  let items: QueuedEvent[] = [];
  let disarmed = false;
  let inFlightId: string | null = null;

  function isExpired(item: QueuedEvent): boolean {
    const occurredMs = Date.parse(item.body.occurredAt);
    return now() - (Number.isFinite(occurredMs) ? occurredMs : item.createdAt) > MAX_RETENTION_MS;
  }

  function backoffMs(attempts: number): number {
    const base = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, Math.max(0, attempts - 1)));
    const jitter = base * 0.25 * (random() * 2 - 1);
    return Math.max(0, Math.min(MAX_BACKOFF_MS, Math.round(base + jitter)));
  }

  function remove(item: QueuedEvent): void {
    items = items.filter((i) => i.id !== item.id);
    storage.remove(item.id);
  }

  function evictOverCap(): void {
    while (items.length > MAX_QUEUED_EVENTS) {
      const index = items.findIndex((i) => i.id !== inFlightId);
      if (index < 0) {
        return;
      }
      const [evicted] = items.splice(index, 1);
      if (evicted) {
        storage.remove(evicted.id);
        logger.warn('achievement events: queue full, dropped the oldest event');
      }
    }
  }

  function refresh(): void {
    items = storage
      .list()
      .filter(isQueuedEvent)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    for (const item of items.filter(isExpired)) {
      remove(item);
    }
    evictOverCap();
  }

  function enqueue(body: AchievementEventBody): boolean {
    const createdAt = now();
    const item: QueuedEvent = { id: body.eventId, body, attempts: 0, createdAt, nextAttemptAt: createdAt };
    const persisted = storage.put(item);
    items = [...items.filter((i) => i.id !== item.id), item];
    evictOverCap();
    return persisted;
  }

  function computeNextDelay(): number | null {
    if (items.length === 0) {
      return null;
    }
    return Math.max(0, Math.min(...items.map((i) => i.nextAttemptAt)) - now());
  }

  function retryLater(item: QueuedEvent): void {
    if (!items.some((i) => i.id === item.id)) {
      return;
    }
    item.attempts += 1;
    item.nextAttemptAt = now() + backoffMs(item.attempts);
    storage.put(item);
  }

  async function drainLeased(): Promise<EventProcessResult> {
    const startedAt = now();
    const due = items.filter((i) => i.nextAttemptAt <= startedAt);
    let sent = 0;
    for (const item of due) {
      if (sent >= DRAIN_BUDGET_PER_PASS) {
        return { nextDelayMs: 0, disarmed: false };
      }
      if (!items.some((i) => i.id === item.id)) {
        continue;
      }
      if (isExpired(item)) {
        remove(item);
        continue;
      }
      if (!storage.renewLease(now())) {
        return { nextDelayMs: computeNextDelay(), disarmed: false };
      }
      let outcome: EventOutcome;
      inFlightId = item.id;
      try {
        outcome = await send(item.body);
      } catch {
        outcome = { kind: 'transient' };
      } finally {
        inFlightId = null;
      }
      sent += 1;

      switch (outcome.kind) {
        case 'evaluated':
          if (outcome.response.retry) {
            retryLater(item);
          } else {
            remove(item);
          }
          try {
            onEvaluated?.(outcome.response);
          } catch (error) {
            logger.warn('achievement events: evaluated listener threw', { error: String(error) });
          }
          break;
        case 'terminal':
          remove(item);
          logger.warn('achievement events: dropped an event the route rejected');
          break;
        case 'route-missing':
        case 'forbidden':
          disarmed = true;
          logger.info('achievement events: unavailable on this stack, holding the queue for a later load', {
            reason: outcome.kind,
          });
          return { nextDelayMs: null, disarmed: true };
        case 'transient':
          retryLater(item);
          break;
      }
    }
    return { nextDelayMs: computeNextDelay(), disarmed: false };
  }

  async function processDue(): Promise<EventProcessResult> {
    if (disarmed) {
      return { nextDelayMs: null, disarmed: true };
    }
    const lease = storage.acquireLease(now());
    if (!lease.acquired) {
      return { nextDelayMs: lease.retryAfterMs, disarmed: false };
    }
    try {
      refresh();
      return await drainLeased();
    } finally {
      storage.releaseLease();
    }
  }

  return {
    enqueue,
    processDue,
    isDisarmed: () => disarmed,
    snapshot: () => items.map((i) => ({ ...i })),
    subscribe: (listener) => storage.subscribe(listener),
  };
}

function isQueuedEvent(value: unknown): value is QueuedEvent {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const item = value as Partial<QueuedEvent>;
  return (
    typeof item.id === 'string' &&
    typeof item.attempts === 'number' &&
    typeof item.nextAttemptAt === 'number' &&
    typeof item.createdAt === 'number' &&
    typeof item.body === 'object' &&
    item.body !== null &&
    typeof item.body.eventId === 'string' &&
    item.body.eventId === item.id
  );
}
