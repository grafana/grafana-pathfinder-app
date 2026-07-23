/**
 * Browser-persisted retry queue for durable completion writes (Track 2).
 *
 * Design contract:
 *   - Bounded (oldest-first eviction at the cap) so a wedged backend can't grow
 *     localStorage without limit.
 *   - Exponential backoff + jitter between transient retries; honors an
 *     upstream Retry-After hint when present.
 *   - Terminal outcomes drop the item (debug-logged, never Faro-spammed).
 *   - A route-missing outcome disarms the whole queue: it clears itself and
 *     stops, since the feature is unavailable on this deployment.
 *   - Dedupe on the durable key (guideSource, guideId): emission is normalized
 *     upstream to one guide-kind fact per completion, so this guards the
 *     resume/re-completion case — a reload re-enqueue of a still-pending item.
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
  durableKey: string;
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
  maxAttempts?: number;
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
  enqueue(body: CompletionWriteBody, durableKey: string): boolean;
  processDue(): Promise<ProcessResult>;
  size(): number;
  isDisarmed(): boolean;
  snapshot(): QueuedWrite[];
}

const DEFAULT_MAX_SIZE = 100;
const DEFAULT_MAX_ATTEMPTS = 8;
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
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
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
    const base =
      retryAfterMs !== undefined && retryAfterMs >= 0
        ? Math.min(maxBackoffMs, retryAfterMs)
        : Math.min(maxBackoffMs, baseBackoffMs * Math.pow(2, Math.max(0, attempts - 1)));
    // ±25% jitter to avoid a synchronized retry stampede across queued items.
    const jitter = base * 0.25 * (random() * 2 - 1);
    return Math.max(0, Math.round(base + jitter));
  }

  function enqueue(body: CompletionWriteBody, durableKey: string): boolean {
    if (disarmed) {
      return false;
    }
    // Dedupe on the durable key: emission is normalized upstream to one
    // guide-kind fact per completion, so this guards the resume/re-completion
    // case — a reload re-enqueue of an item still pending from an earlier load.
    if (items.some((i) => i.durableKey === durableKey)) {
      logger.debug('completion write: dropped duplicate for durable key', { durableKey });
      return false;
    }
    if (items.length >= maxSize) {
      // Oldest-first eviction at the cap.
      const evicted = items.shift();
      logger.debug('completion write: queue full, evicted oldest', { evictedKey: evicted?.durableKey });
    }
    items.push({ id: nextId(), durableKey, body, attempts: 0, nextAttemptAt: now() });
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
        logger.debug('completion write: dropped terminal (non-retryable) record', { durableKey: item.durableKey });
        continue;
      }
      // transient
      item.attempts += 1;
      if (item.attempts >= maxAttempts) {
        remove(item);
        logger.debug('completion write: dropped after max retry attempts', {
          durableKey: item.durableKey,
          attempts: item.attempts,
        });
        continue;
      }
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
    typeof o.durableKey === 'string' &&
    typeof o.attempts === 'number' &&
    typeof o.nextAttemptAt === 'number' &&
    typeof o.body === 'object' &&
    o.body !== null
  );
}
