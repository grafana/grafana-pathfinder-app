/**
 * Unit tests for the durable-write retry queue state machine. All dependencies
 * (clock, sender, storage, RNG) are injected, so these exercise the transitions
 * directly with no real time or network. `import type` keeps the @grafana/runtime
 * client module out of this suite entirely.
 */
jest.mock('./completion-write-telemetry', () => ({ reportCompletionWriteDegradation: jest.fn() }));

import { createWriteQueue as createRawWriteQueue, type WriteQueueDeps } from './completion-write-queue';
import type { CompletionWriteBody, WriteOutcome } from './completion-write-client';
import type { CompletionWriteStorage, QueuedWrite } from './completion-write-storage';
import { reportCompletionWriteDegradation } from './completion-write-telemetry';

const degradationMock = reportCompletionWriteDegradation as jest.Mock;

function body(overrides: Partial<CompletionWriteBody> = {}): CompletionWriteBody {
  return {
    guideSource: 'bundled',
    guideId: 'g1',
    guideTitle: 'G1',
    guideCategory: 'interactive',
    completionPercent: 100,
    source: 'objectives',
    completedAt: '2026-07-20T00:00:00.000Z',
    platform: 'cloud',
    ...overrides,
  };
}

interface Sender {
  send: (b: CompletionWriteBody, idempotencyKey: string) => Promise<WriteOutcome>;
  calls: CompletionWriteBody[];
  keys: string[];
}

// sender replays `outcomes` in order, repeating the last one once exhausted.
function makeSender(outcomes: WriteOutcome[]): Sender {
  const calls: CompletionWriteBody[] = [];
  const keys: string[] = [];
  let i = 0;
  return {
    calls,
    keys,
    send: async (b, idempotencyKey) => {
      calls.push(b);
      keys.push(idempotencyKey);
      const out = outcomes[Math.min(i, outcomes.length - 1)] ?? { kind: 'created' };
      i += 1;
      return out;
    },
  };
}

// Tests that don't inject storage fall through to the real jsdom localStorage,
// which persists across tests in a file — clear it so cases stay isolated.
beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // no-op
  }
});

function makeStorage(items = new Map<string, QueuedWrite>()) {
  const listeners = new Set<() => void>();
  const storage: CompletionWriteStorage = {
    list: () => Array.from(items.values()).map((item) => ({ ...item })),
    put: (item) => {
      items.set(item.id, { ...item });
      listeners.forEach((listener) => listener());
    },
    remove: (id) => {
      items.delete(id);
      listeners.forEach((listener) => listener());
    },
    clear: () => {
      items.clear();
      listeners.forEach((listener) => listener());
    },
    acquireLease: () => ({ acquired: true, retryAfterMs: 0 }),
    renewLease: () => true,
    releaseLease: () => undefined,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    storage,
    items,
  };
}

function createWriteQueue(deps: Omit<WriteQueueDeps, 'storage'> & { storage?: CompletionWriteStorage }) {
  const { storage = makeStorage().storage, ...rest } = deps;
  return createRawWriteQueue({ ...rest, storage });
}

describe('write queue — enqueue and eviction', () => {
  it('enqueues and, on created, removes the item', async () => {
    const s = makeSender([{ kind: 'created' }]);
    const q = createWriteQueue({ now: () => 0, send: s.send });
    q.enqueue(body());
    expect(q.size()).toBe(1);

    const r = await q.processDue();
    expect(s.calls).toHaveLength(1);
    expect(q.size()).toBe(0);
    expect(r.nextDelayMs).toBeNull();
    expect(r.disarmed).toBe(false);
  });

  it('keeps repeated completions as distinct events', async () => {
    const s = makeSender([{ kind: 'created' }]);
    const q = createWriteQueue({ now: () => 0, send: s.send });
    const first = body({ completedAt: '2026-07-20T00:00:00.000Z' });
    const replay = body({ completedAt: '2026-07-20T01:00:00.000Z' });

    q.enqueue(first);
    q.enqueue(replay);
    expect(q.size()).toBe(2);
  });

  it('evicts oldest-first at the cap', () => {
    const s = makeSender([{ kind: 'created' }]);
    const ids = ['a', 'b', 'c'];
    const q = createWriteQueue({ now: () => 0, send: s.send, maxSize: 2, nextId: () => ids.shift()! });
    q.enqueue(body({ guideId: 'a' }));
    q.enqueue(body({ guideId: 'b' }));
    q.enqueue(body({ guideId: 'c' }));
    expect(q.size()).toBe(2);
    expect(q.snapshot().map((i) => i.body.guideId)).toEqual(['b', 'c']);
  });
});

describe('write queue — retry/backoff/terminal/disarm', () => {
  it('transient increments attempts and reschedules with backoff', async () => {
    let clock = 0;
    const s = makeSender([{ kind: 'transient' }, { kind: 'created' }]);
    const q = createWriteQueue({
      now: () => clock,
      send: s.send,
      random: () => 0.5, // zero jitter
      baseBackoffMs: 1000,
    });
    q.enqueue(body());

    const r1 = await q.processDue();
    expect(q.size()).toBe(1);
    expect(r1.nextDelayMs).toBe(1000); // base * 2^0
    expect(q.snapshot()[0]!.attempts).toBe(1);

    // Not yet due.
    clock = 999;
    await q.processDue();
    expect(s.calls).toHaveLength(1);

    // Due → retried and, on created, removed.
    clock = 1000;
    const r2 = await q.processDue();
    expect(s.calls).toHaveLength(2);
    expect(q.size()).toBe(0);
    expect(r2.nextDelayMs).toBeNull();
  });

  it('drops a terminal record without retry', async () => {
    const s = makeSender([{ kind: 'terminal' }]);
    const q = createWriteQueue({ now: () => 0, send: s.send });
    q.enqueue(body());
    const r = await q.processDue();
    expect(q.size()).toBe(0);
    expect(r.disarmed).toBe(false);
  });

  it('retains a transient write beyond eight attempts', async () => {
    let clock = 0;
    const s = makeSender([{ kind: 'transient' }]);
    const q = createWriteQueue({
      now: () => clock,
      send: s.send,
      random: () => 0.5,
      baseBackoffMs: 1,
      maxBackoffMs: 10,
    });
    q.enqueue(body());
    for (let i = 0; i < 9; i++) {
      await q.processDue();
      clock += 100; // always past the next backoff
    }
    expect(q.size()).toBe(1);
    expect(s.calls).toHaveLength(9);
  });

  it('route-missing disarms network drains but keeps persisting later facts', async () => {
    const memory = makeStorage();
    const s = makeSender([{ kind: 'route-missing' }]);
    const q = createWriteQueue({ now: () => 0, send: s.send, storage: memory.storage });
    q.enqueue(body({ guideId: 'a' }));
    q.enqueue(body({ guideId: 'b' }));
    const r = await q.processDue();
    expect(r.disarmed).toBe(true);
    expect(q.isDisarmed()).toBe(true);
    // A later fact in the same session STILL enqueues and persists — a structural
    // 404 suppresses network drains, it is never a per-item drop.
    q.enqueue(body({ guideId: 'c' }));
    // All three items survive for a later session's startup drain.
    expect(memory.storage.list()).toHaveLength(3);
    // Network stays off: no further send this session.
    expect(s.calls).toHaveLength(1);
  });

  it('forbidden (403) retains the record instead of dropping it, and disarms the session', async () => {
    // The regression: 403 used to classify as terminal, so the first attempt
    // destroyed a completion that a later grant would have accepted.
    const memory = makeStorage();
    const s = makeSender([{ kind: 'forbidden' }]);
    const q = createWriteQueue({ now: () => 0, send: s.send, storage: memory.storage });
    q.enqueue(body({ guideId: 'a' }));
    q.enqueue(body({ guideId: 'b' }));

    const r = await q.processDue();

    expect(r.disarmed).toBe(true);
    expect(q.isDisarmed()).toBe(true);
    // Nothing dropped: both survive for a later session, once the grant lands.
    expect(q.size()).toBe(2);
    expect(memory.storage.list()).toHaveLength(2);
    expect(s.calls).toHaveLength(1);
  });

  it('reports forbidden-hold, not route-missing, so an ungranted stack is discoverable', async () => {
    // The keep-path is silent growth unless it says which condition engaged it.
    degradationMock.mockClear();
    const s = makeSender([{ kind: 'forbidden' }]);
    const q = createWriteQueue({ now: () => 0, send: s.send, storage: makeStorage().storage });
    q.enqueue(body());

    await q.processDue();

    expect(degradationMock).toHaveBeenCalledWith('forbidden-hold');
    expect(degradationMock).not.toHaveBeenCalledWith('route-missing');
    expect(degradationMock).not.toHaveBeenCalledWith('terminal-drop');
  });

  it('still reports route-missing for a 404, keeping the two conditions apart', async () => {
    degradationMock.mockClear();
    const s = makeSender([{ kind: 'route-missing' }]);
    const q = createWriteQueue({ now: () => 0, send: s.send, storage: makeStorage().storage });
    q.enqueue(body());

    await q.processDue();

    expect(degradationMock).toHaveBeenCalledWith('route-missing');
    expect(degradationMock).not.toHaveBeenCalledWith('forbidden-hold');
  });

  it('forbidden keeps persisting later facts, exactly as route-missing does', async () => {
    const memory = makeStorage();
    const s = makeSender([{ kind: 'forbidden' }]);
    const q = createWriteQueue({ now: () => 0, send: s.send, storage: memory.storage });
    q.enqueue(body({ guideId: 'a' }));
    await q.processDue();

    q.enqueue(body({ guideId: 'c' }));

    expect(memory.storage.list()).toHaveLength(2);
    expect(s.calls).toHaveLength(1);
  });

  it('a rejecting sender is treated as transient, never bubbling', async () => {
    const q = createWriteQueue({
      now: () => 0,
      send: async () => {
        throw new Error('boom');
      },
      random: () => 0.5,
    });
    q.enqueue(body());
    await expect(q.processDue()).resolves.toEqual(expect.objectContaining({ disarmed: false }));
    expect(q.size()).toBe(1); // retained for retry
  });
});

describe('write queue — persistence', () => {
  it('waits for another tab lease without sending', async () => {
    const memory = makeStorage();
    memory.storage.acquireLease = () => ({ acquired: false, retryAfterMs: 12_000 });
    const sender = makeSender([{ kind: 'created' }]);
    const queue = createWriteQueue({ now: () => 0, send: sender.send, storage: memory.storage });
    queue.enqueue(body());

    await expect(queue.processDue()).resolves.toEqual({ nextDelayMs: 12_000, disarmed: false });
    expect(sender.calls).toHaveLength(0);
    expect(queue.size()).toBe(1);
  });

  it('stops draining when the lease is lost mid-drain', async () => {
    const storage = makeStorage();
    let held = true;
    storage.storage.renewLease = () => held;
    const sender = makeSender([{ kind: 'created' }]);
    const queue = createWriteQueue({ now: () => 0, send: sender.send, storage: storage.storage });
    queue.enqueue(body({ guideId: 'a' }));
    queue.enqueue(body({ guideId: 'b' }));
    held = false;

    await queue.processDue();

    expect(sender.calls).toHaveLength(0);
    expect(queue.size()).toBe(2);
  });

  it('renews the lease before each drained item', async () => {
    const storage = makeStorage();
    let renewals = 0;
    storage.storage.renewLease = () => {
      renewals += 1;
      return true;
    };
    const sender = makeSender([{ kind: 'created' }]);
    const queue = createWriteQueue({ now: () => 0, send: sender.send, storage: storage.storage });
    queue.enqueue(body({ guideId: 'a' }));
    queue.enqueue(body({ guideId: 'b' }));

    await queue.processDue();

    expect(renewals).toBe(2);
    expect(sender.calls).toHaveLength(2);
    expect(queue.size()).toBe(0);
  });

  it('persists pending items and reloads them into a fresh queue', async () => {
    const storage = makeStorage();
    const s1 = makeSender([{ kind: 'transient' }]);
    const q1 = createWriteQueue({
      now: () => 0,
      send: s1.send,
      storage: storage.storage,
      random: () => 0.5,
    });
    q1.enqueue(body());
    await q1.processDue(); // transient → still queued, persisted
    expect(q1.size()).toBe(1);

    const s2 = makeSender([{ kind: 'created' }]);
    const q2 = createWriteQueue({ now: () => 1_000_000, send: s2.send, storage: storage.storage });
    expect(q2.size()).toBe(1); // reloaded
    q2.enqueue(body({ completedAt: '2026-07-20T01:00:00.000Z' }));
    expect(q2.size()).toBe(2);
  });

  it('tolerates corrupt persisted state', () => {
    const storage = makeStorage();
    storage.items.set('bad', {} as never);
    const q = createWriteQueue({ now: () => 0, send: makeSender([]).send, storage: storage.storage });
    expect(q.size()).toBe(0);
  });

  it('merges independently enqueued events from two tabs before draining', async () => {
    const shared = new Map<string, QueuedWrite>();
    const storageA = makeStorage(shared);
    const storageB = makeStorage(shared);
    const sender = makeSender([{ kind: 'created' }]);
    const queueA = createWriteQueue({
      now: () => 0,
      send: sender.send,
      storage: storageA.storage,
      nextId: () => 'a',
    });
    const queueB = createWriteQueue({
      now: () => 0,
      send: sender.send,
      storage: storageB.storage,
      nextId: () => 'b',
    });

    queueA.enqueue(body({ guideId: 'a' }));
    queueB.enqueue(body({ guideId: 'b' }));
    await queueA.processDue();

    expect(sender.calls.map((entry) => entry.guideId).sort()).toEqual(['a', 'b']);
    expect(shared.size).toBe(0);
  });
});

// A lease-aware in-memory storage modeling the real 30s TTL so a genuinely
// expired lease can be taken over by another tab.
function makeLeasedStorage(
  items: Map<string, QueuedWrite>,
  leaseRef: { lease: { tabId: string; expiresAt: number } | null },
  tabId: string
): CompletionWriteStorage {
  const LEASE_TTL = 30_000;
  const listeners = new Set<() => void>();
  return {
    list: () => Array.from(items.values()).map((i) => ({ ...i })),
    put: (item) => {
      items.set(item.id, { ...item });
      listeners.forEach((l) => l());
    },
    remove: (id) => {
      items.delete(id);
      listeners.forEach((l) => l());
    },
    clear: () => items.clear(),
    acquireLease: (now) => {
      const cur = leaseRef.lease;
      if (cur && cur.tabId !== tabId && cur.expiresAt > now) {
        return { acquired: false, retryAfterMs: cur.expiresAt - now };
      }
      leaseRef.lease = { tabId, expiresAt: now + LEASE_TTL };
      return { acquired: true, retryAfterMs: 0 };
    },
    renewLease: (now) => {
      const cur = leaseRef.lease;
      if (cur && cur.tabId !== tabId) {
        return false;
      }
      leaseRef.lease = { tabId, expiresAt: now + LEASE_TTL };
      return true;
    },
    releaseLease: () => {
      if (leaseRef.lease?.tabId === tabId) {
        leaseRef.lease = null;
      }
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

describe('write queue — idempotency (two-tab in-flight lease expiry)', () => {
  it('a re-POST after lease expiry carries the same stable idempotency key', async () => {
    const items = new Map<string, QueuedWrite>();
    const leaseRef: { lease: { tabId: string; expiresAt: number } | null } = { lease: null };
    const storageA = makeLeasedStorage(items, leaseRef, 'tab-a');
    const storageB = makeLeasedStorage(items, leaseRef, 'tab-b');

    // Tab A acquires the lease at t=0 and its send hangs in flight.
    const keysA: string[] = [];
    let releaseA: ((o: WriteOutcome) => void) | undefined;
    const qA = createRawWriteQueue({
      now: () => 0,
      storage: storageA,
      send: (_b, key) => {
        keysA.push(key);
        return new Promise<WriteOutcome>((resolve) => {
          releaseA = resolve;
        });
      },
    });
    qA.enqueue(body({ guideId: 'x' }));
    const inFlightId = qA.snapshot()[0]!.id;

    const pA = qA.processDue();
    await Promise.resolve();
    await Promise.resolve();
    expect(keysA).toEqual([inFlightId]);

    // 30s+ later tab A's lease has expired; tab B acquires and drains the same
    // still-persisted item. Both POST the same stable id, so the backend dedupes.
    const keysB: string[] = [];
    const qB = createRawWriteQueue({
      now: () => 30_001,
      storage: storageB,
      send: (_b, key) => {
        keysB.push(key);
        return Promise.resolve<WriteOutcome>({ kind: 'created' });
      },
    });
    await qB.processDue();

    expect(keysB).toEqual([inFlightId]);
    expect(keysA[0]).toBe(keysB[0]);

    releaseA?.({ kind: 'created' });
    await pA;
  });
});

describe('write queue — emission path does not enumerate storage', () => {
  it('enqueue does not scan stored keys; the async drain reconciles off that stack', async () => {
    const base = makeStorage();
    const listSpy = jest.fn(() => Array.from(base.items.values()).map((i) => ({ ...i })));
    const storage: CompletionWriteStorage = { ...base.storage, list: listSpy };
    const q = createWriteQueue({ now: () => 0, send: makeSender([{ kind: 'created' }]).send, storage });

    listSpy.mockClear(); // ignore the constructor's initial refresh()
    q.enqueue(body());
    expect(listSpy).not.toHaveBeenCalled();

    await q.processDue();
    expect(listSpy).toHaveBeenCalled();
  });
});

describe('write queue — backoff cap is a true ceiling', () => {
  it('clamps the +25% jitter endpoint back to maxBackoffMs', async () => {
    const s = makeSender([{ kind: 'transient' }]);
    const q = createWriteQueue({
      now: () => 0,
      send: s.send,
      random: () => 1, // +25% jitter endpoint → base+jitter = 1250 before clamp
      baseBackoffMs: 1000,
      maxBackoffMs: 1000,
    });
    q.enqueue(body());
    const r = await q.processDue();
    expect(r.nextDelayMs).toBe(1000);
  });

  it('stays non-negative and under the cap at the -25% jitter endpoint', async () => {
    const s = makeSender([{ kind: 'transient' }]);
    const q = createWriteQueue({
      now: () => 0,
      send: s.send,
      random: () => 0, // -25% jitter endpoint → base+jitter = 750
      baseBackoffMs: 1000,
      maxBackoffMs: 1000,
    });
    q.enqueue(body());
    const r = await q.processDue();
    expect(r.nextDelayMs).toBe(750);
  });
});

describe('write queue — drain budget (queue-drain-budget)', () => {
  it('sends at most drainBudget items per pass and reschedules immediately for the rest', async () => {
    const s = makeSender([{ kind: 'created' }]);
    const q = createWriteQueue({ now: () => 0, send: s.send, drainBudget: 2 });
    for (let i = 0; i < 5; i++) {
      q.enqueue(body({ guideId: `g${i}` }));
    }

    const r1 = await q.processDue();
    expect(s.calls).toHaveLength(2);
    expect(q.size()).toBe(3);
    // More due items remain → reschedule a fresh pass now (lease released between).
    expect(r1.nextDelayMs).toBe(0);

    const r2 = await q.processDue();
    expect(s.calls).toHaveLength(4);
    expect(q.size()).toBe(1);
    expect(r2.nextDelayMs).toBe(0);

    const r3 = await q.processDue();
    expect(s.calls).toHaveLength(5);
    expect(q.size()).toBe(0);
    expect(r3.nextDelayMs).toBeNull();
  });

  it('releases the lease between passes', async () => {
    const memory = makeStorage();
    const releases: number[] = [];
    memory.storage.releaseLease = () => releases.push(1);
    const s = makeSender([{ kind: 'created' }]);
    const q = createWriteQueue({ now: () => 0, send: s.send, storage: memory.storage, drainBudget: 1 });
    q.enqueue(body({ guideId: 'a' }));
    q.enqueue(body({ guideId: 'b' }));

    await q.processDue();
    await q.processDue();

    expect(releases.length).toBeGreaterThanOrEqual(2);
  });
});

describe('write queue — in-flight eviction pin (queue-eviction-concurrency)', () => {
  it('does not evict the item whose POST is in flight when a concurrent enqueue hits the cap', async () => {
    const ids = ['a', 'b', 'c'];
    let releaseA: ((o: WriteOutcome) => void) | undefined;
    const q = createWriteQueue({
      now: () => 0,
      maxSize: 2,
      nextId: () => ids.shift()!,
      send: (_b, key) =>
        key === 'a'
          ? new Promise<WriteOutcome>((resolve) => {
              releaseA = resolve;
            })
          : Promise.resolve<WriteOutcome>({ kind: 'created' }),
    });
    q.enqueue(body({ guideId: 'a' }));
    q.enqueue(body({ guideId: 'b' }));

    const pending = q.processDue(); // send('a') hangs → 'a' is in flight
    await Promise.resolve();
    await Promise.resolve();

    // Concurrent enqueue at capacity: the in-flight 'a' must survive; 'b' evicts.
    q.enqueue(body({ guideId: 'c' }));
    const ids2 = q.snapshot().map((i) => i.id);
    expect(ids2).toContain('a');
    expect(ids2).not.toContain('b');

    releaseA?.({ kind: 'created' });
    await pending;
  });
});

describe('write queue — retention horizon (retry-retention-horizon)', () => {
  const NOW = Date.parse('2026-07-20T00:00:00.000Z');
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

  it('drops a persisted record older than the retention horizon on load', () => {
    const storage = makeStorage();
    storage.items.set('old', {
      id: 'old',
      body: body({ completedAt: new Date(NOW - THIRTY_DAYS - 1000).toISOString() }),
      attempts: 0,
      createdAt: NOW - THIRTY_DAYS - 1000,
      nextAttemptAt: 0,
    });
    const q = createWriteQueue({ now: () => NOW, send: makeSender([]).send, storage: storage.storage });
    expect(q.size()).toBe(0);
    expect(storage.items.has('old')).toBe(false);
  });

  it('keeps a record just inside the horizon', () => {
    const storage = makeStorage();
    storage.items.set('fresh', {
      id: 'fresh',
      body: body({ completedAt: new Date(NOW - THIRTY_DAYS + 60_000).toISOString() }),
      attempts: 0,
      createdAt: NOW - THIRTY_DAYS + 60_000,
      nextAttemptAt: 0,
    });
    const q = createWriteQueue({ now: () => NOW, send: makeSender([]).send, storage: storage.storage });
    expect(q.size()).toBe(1);
  });

  it('drops an item that ages past the horizon before it drains, without POSTing it', async () => {
    const s = makeSender([{ kind: 'created' }]);
    const q = createWriteQueue({ now: () => NOW + THIRTY_DAYS + 1, send: s.send });
    q.enqueue(body({ completedAt: new Date(NOW).toISOString() }));
    const r = await q.processDue();
    expect(s.calls).toHaveLength(0);
    expect(q.size()).toBe(0);
    expect(r.disarmed).toBe(false);
  });
});

describe('write queue — over-cap persisted load eviction', () => {
  it('evicts oldest-first when more than maxSize items are already persisted', () => {
    const NOW = Date.parse('2026-07-20T00:00:00.000Z');
    const storage = makeStorage();
    for (const [id, created] of [
      ['old', NOW - 3000],
      ['mid', NOW - 2000],
      ['new', NOW - 1000],
    ] as const) {
      storage.items.set(id, {
        id,
        body: body({ completedAt: new Date(NOW).toISOString(), guideId: id }),
        attempts: 0,
        createdAt: created,
        nextAttemptAt: 0,
      });
    }
    const q = createWriteQueue({ now: () => NOW, send: makeSender([]).send, storage: storage.storage, maxSize: 2 });
    expect(q.size()).toBe(2);
    expect(
      q
        .snapshot()
        .map((i) => i.id)
        .sort()
    ).toEqual(['mid', 'new']);
    expect(storage.items.has('old')).toBe(false);
  });
});
