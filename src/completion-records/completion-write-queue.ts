/**
 * Browser-persisted retry queue for durable completion writes (Track 2).
 *
 * Design contract:
 *   - Bounded (oldest-first eviction at the cap) so a wedged backend can't grow
 *     localStorage without limit.
 *   - Exponential backoff + jitter between transient retries; an upstream
 *     Retry-After hint is honored exactly.
 *   - Terminal outcomes drop the item (debug-logged, never Faro-spammed).
 *   - A route-missing outcome disarms the whole queue: it clears itself and
 *     stops, since the feature is unavailable on this deployment.
 *
 * Durability boundary (RFC §6.9): a record is durable only once its POST lands.
 * The queue is a best-effort session-lifetime buffer — persisted so it survives
 * reloads within a session, but a session that ends with items still queued may
 * lose those not-yet-persisted writes. localStorage remains the user's own local
 * completion view regardless.
 *
 * The queue is a pure state machine driven by `processDue()`; the timer that
 * calls it lives in the hook. Every dependency (clock, sender, storage, RNG) is
 * injectable so the state machine is unit-testable without real time or network.
 */

import { logger } from '../lib/logging';
import { StorageKeys } from '../lib/storage-keys';

import type { CompletionWriteBody, WriteOutcome } from './completion-write-client';

export interface QueuedWrite {
  id: string;
  body: CompletionWriteBody;
  attempts: number;
  /** Epoch ms; the item is eligible to send once now >= nextAttemptAt. */
  nextAttemptAt: number;
}

export interface WriteQueueDeps {
  now: () => number;
  send: (body: CompletionWriteBody) => Promise<WriteOutcome>;
  random?: () => number;
  read?: () => string | null;
  write?: (value: string) => void;
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
}

const DEFAULT_MAX_SIZE = 100;
const DEFAULT_BASE_BACKOFF_MS = 1000;
const DEFAULT_MAX_BACKOFF_MS = 5 * 60 * 1000;

function defaultRead(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(StorageKeys.COMPLETION_WRITE_QUEUE);
  } catch {
    return null;
  }
}

function defaultWrite(value: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(StorageKeys.COMPLETION_WRITE_QUEUE, value);
    }
  } catch {
    // A full or unavailable localStorage must never break the completion path.
  }
}

export function createWriteQueue(deps: WriteQueueDeps): WriteQueue {
  const now = deps.now;
  const send = deps.send;
  const random = deps.random ?? Math.random;
  const read = deps.read ?? defaultRead;
  const write = deps.write ?? defaultWrite;
  const maxSize = deps.maxSize ?? DEFAULT_MAX_SIZE;
  const baseBackoffMs = deps.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
  const maxBackoffMs = deps.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;

  let items: QueuedWrite[] = load();
  let disarmed = false;
  let seq = 0;

  function load(): QueuedWrite[] {
    const raw = read();
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter(isQueuedWrite).slice(0, maxSize);
    } catch {
      return [];
    }
  }

  function persist(): void {
    write(JSON.stringify(items));
  }

  function nextId(): string {
    seq += 1;
    return `${now()}-${seq}`;
  }

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
    if (items.length >= maxSize) {
      const evicted = items.shift();
      logger.debug('completion write: queue full, evicted oldest', { evictedId: evicted?.id });
    }
    items.push({ id: nextId(), body, attempts: 0, nextAttemptAt: now() });
    persist();
    return true;
  }

  async function processDue(): Promise<ProcessResult> {
    if (disarmed) {
      return { nextDelayMs: null, disarmed: true };
    }
    const startNow = now();
    const due = items.filter((i) => i.nextAttemptAt <= startNow);

    for (const item of due) {
      // The item may have been removed by a concurrent pass; skip if gone.
      if (!items.includes(item)) {
        continue;
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
        persist();
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
    }

    persist();
    return { nextDelayMs: computeNextDelay(), disarmed: false };
  }

  function remove(item: QueuedWrite): void {
    items = items.filter((i) => i !== item);
  }

  return {
    enqueue,
    processDue,
    size: () => items.length,
    isDisarmed: () => disarmed,
    snapshot: () => items.map((i) => ({ ...i })),
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
    o.body !== null
  );
}
