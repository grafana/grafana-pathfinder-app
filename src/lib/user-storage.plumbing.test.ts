/**
 * Characterization / tripwire tests for the user-storage plumbing layer.
 *
 * These pin the behavior of the highest-risk, previously-untested async paths
 * before any decomposition of `user-storage.ts`:
 *   - `createHybridStorage` debounced write queue (debounce, per-key dedup,
 *     synchronous localStorage write, and the anti-stranding re-check drain)
 *   - `syncFromGrafanaStorage` once-per-lifecycle guard and timestamp-based
 *     last-write-wins conflict resolution (including deletion tombstones)
 *   - `createLocalStorage` JSON fallback and plugin-scoped clear
 *
 * They are deliberately behavioral: if a future refactor changes any of these
 * contracts, these tests should fail.
 */
import type { GrafanaUserStorage } from '../types/storage.types';

import {
  __resetSyncedForTests,
  createHybridStorage,
  createLocalStorage,
  syncFromGrafanaStorage,
  unwrapEnvelope,
  wrapEnvelope,
} from './user-storage';
import { StorageKeys } from './storage-keys';

// user-storage.ts statically imports from `@grafana/runtime`; provide a mock so
// the module loads under jsdom.
jest.mock('@grafana/runtime', () => ({
  usePluginUserStorage: jest.fn(),
  getAppEvents: jest.fn(() => ({ publish: jest.fn() })),
}));

const TIMESTAMP_SUFFIX = '__timestamp';
const tsKey = (key: string) => `${key}${TIMESTAMP_SUFFIX}`;

/** Flush a generous number of microtask ticks so awaited queue work settles. */
async function flushMicrotasks(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

/** In-memory Grafana user-storage double backed by a Map. */
function makeGrafanaStorage(seed: Record<string, string> = {}): GrafanaUserStorage & {
  store: Map<string, string>;
  getItem: jest.Mock;
  setItem: jest.Mock;
} {
  const store = new Map<string, string>(Object.entries(seed));
  const getItem = jest.fn(async (key: string) => store.get(key) ?? null);
  const setItem = jest.fn(async (key: string, value: string) => {
    store.set(key, value);
  });
  return { store, getItem, setItem } as unknown as GrafanaUserStorage & {
    store: Map<string, string>;
    getItem: jest.Mock;
    setItem: jest.Mock;
  };
}

// ============================================================================
// createHybridStorage — debounced write queue (Pattern F/G)
// ============================================================================

describe('createHybridStorage — debounced write queue', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('writes to localStorage synchronously, before the debounce fires', async () => {
    const grafana = makeGrafanaStorage();
    const hybrid = createHybridStorage(grafana);

    await hybrid.setItem('k', 'immediate');

    // localStorage holds the value immediately (survives page refresh)…
    expect(localStorage.getItem('k')).toBe(JSON.stringify('immediate'));
    expect(localStorage.getItem(tsKey('k'))).not.toBeNull();
    // …but Grafana has not been touched yet (still debouncing).
    expect(grafana.setItem).not.toHaveBeenCalled();
  });

  it('debounces rapid writes to the same key into a single deduped Grafana write (last-write-wins)', async () => {
    const grafana = makeGrafanaStorage();
    const hybrid = createHybridStorage(grafana);

    await hybrid.setItem('k', 'a');
    await hybrid.setItem('k', 'b');
    await hybrid.setItem('k', 'c');

    expect(grafana.setItem).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(500);

    expect(grafana.setItem).toHaveBeenCalledTimes(1);
    const [writtenKey, writtenValue] = grafana.setItem.mock.calls[0];
    expect(writtenKey).toBe('k');
    // Only the latest value survives dedup.
    expect(unwrapEnvelope(writtenValue)?.v).toBe(JSON.stringify('c'));
  });

  it('flushes distinct keys in a single drain', async () => {
    const grafana = makeGrafanaStorage();
    const hybrid = createHybridStorage(grafana);

    await hybrid.setItem('k1', 'v1');
    await hybrid.setItem('k2', 'v2');

    await jest.advanceTimersByTimeAsync(500);

    expect(grafana.setItem).toHaveBeenCalledTimes(2);
    const keys = grafana.setItem.mock.calls.map((c) => c[0]).sort();
    expect(keys).toEqual(['k1', 'k2']);
  });

  it('queues a deletion as an empty-value envelope', async () => {
    const grafana = makeGrafanaStorage();
    const hybrid = createHybridStorage(grafana);

    await hybrid.removeItem('k');
    expect(localStorage.getItem('k')).toBeNull();

    await jest.advanceTimersByTimeAsync(500);

    expect(grafana.setItem).toHaveBeenCalledTimes(1);
    const [, writtenValue] = grafana.setItem.mock.calls[0];
    expect(unwrapEnvelope(writtenValue)?.v).toBe('');
  });

  it('does not strand items pushed while a drain is awaiting (re-check path)', async () => {
    const grafana = makeGrafanaStorage();

    // Make the FIRST Grafana write hang until we release it, so a second item
    // can be enqueued while processQueue is mid-await.
    let releaseFirst: () => void = () => undefined;
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let call = 0;
    grafana.setItem.mockImplementation(async (key: string, value: string) => {
      call += 1;
      grafana.store.set(key, value);
      if (call === 1) {
        await firstWrite;
      }
    });

    const hybrid = createHybridStorage(grafana);

    await hybrid.setItem('k1', 'v1'); // queue=[k1], debounce timer T1
    await jest.advanceTimersByTimeAsync(500); // T1 → processQueue begins, awaits firstWrite
    expect(grafana.setItem).toHaveBeenCalledTimes(1);

    await hybrid.setItem('k2', 'v2'); // queue=[k2], debounce timer T2
    await jest.advanceTimersByTimeAsync(500); // T2 fires but bails (isProcessingQueue) — k2 now stranded unless re-checked

    expect(grafana.setItem).toHaveBeenCalledTimes(1);

    releaseFirst();
    await flushMicrotasks();

    // The re-check after the first drain must pick up the stranded k2.
    expect(grafana.setItem).toHaveBeenCalledTimes(2);
    expect(grafana.store.has('k2')).toBe(true);
  });
});

// ============================================================================
// syncFromGrafanaStorage — once-per-lifecycle + conflict matrix (Pattern G)
// ============================================================================

describe('syncFromGrafanaStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetSyncedForTests();
  });

  it('runs at most once per page lifecycle', async () => {
    const grafana = makeGrafanaStorage(); // all keys empty

    await syncFromGrafanaStorage(grafana);
    const callsAfterFirst = grafana.getItem.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    await syncFromGrafanaStorage(grafana);
    // Second call is a no-op: the guard short-circuits before any reads.
    expect(grafana.getItem.mock.calls.length).toBe(callsAfterFirst);
  });

  it('applies Grafana value to localStorage when Grafana is newer', async () => {
    const key = StorageKeys.LEARNING_PROGRESS;
    localStorage.setItem(key, '"local-old"');
    localStorage.setItem(tsKey(key), '100');

    const grafana = makeGrafanaStorage({ [key]: wrapEnvelope('"grafana-new"', 200) });

    await syncFromGrafanaStorage(grafana);

    expect(localStorage.getItem(key)).toBe('"grafana-new"');
    expect(localStorage.getItem(tsKey(key))).toBe('200');
  });

  it('pushes localStorage back to Grafana when localStorage is newer', async () => {
    const key = StorageKeys.TABS;
    localStorage.setItem(key, '"local-new"');
    localStorage.setItem(tsKey(key), '300');

    const grafana = makeGrafanaStorage({ [key]: wrapEnvelope('"grafana-old"', 100) });

    await syncFromGrafanaStorage(grafana);

    // localStorage is untouched; Grafana receives the newer local value.
    expect(localStorage.getItem(key)).toBe('"local-new"');
    const pushWrite = grafana.setItem.mock.calls.find((c) => c[0] === key);
    expect(pushWrite).toBeDefined();
    const envelope = unwrapEnvelope(pushWrite![1]);
    expect(envelope?.v).toBe('"local-new"');
    expect(envelope?.t).toBe(300);
  });

  it('propagates a newer Grafana deletion tombstone to localStorage', async () => {
    const key = StorageKeys.ACTIVE_TAB;
    localStorage.setItem(key, '"still-here"');
    localStorage.setItem(tsKey(key), '100');

    // Deletion is an empty-value envelope with a newer timestamp.
    const grafana = makeGrafanaStorage({ [key]: wrapEnvelope('', 200) });

    await syncFromGrafanaStorage(grafana);

    expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem(tsKey(key))).toBe('200');
  });
});

// ============================================================================
// createLocalStorage — JSON fallback + plugin-scoped clear
// ============================================================================

describe('createLocalStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips JSON values', async () => {
    const storage = createLocalStorage();
    await storage.setItem('obj', { a: 1, b: [2, 3] });
    expect(await storage.getItem('obj')).toEqual({ a: 1, b: [2, 3] });
  });

  it('returns the raw string when the stored value is not JSON', async () => {
    const storage = createLocalStorage();
    localStorage.setItem('raw', 'not-json');
    expect(await storage.getItem<string>('raw')).toBe('not-json');
  });

  it('returns null for a missing key', async () => {
    const storage = createLocalStorage();
    expect(await storage.getItem('absent')).toBeNull();
  });

  it('clear() only removes `grafana-pathfinder-app-` keys, leaving other plugin keys behind', async () => {
    const storage = createLocalStorage();
    localStorage.setItem(StorageKeys.TABS, '[]');
    localStorage.setItem('unrelated-key', 'keep-me');
    // `clear()` filters on the literal `grafana-pathfinder-app-` prefix, so the
    // centralized keys that use the bare `pathfinder-*` / dotted `pathfinder.*`
    // shapes are NOT cleared. Pin that seam rather than implying clear() is
    // registry-wide.
    localStorage.setItem(StorageKeys.CODA_TERMINAL_IS_OPEN, '1');
    localStorage.setItem(StorageKeys.BLOCK_EDITOR_HEALTH_PANEL_OPEN, 'true');

    await storage.clear();

    expect(localStorage.getItem(StorageKeys.TABS)).toBeNull();
    expect(localStorage.getItem('unrelated-key')).toBe('keep-me');
    expect(localStorage.getItem(StorageKeys.CODA_TERMINAL_IS_OPEN)).toBe('1');
    expect(localStorage.getItem(StorageKeys.BLOCK_EDITOR_HEALTH_PANEL_OPEN)).toBe('true');
  });
});
