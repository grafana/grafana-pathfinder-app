import { logger } from '../lib/logging';

import type { CompletionWriteBody, WriteOutcome } from './completion-write-client';
import { reportCompletionWriteDegradation } from './completion-write-telemetry';
import { DRAIN_BUDGET_PER_PASS, MAX_RETENTION_MS } from './completion-write-timing';
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
  /** Max sends per leased pass. Defaults to DRAIN_BUDGET_PER_PASS. */
  drainBudget?: number;
  /** Retention horizon in ms; older items are dropped. Defaults to MAX_RETENTION_MS. */
  maxRetentionMs?: number;
}

export interface ProcessResult {
  /** ms until the next item is due, or null when the queue is idle/empty. */
  nextDelayMs: number | null;
  /** true when a route-missing outcome disarmed the queue. */
  disarmed: boolean;
}

export interface WriteQueue {
  enqueue(body: CompletionWriteBody): void;
  processDue(): Promise<ProcessResult>;
  size(): number;
  isDisarmed(): boolean;
  snapshot(): QueuedWrite[];
  subscribe(listener: () => void): () => void;
  /** Drop every queued record, in memory and in storage. */
  clear(): void;
}

// 100 is a PER-TAB, eventually-global bound for MVP: each tab enforces it
// against its own in-memory snapshot and persists under a shared owner prefix,
// so N disarmed tabs can transiently persist up to ~N×100 keys until a drain
// reconciles. Documented honestly rather than made strictly global (localStorage
// has no atomic multi-key transaction) — see `disarmed-shared-queue-bound`.
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
  const drainBudget = deps.drainBudget ?? DRAIN_BUDGET_PER_PASS;
  const maxRetentionMs = deps.maxRetentionMs ?? MAX_RETENTION_MS;

  let items: QueuedWrite[] = [];
  let disarmed = false;
  // The item whose POST is currently in flight. Pinned so a concurrent
  // at-capacity enqueue() cannot evict it — otherwise a transient result would
  // re-persist an item no longer in the in-memory queue, transiently exceeding
  // the cap and letting another tab observe/drain it — see `queue-eviction-concurrency`.
  let inFlightId: string | null = null;

  function isExpired(item: QueuedWrite): boolean {
    const completedAtMs = Date.parse(item.body.completedAt);
    const referenceMs = Number.isFinite(completedAtMs) ? completedAtMs : item.createdAt;
    return now() - referenceMs > maxRetentionMs;
  }

  // Only ever called under the lease (from processDue). Constructing the queue
  // deliberately does NOT refresh: that would scan every key in the origin, and
  // JSON.parse each match, on every page load — and its expiry/over-cap
  // `storage.remove()` calls would be the only mutations happening unleased.
  // The first scheduled drain reconciles instead.
  function refresh(): void {
    const loaded = storage.list().filter(isQueuedWrite).sort(compareQueuedWrites);
    // Drop records past the retention horizon: the backend would terminally
    // reject the replay, so retaining them only wastes the bounded queue.
    for (let i = loaded.length - 1; i >= 0; i--) {
      if (isExpired(loaded[i]!)) {
        const [expired] = loaded.splice(i, 1);
        if (expired) {
          storage.remove(expired.id);
          logger.warn('completion write: dropped record past retention horizon', { id: expired.id });
          reportCompletionWriteDegradation('expired-drop');
        }
      }
    }
    while (loaded.length > maxSize) {
      const evicted = loaded.shift();
      if (evicted) {
        storage.remove(evicted.id);
        logger.warn('completion write: load-time eviction over cap', { id: evicted.id });
        reportCompletionWriteDegradation('eviction');
      }
    }
    items = loaded;
  }

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

  function enqueue(body: CompletionWriteBody): void {
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
      // Evict the oldest item that is NOT in flight — evicting the pending one
      // would let a transient result re-persist a record absent from `items`.
      const evictIndex = items.findIndex((i) => i.id !== inFlightId);
      if (evictIndex >= 0) {
        const [evicted] = items.splice(evictIndex, 1);
        if (evicted) {
          storage.remove(evicted.id);
          logger.warn('completion write: queue full, evicted oldest', { evictedId: evicted.id });
          reportCompletionWriteDegradation('eviction');
        }
      }
    }
    const createdAt = now();
    const item = { id: nextId(), body, attempts: 0, createdAt, nextAttemptAt: createdAt };
    items.push(item);
    storage.put(item);
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

    let sent = 0;
    for (const item of due) {
      // Cap sends per pass and release the lease between passes so one tab with
      // a full queue cannot monopolize it. Reschedule immediately (0ms) so the
      // remaining due items drain on the next lease acquisition.
      if (sent >= drainBudget) {
        return { nextDelayMs: 0, disarmed: false };
      }
      // `items` can be mutated mid-drain (a concurrent enqueue evicts, or a
      // storage-event refresh replaces it); match by id so an item removed
      // since the snapshot is skipped rather than double-sent.
      if (!items.some((i) => i.id === item.id)) {
        continue;
      }
      // Drop records past the retention horizon rather than POST a guaranteed
      // terminal rejection.
      if (isExpired(item)) {
        remove(item);
        logger.warn('completion write: dropped record past retention horizon', { id: item.id });
        reportCompletionWriteDegradation('expired-drop');
        continue;
      }
      if (!storage.renewLease(now())) {
        return { nextDelayMs: computeNextDelay(), disarmed: false };
      }
      let outcome: WriteOutcome;
      inFlightId = item.id;
      try {
        // Renew right before the send and pass the item's stable id as the
        // idempotency key. The request is bounded below the lease TTL
        // (WRITE_REQUEST_TIMEOUT_MS) so the client stops awaiting the POST before
        // the lease expires, keeping the in-flight window inside one lease. The
        // client can't prove the server stopped, so the stable key is the true
        // end-to-end backstop: a re-POST after lease takeover dedupes to one record.
        outcome = await send(item.body, item.id);
      } catch {
        // A sender that rejects is treated as transient — it must never bubble.
        outcome = { kind: 'transient' };
      } finally {
        inFlightId = null;
      }
      sent += 1;

      if (outcome.kind === 'created') {
        remove(item);
        continue;
      }
      if (outcome.kind === 'route-missing' || outcome.kind === 'forbidden') {
        // Both are conditions of the environment, not of the record: the route
        // is not served here (404), or this identity holds no grant for it
        // (403). Session-only disarm — items stay persisted so a later load
        // drains them once the route exists or the grant lands. They report
        // distinct reasons so an ungranted stack, which would otherwise just
        // accumulate silently, is distinguishable from a stack missing the route.
        disarmed = true;
        if (outcome.kind === 'forbidden') {
          logger.warn('completion write: forbidden (403) — retaining records, identity not granted this route');
          reportCompletionWriteDegradation('forbidden-hold');
        } else {
          logger.warn('completion write: route missing, feature unavailable this session');
          reportCompletionWriteDegradation('route-missing');
        }
        return { nextDelayMs: null, disarmed: true };
      }
      if (outcome.kind === 'terminal') {
        remove(item);
        logger.warn('completion write: dropped terminal (non-retryable) record', { id: item.id });
        reportCompletionWriteDegradation('terminal-drop');
        continue;
      }
      // Re-check membership before re-persisting: `clear()` (a progress reset)
      // or an eviction can land while the POST is in flight, and an unguarded
      // put would resurrect a record that is no longer in the queue.
      if (!items.some((i) => i.id === item.id)) {
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

  function clear(): void {
    items = [];
    storage.clear();
  }

  return {
    enqueue,
    processDue,
    size: () => items.length,
    isDisarmed: () => disarmed,
    snapshot: () => items.map((i) => ({ ...i })),
    subscribe: (listener) => storage.subscribe(listener),
    clear,
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
