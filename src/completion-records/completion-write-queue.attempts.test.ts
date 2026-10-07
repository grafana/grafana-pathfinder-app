/**
 * Attempt items in the durable write queue (incremental progress): ids per
 * (attempt, percent), supersede and debounce, guard and attempt handling when
 * an item is lost, and the send-time capability check for partials.
 */
jest.mock('./completion-write-telemetry', () => ({ reportCompletionWriteDegradation: jest.fn() }));

import type { CompletionWriteBody, WriteOutcome } from './completion-write-client';
import {
  invalidateEmittedCompletion,
  recordGuideCompletion,
  onCompletionRecorded,
  __resetRecorderForTests,
} from './completion-recorder';
import { PARTIAL_DEBOUNCE_MS, attemptWriteId, createWriteQueue, type WriteQueueDeps } from './completion-write-queue';
import type { CompletionWriteStorage, QueuedWrite } from './completion-write-storage';
import { reportCompletionWriteDegradation } from './completion-write-telemetry';
import { closeAttempt, getOrMintAttempt, readAttempt } from './guide-attempts';
import type { ProgressRecordsCapability } from './progress-records-capability';
import { completionEmittedStorage } from '../lib/user-storage';

const ATTEMPT = 'a'.repeat(32);
const KEY = { guideSource: 'bundled', guideId: 'g1' };

function body(percent: number, overrides: Partial<CompletionWriteBody> = {}): CompletionWriteBody {
  return {
    guideSource: 'bundled',
    guideId: 'g1',
    guideTitle: 'G1',
    guideCategory: 'interactive',
    completionPercent: percent,
    source: 'objectives',
    completedAt: new Date(0).toISOString(),
    platform: 'cloud',
    attemptId: ATTEMPT,
    ...overrides,
  };
}

function makeStorage() {
  const items = new Map<string, QueuedWrite>();
  const storage: CompletionWriteStorage = {
    list: () => Array.from(items.values()).map((item) => ({ ...item })),
    put: (item) => {
      items.set(item.id, { ...item });
      return true;
    },
    remove: (id) => {
      items.delete(id);
    },
    clear: () => items.clear(),
    acquireLease: () => ({ acquired: true, retryAfterMs: 0 }),
    renewLease: () => true,
    releaseLease: () => undefined,
    subscribe: () => () => undefined,
  };
  return { storage, items };
}

function setup(overrides: Partial<WriteQueueDeps> = {}, outcomes: WriteOutcome[] = [{ kind: 'created' }]) {
  let clock = 0;
  const sent: Array<{ body: CompletionWriteBody; key: string }> = [];
  let i = 0;
  const { storage, items } = makeStorage();
  let capability: ProgressRecordsCapability = 'yes';
  const queue = createWriteQueue({
    now: () => clock,
    random: () => 0.5,
    storage,
    send: async (b, key) => {
      sent.push({ body: b, key });
      const out = outcomes[Math.min(i, outcomes.length - 1)]!;
      i += 1;
      return out;
    },
    partialsSupported: () => capability,
    // A fixed long horizon: these tests use epoch completedAt values.
    maxRetentionMs: Number.MAX_SAFE_INTEGER,
    ...overrides,
  });
  return {
    queue,
    sent,
    items,
    advance: (ms: number) => {
      clock += ms;
    },
    now: () => clock,
    setCapability: (next: ProgressRecordsCapability) => {
      capability = next;
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  __resetRecorderForTests();
  (reportCompletionWriteDegradation as jest.Mock).mockClear();
});

it('debounces a partial, and later progress supersedes it so the burst sends once', async () => {
  const t = setup();
  t.queue.enqueue(body(20), { id: attemptWriteId(ATTEMPT, 20) });
  t.advance(3000);
  t.queue.enqueue(body(40), { id: attemptWriteId(ATTEMPT, 40) });
  t.queue.enqueue(body(60), { id: attemptWriteId(ATTEMPT, 60) });

  expect(t.queue.snapshot().map((i) => i.id)).toEqual([attemptWriteId(ATTEMPT, 60)]);
  // The survivor inherits the first item's due time; it is not reset by each increase.
  expect(t.queue.snapshot()[0]!.nextAttemptAt).toBe(PARTIAL_DEBOUNCE_MS);

  t.advance(PARTIAL_DEBOUNCE_MS - 3000 - 1);
  await t.queue.processDue();
  expect(t.sent).toHaveLength(0);

  t.advance(1);
  await t.queue.processDue();
  expect(t.sent.map((s) => s.body.completionPercent)).toEqual([60]);
  expect(t.sent[0]!.key).toBe(attemptWriteId(ATTEMPT, 60));
  expect(t.queue.size()).toBe(0);
});

it('sends a completion at once and drops the partials it supersedes', async () => {
  const t = setup();
  t.queue.enqueue(body(40), { id: attemptWriteId(ATTEMPT, 40) });
  t.queue.enqueue(body(100, { source: 'manual' }), { id: attemptWriteId(ATTEMPT, 100) });

  await t.queue.processDue();

  expect(t.sent.map((s) => s.body.completionPercent)).toEqual([100]);
  expect(t.queue.size()).toBe(0);
});

it('ignores a lower partial when equal or higher progress is already queued', () => {
  const t = setup();
  t.queue.enqueue(body(60), { id: attemptWriteId(ATTEMPT, 60) });
  expect(t.queue.enqueue(body(40), { id: attemptWriteId(ATTEMPT, 40) })).toBe(true);
  expect(t.queue.snapshot().map((i) => i.id)).toEqual([attemptWriteId(ATTEMPT, 60)]);
});

it('two tabs enqueueing the same percent share one storage key', () => {
  const t = setup();
  t.queue.enqueue(body(40), { id: attemptWriteId(ATTEMPT, 40) });
  t.queue.enqueue(body(40), { id: attemptWriteId(ATTEMPT, 40) });
  expect(t.items.size).toBe(1);
  expect(t.queue.size()).toBe(1);
});

it('never supersedes the item in flight, and a late success removes only that item', async () => {
  let release: (out: WriteOutcome) => void = () => undefined;
  const t = setup({
    send: () =>
      new Promise<WriteOutcome>((resolve) => {
        release = resolve;
      }),
  });
  t.queue.enqueue(body(40), { id: attemptWriteId(ATTEMPT, 40) });
  t.advance(PARTIAL_DEBOUNCE_MS);
  const pass = t.queue.processDue();

  // While 40 is in flight, 70 arrives: 40 must stay (it is being sent).
  t.queue.enqueue(body(70), { id: attemptWriteId(ATTEMPT, 70) });
  expect(
    t.queue
      .snapshot()
      .map((i) => i.id)
      .sort()
  ).toEqual([attemptWriteId(ATTEMPT, 40), attemptWriteId(ATTEMPT, 70)].sort());

  release({ kind: 'created' });
  await pass;
  expect(t.queue.snapshot().map((i) => i.id)).toEqual([attemptWriteId(ATTEMPT, 70)]);
});

it('drops a partial when the backend does not support partials, but still sends the completion', async () => {
  const t = setup();
  t.setCapability('no');
  t.queue.enqueue(body(40), { id: attemptWriteId(ATTEMPT, 40) });
  t.queue.enqueue(body(100, { attemptId: 'b'.repeat(32) }), { id: attemptWriteId('b'.repeat(32), 100) });
  t.advance(PARTIAL_DEBOUNCE_MS);

  await t.queue.processDue();

  expect(t.sent.map((s) => s.body.completionPercent)).toEqual([100]);
  expect(t.queue.size()).toBe(0);
  expect(reportCompletionWriteDegradation).toHaveBeenCalledWith('partial-unsupported-drop');
});

it('holds a partial while the capability is unknown, then sends it', async () => {
  const t = setup();
  t.setCapability('unknown');
  t.queue.enqueue(body(40), { id: attemptWriteId(ATTEMPT, 40) });
  t.advance(PARTIAL_DEBOUNCE_MS);

  const held = await t.queue.processDue();
  expect(t.sent).toHaveLength(0);
  expect(t.queue.size()).toBe(1);
  expect(held.nextDelayMs).toBeGreaterThan(0);

  t.setCapability('yes');
  t.advance(held.nextDelayMs!);
  await t.queue.processDue();
  expect(t.sent.map((s) => s.body.completionPercent)).toEqual([40]);
});

it('a lost partial leaves the guard and the attempt alone', () => {
  const { attempt } = getOrMintAttempt(KEY, () => 'records');
  completionEmittedStorage.markEmitted('guide:bundled:g1');
  const t = setup({ maxSize: 1 });
  t.queue.enqueue(body(40, { attemptId: attempt.attemptId }), { id: attemptWriteId(attempt.attemptId, 40) });

  // Over cap: the partial is evicted by an unrelated completion.
  t.queue.enqueue(body(100, { guideId: 'other', attemptId: undefined }));

  expect(completionEmittedStorage.isEmitted('guide:bundled:g1')).toBe(true);
  expect(readAttempt(KEY)).toEqual(attempt);
});

it('a lost attempt completion lifts the guard and reopens the attempt', () => {
  const seen: string[] = [];
  onCompletionRecorded((fact) => {
    seen.push(fact.guideId);
    return true;
  });
  recordGuideCompletion(
    {
      kind: 'guide',
      guideSource: 'bundled',
      guideId: 'g1',
      guideTitle: 'G1',
      guideCategory: 'interactive',
      completionPercent: 100,
      source: 'objectives',
      completedAt: new Date(0).toISOString(),
    },
    { attemptEligible: true }
  );
  const attempt = readAttempt(KEY)!;
  closeAttempt(KEY, attempt.attemptId);
  const t = setup({ maxSize: 1 });
  t.queue.enqueue(body(100, { attemptId: attempt.attemptId }), { id: attemptWriteId(attempt.attemptId, 100) });

  t.queue.enqueue(body(100, { guideId: 'other', attemptId: undefined }));

  // The guard is lifted, so the guide can be recorded again, under the same attempt.
  recordGuideCompletion(
    {
      kind: 'guide',
      guideSource: 'bundled',
      guideId: 'g1',
      guideTitle: 'G1',
      guideCategory: 'interactive',
      completionPercent: 100,
      source: 'objectives',
      completedAt: new Date(0).toISOString(),
    },
    { attemptEligible: true }
  );
  expect(seen).toEqual(['g1', 'g1']);
  expect(readAttempt(KEY)?.attemptId).toBe(attempt.attemptId);
  invalidateEmittedCompletion('bundled', 'g1');
});

it('drops restored partials while disabled without dropping completions', async () => {
  const { storage } = makeStorage();
  const first = createWriteQueue({ now: () => 0, send: jest.fn(), storage });
  first.enqueue(body(40), { id: attemptWriteId(ATTEMPT, 40) });
  first.enqueue(body(100, { attemptId: 'b'.repeat(32) }));
  const send = jest.fn(async (): Promise<WriteOutcome> => ({ kind: 'created' }));
  const restored = createWriteQueue({ now: () => PARTIAL_DEBOUNCE_MS, send, storage, partialsEnabled: () => false });
  await restored.processDue();
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ completionPercent: 100 }), expect.any(String));
  expect(restored.size()).toBe(0);
});

it('notifies completion listeners only for a completion', async () => {
  const onCreated = jest.fn();
  const t = setup({ onCreated });
  t.queue.enqueue(body(40));
  t.advance(PARTIAL_DEBOUNCE_MS);
  await t.queue.processDue();
  expect(onCreated).not.toHaveBeenCalled();
  t.queue.enqueue(body(100));
  await t.queue.processDue();
  expect(onCreated).toHaveBeenCalledTimes(1);
});

it('leaves bodies without an attempt exactly as before', async () => {
  const t = setup();
  const { attemptId: _omitted, ...legacy } = body(100);
  t.queue.enqueue(legacy);
  await t.queue.processDue();
  expect(t.sent[0]!.body).toEqual(legacy);
  expect(t.sent[0]!.body).not.toHaveProperty('attemptId');
});
