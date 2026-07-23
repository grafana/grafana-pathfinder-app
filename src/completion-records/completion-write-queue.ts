import { logger } from '../lib/logging';

import type { CompletionWriteBody, WriteOutcome } from './completion-write-client';
import { createCompletionEventId, type CompletionWriteStorage, type QueuedWrite } from './completion-write-storage';

export interface WriteQueueDeps {
  now: () => number;
  send: (body: CompletionWriteBody) => Promise<WriteOutcome>;
  storage: CompletionWriteStorage;
  nextId?: () => string;
  random?: () => number;
  maxSize?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

export interface ProcessResult {
  /** ms until the next item is due, or null when the queue is idle/empty. */
  nextDelayMs: number | null;
  /** true when a route-missing outcome disarmed the queue. */
  disarmed: boolean;
}

export interface WriteQueue {
  enqueue(body: CompletionWriteBody): boolean;
  processDue(): Promise<ProcessResult>;
  size(): number;
  isDisarmed(): boolean;
  snapshot(): QueuedWrite[];
  subscribe(listener: () => void): () => void;
}

const DEFAULT_MAX_SIZE = 100;
const DEFAULT_BASE_BACKOFF_MS = 1000;
const DEFAULT_MAX_BACKOFF_MS = 5 * 60 * 1000;

export function createWriteQueue(deps: WriteQueueDeps): WriteQueue {
  const now = deps.now;
  const send = deps.send;
  const storage = deps.storage;
  const nextId = deps.nextId ?? createCompletionEventId;
  const random = deps.random ?? Math.random;
  const maxSize = deps.maxSize ?? DEFAULT_MAX_SIZE;
  const baseBackoffMs = deps.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
  const maxBackoffMs = deps.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;

  let items: QueuedWrite[] = [];
  let disarmed = false;

  function refresh(): void {
    const loaded = storage.list().filter(isQueuedWrite).sort(compareQueuedWrites);
    while (loaded.length > maxSize) {
      const evicted = loaded.shift();
      if (evicted) {
        storage.remove(evicted.id);
      }
    }
    items = loaded;
  }

  refresh();

  function computeNextDelay(): number | null {
    if (items.length === 0) {
      return null;
    }
    const soonest = Math.min(...items.map((i) => i.nextAttemptAt));
    return Math.max(0, soonest - now());
  }

  function backoffMs(attempts: number, retryAfterMs?: number): number {
    if (retryAfterMs !== undefined && retryAfterMs >= 0) {
      return retryAfterMs;
    }
    const base = Math.min(maxBackoffMs, baseBackoffMs * Math.pow(2, Math.max(0, attempts - 1)));
    const jitter = base * 0.25 * (random() * 2 - 1);
    return Math.max(0, Math.round(base + jitter));
  }

  function enqueue(body: CompletionWriteBody): boolean {
    if (disarmed) {
      return false;
    }
    refresh();
    if (items.length >= maxSize) {
      const evicted = items.shift();
      if (evicted) {
        storage.remove(evicted.id);
        logger.debug('completion write: queue full, evicted oldest', { evictedId: evicted.id });
      }
    }
    const createdAt = now();
    const item = { id: nextId(), body, attempts: 0, createdAt, nextAttemptAt: createdAt };
    items.push(item);
    storage.put(item);
    return true;
  }

  async function processDue(): Promise<ProcessResult> {
    if (disarmed) {
      return { nextDelayMs: null, disarmed: true };
    }
    const lease = storage.acquireLease(now());
    if (!lease.acquired) {
      return { nextDelayMs: lease.retryAfterMs, disarmed: false };
    }
    try {
      refresh();
      return await processDueWithLease();
    } finally {
      storage.releaseLease();
    }
  }

  async function processDueWithLease(): Promise<ProcessResult> {
    const startNow = now();
    const due = items.filter((i) => i.nextAttemptAt <= startNow);

    for (const item of due) {
      // The item may have been removed by a concurrent pass; skip if gone.
      if (!items.includes(item)) {
        continue;
      }
      if (!storage.renewLease(now())) {
        return { nextDelayMs: computeNextDelay(), disarmed: false };
      }
      let outcome: WriteOutcome;
      try {
        outcome = await send(item.body);
      } catch {
        // A sender that rejects is treated as transient — it must never bubble.
        outcome = { kind: 'transient' };
      }

      if (outcome.kind === 'created') {
        remove(item);
        continue;
      }
      if (outcome.kind === 'route-missing') {
        disarmed = true;
        items = [];
        storage.clear();
        logger.debug('completion write: route missing, feature unavailable this session');
        return { nextDelayMs: null, disarmed: true };
      }
      if (outcome.kind === 'terminal') {
        remove(item);
        logger.debug('completion write: dropped terminal (non-retryable) record', { id: item.id });
        continue;
      }
      item.attempts += 1;
      item.nextAttemptAt = now() + backoffMs(item.attempts, outcome.retryAfterMs);
      storage.put(item);
    }

    return { nextDelayMs: computeNextDelay(), disarmed: false };
  }

  function remove(item: QueuedWrite): void {
    items = items.filter((i) => i !== item);
    storage.remove(item.id);
  }

  return {
    enqueue,
    processDue,
    size: () => items.length,
    isDisarmed: () => disarmed,
    snapshot: () => items.map((i) => ({ ...i })),
    subscribe: (listener) => storage.subscribe(listener),
  };
}

function isQueuedWrite(v: unknown): v is QueuedWrite {
  if (typeof v !== 'object' || v === null) {
    return false;
  }
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.attempts === 'number' &&
    typeof o.nextAttemptAt === 'number' &&
    typeof o.body === 'object' &&
    o.body !== null &&
    typeof o.createdAt === 'number'
  );
}

function compareQueuedWrites(a: QueuedWrite, b: QueuedWrite): number {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}
