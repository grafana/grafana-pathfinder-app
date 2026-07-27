import { logger } from '../lib/logging';

import type { CompletionWriteBody, WriteOutcome } from './completion-write-client';
import { createCompletionEventId, type CompletionWriteStorage, type QueuedWrite } from './completion-write-storage';

export interface WriteQueueDeps {
  now: () => number;
  send: (body: CompletionWriteBody, idempotencyKey: string) => Promise<WriteOutcome>;
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

  function backoffMs(attempts: number): number {
    const base = Math.min(maxBackoffMs, baseBackoffMs * Math.pow(2, Math.max(0, attempts - 1)));
    const jitter = base * 0.25 * (random() * 2 - 1);
    // Clamp AFTER jitter so `maxBackoffMs` is a true ceiling — adding ±25% to an
    // already-capped base would otherwise let a delay reach 1.25× the cap.
    return Math.max(0, Math.min(maxBackoffMs, Math.round(base + jitter)));
  }

  function enqueue(body: CompletionWriteBody): boolean {
    // A structural-404 disarm suppresses network drains for the session but must
    // NOT stop persistence: later facts still enqueue and survive to the next
    // load, where they drain once the route exists. Never gate enqueue on it.
    //
    // No refresh() here: reconciling against every stored item is an
    // origin-wide localStorage scan, and this runs inline on the completion
    // emission path. Eviction is enforced against the in-memory queue (bounded
    // by maxSize) and the O(1) put persists the fact; the async drain does the
    // full cross-tab refresh off this stack.
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
      // A mid-drain enqueue() refresh() replaces `items` with freshly parsed
      // copies; match by id so still-pending items are neither skipped nor
      // ghosted after removal.
      if (!items.some((i) => i.id === item.id)) {
        continue;
      }
      if (!storage.renewLease(now())) {
        return { nextDelayMs: computeNextDelay(), disarmed: false };
      }
      let outcome: WriteOutcome;
      try {
        // Renew right before the send and pass the item's stable id as the
        // idempotency key. With the request bounded below the lease TTL
        // (WRITE_REQUEST_TIMEOUT_MS), the POST cannot outlive this lease, so no
        // other tab can acquire and re-POST it while it is in flight; the key is
        // the end-to-end backstop if a succeeded POST's response is lost.
        outcome = await send(item.body, item.id);
      } catch {
        // A sender that rejects is treated as transient — it must never bubble.
        outcome = { kind: 'transient' };
      }

      if (outcome.kind === 'created') {
        remove(item);
        continue;
      }
      if (outcome.kind === 'route-missing') {
        // Session-only disarm: items stay persisted so the next app load can
        // drain them once the route exists (deployment skew is transient).
        disarmed = true;
        logger.debug('completion write: route missing, feature unavailable this session');
        return { nextDelayMs: null, disarmed: true };
      }
      if (outcome.kind === 'terminal') {
        remove(item);
        logger.debug('completion write: dropped terminal (non-retryable) record', { id: item.id });
        continue;
      }
      item.attempts += 1;
      item.nextAttemptAt = now() + backoffMs(item.attempts);
      storage.put(item);
    }

    return { nextDelayMs: computeNextDelay(), disarmed: false };
  }

  function remove(item: QueuedWrite): void {
    items = items.filter((i) => i.id !== item.id);
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
