/**
 * Reproduction for the pstack/TLA+ pilot (#2421, docs/developer/PSTACK_PILOT.md):
 * a "reset all" in one tab while another tab's POST is in flight. Two queue
 * instances share the real storage adapter over jsdom localStorage, one per tab.
 *
 * `it.failing` records a confirmed defect: each case asserts the contract
 * (`queue-eviction-concurrency`: no outcome re-persists a record that left the
 * queue mid-send) and passes only while the code breaks it. When the defect is
 * fixed, Jest reports these as failures; turn them into ordinary `it` cases.
 */
jest.mock('@grafana/runtime', () => ({ config: { bootData: { user: { id: 7, orgId: 3 } } } }));
jest.mock('./completion-write-telemetry', () => ({ reportCompletionWriteDegradation: jest.fn() }));

import type { CompletionWriteBody, WriteOutcome } from './completion-write-client';
import { createWriteQueue } from './completion-write-queue';
import { createCompletionWriteStorage } from './completion-write-storage';
import { StorageKeys } from '../lib/storage-keys';

const OWNER = 'user-7:org-3';

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

function storedIds(): string[] {
  const prefix = `${StorageKeys.COMPLETION_WRITE_QUEUE_PREFIX}${OWNER}:item:`;
  return Object.keys(localStorage)
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length));
}

function gatedSender() {
  const keys: string[] = [];
  let release: ((outcome: WriteOutcome) => void) | null = null;
  const send = (_b: CompletionWriteBody, key: string) => {
    keys.push(key);
    return new Promise<WriteOutcome>((resolve) => {
      release = resolve;
    });
  };
  return { keys, send, resolve: (outcome: WriteOutcome) => release?.(outcome) };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  localStorage.clear();
});

describe('write queue — reset in another tab while a POST is in flight', () => {
  it.failing('does not re-persist the in-flight record after a transient outcome', async () => {
    const tabA = gatedSender();
    const qA = createWriteQueue({
      now: () => 0,
      send: tabA.send,
      storage: createCompletionWriteStorage(OWNER, 'tab-a'),
    });
    const qB = createWriteQueue({
      now: () => 0,
      send: async () => ({ kind: 'created' }),
      storage: createCompletionWriteStorage(OWNER, 'tab-b'),
    });

    qA.enqueue(body({ guideId: 'withdrawn' }));
    const drainA = qA.processDue();
    await flush();
    expect(tabA.keys).toHaveLength(1);

    qB.clear();
    expect(storedIds()).toEqual([]);

    tabA.resolve({ kind: 'transient' });
    await drainA;

    expect(storedIds()).toEqual([]);
  });

  it.failing('does not POST the withdrawn record again on a later drain', async () => {
    const tabA = gatedSender();
    const qA = createWriteQueue({
      now: () => 0,
      send: tabA.send,
      storage: createCompletionWriteStorage(OWNER, 'tab-a'),
    });
    const keysB: string[] = [];
    const qB = createWriteQueue({
      // Past the first retry backoff of the re-persisted record.
      now: () => 60_000,
      send: async (_b, key) => {
        keysB.push(key);
        return { kind: 'created' };
      },
      storage: createCompletionWriteStorage(OWNER, 'tab-b'),
    });

    qA.enqueue(body({ guideId: 'withdrawn' }));
    const drainA = qA.processDue();
    await flush();
    qB.clear();
    tabA.resolve({ kind: 'transient' });
    await drainA;

    await qB.processDue();

    expect(keysB).toEqual([]);
  });

  it.failing('does not re-persist a held partial after the in-flight POST resolves', async () => {
    let clock = 0;
    const tabA = gatedSender();
    const qA = createWriteQueue({
      now: () => clock,
      send: tabA.send,
      storage: createCompletionWriteStorage(OWNER, 'tab-a'),
      partialsSupported: () => 'unknown',
    });
    const qB = createWriteQueue({
      now: () => clock,
      send: async () => ({ kind: 'created' }),
      storage: createCompletionWriteStorage(OWNER, 'tab-b'),
    });

    qA.enqueue(body({ guideId: 'done' }));
    clock = 1;
    qA.enqueue(body({ guideId: 'partial', completionPercent: 50, attemptId: 'att-1' }), { id: 'att-1-50' });
    clock = 20_000;
    const drainA = qA.processDue();
    await flush();
    expect(tabA.keys).toHaveLength(1);

    qB.clear();
    tabA.resolve({ kind: 'created' });
    await drainA;

    expect(storedIds()).toEqual([]);
  });
});
