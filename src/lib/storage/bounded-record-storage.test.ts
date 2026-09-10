import { getAppEvents } from '@grafana/runtime';

import { createUserStorage, warnQuotaExceededOnce, __resetQuotaWarningForTests } from '../user-storage';
import { createBoundedRecordStorage, type BoundedRecordStorageConfig } from './bounded-record-storage';

jest.mock('@grafana/runtime', () => ({
  usePluginUserStorage: jest.fn(),
  getAppEvents: jest.fn(),
}));

// The building block takes its storage backend and quota notifier by injection
// (that's how the user-storage import cycle is broken). Wire in the real
// implementations so these tests exercise the same behavior as production.
const makeStore = (config: Omit<BoundedRecordStorageConfig, 'createStorage' | 'onQuotaExceeded'>) =>
  createBoundedRecordStorage({ ...config, createStorage: createUserStorage, onQuotaExceeded: warnQuotaExceededOnce });

describe('createBoundedRecordStorage', () => {
  const TEST_KEY = 'pathfinder.bounded-record-test';

  beforeEach(() => {
    localStorage.clear();
    __resetQuotaWarningForTests();
    (getAppEvents as jest.Mock).mockReturnValue({ publish: jest.fn() });
  });

  it('returns 0 when the underlying record is empty', async () => {
    const store = makeStore({ storageKey: TEST_KEY, limit: 100, label: 'test' });
    expect(await store.get('missing')).toBe(0);
  });

  it('round-trips a percentage value', async () => {
    const store = makeStore({ storageKey: TEST_KEY, limit: 100, label: 'test' });
    await store.set('a', 42);
    expect(await store.get('a')).toBe(42);
  });

  it('clamps values to [0, 100]', async () => {
    const store = makeStore({ storageKey: TEST_KEY, limit: 100, label: 'test' });
    await store.set('low', -10);
    await store.set('high', 999);
    expect(await store.get('low')).toBe(0);
    expect(await store.get('high')).toBe(100);
  });

  it('clear() removes a single entry without touching others', async () => {
    const store = makeStore({ storageKey: TEST_KEY, limit: 100, label: 'test' });
    await store.set('a', 25);
    await store.set('b', 75);
    await store.clear('a');
    expect(await store.get('a')).toBe(0);
    expect(await store.get('b')).toBe(75);
  });

  it('clearMany() removes every listed entry in one write, leaving the rest', async () => {
    const store = makeStore({ storageKey: TEST_KEY, limit: 100, label: 'test' });
    await store.set('a', 25);
    await store.set('b', 75);
    await store.set('keep', 50);

    await store.clearMany(['a', 'b', 'never-stored']);

    expect(await store.getAll()).toEqual({ keep: 50 });
  });

  it('getAll() returns the full record', async () => {
    const store = makeStore({ storageKey: TEST_KEY, limit: 100, label: 'test' });
    await store.set('a', 10);
    await store.set('b', 20);
    expect(await store.getAll()).toEqual({ a: 10, b: 20 });
  });

  it('cleanup() trims to the most-recent `limit` entries', async () => {
    const store = makeStore({ storageKey: TEST_KEY, limit: 3, label: 'test' });
    await store.set('a', 1);
    await store.set('b', 2);
    await store.set('c', 3);
    await store.set('d', 4);

    // set() trims on overflow, so after writing 4 entries we should already
    // be at the 3-most-recent: b, c, d.
    expect(await store.getAll()).toEqual({ b: 2, c: 3, d: 4 });

    // cleanup() on a within-budget record is a no-op.
    await store.cleanup();
    expect(await store.getAll()).toEqual({ b: 2, c: 3, d: 4 });
  });

  describe('eviction order', () => {
    // Key order in the persisted record IS the recency mechanism, and object
    // equality ignores it, so these assert the order itself.
    const storedKeys = () => Object.keys(JSON.parse(localStorage.getItem(TEST_KEY) || '{}'));

    it('keeps an entry the reader is still updating and evicts an untouched one instead', async () => {
      const store = makeStore({ storageKey: TEST_KEY, limit: 3, label: 'test' });
      await store.set('early', 10);
      await store.set('b', 20);
      await store.set('c', 30);

      // The reader comes back to `early` and earns more progress on it.
      await store.set('early', 60);
      expect(storedKeys()).toEqual(['b', 'c', 'early']);

      // A fourth guide pushes the record over budget.
      await store.set('d', 40);

      expect(await store.get('early')).toBe(60);
      expect(await store.getAll()).toEqual({ c: 30, early: 60, d: 40 });
      expect(storedKeys()).toEqual(['c', 'early', 'd']);
    });

    it('evicts entries with no recorded progress before entries that hold progress', async () => {
      const store = makeStore({ storageKey: TEST_KEY, limit: 3, label: 'test' });
      await store.set('has-progress', 20);
      await store.set('c', 30);
      await store.set('opened-only', 0);
      await store.set('d', 40);

      // Dropping a 0 is lossless: `get()` already returns 0 for a missing key.
      expect(await store.getAll()).toEqual({ 'has-progress': 20, c: 30, d: 40 });
      expect(storedKeys()).toEqual(['has-progress', 'c', 'd']);
    });

    it('leaves the record untouched when a zero is written at the cap', async () => {
      const store = makeStore({ storageKey: TEST_KEY, limit: 3, label: 'test' });
      await store.set('a', 10);
      await store.set('b', 20);
      await store.set('c', 30);

      // A freshly opened guide writes 0. It is evictable like any other zero,
      // and it is the surplus entry, so nothing real is displaced for it.
      await store.set('fresh', 0);

      expect(await store.getAll()).toEqual({ a: 10, b: 20, c: 30 });
      expect(storedKeys()).toEqual(['a', 'b', 'c']);
      // Indistinguishable from a stored 0, which is why dropping it is sound.
      expect(await store.get('fresh')).toBe(0);
    });

    it('stores that same guide once it earns progress, evicting the stalest entry', async () => {
      const store = makeStore({ storageKey: TEST_KEY, limit: 3, label: 'test' });
      await store.set('a', 10);
      await store.set('b', 20);
      await store.set('c', 30);
      await store.set('fresh', 0);

      await store.set('fresh', 25);

      expect(await store.get('fresh')).toBe(25);
      expect(await store.getAll()).toEqual({ b: 20, c: 30, fresh: 25 });
      expect(storedKeys()).toEqual(['b', 'c', 'fresh']);
    });

    it('reads a record written before the change and keeps updated entries from it', async () => {
      // Shape written by the previous implementation: a plain key -> percentage
      // record with no recency metadata, already over the new budget.
      localStorage.setItem(TEST_KEY, JSON.stringify({ old1: 10, old2: 20, old3: 30, old4: 40 }));
      const store = makeStore({ storageKey: TEST_KEY, limit: 3, label: 'test' });

      expect(await store.get('old1')).toBe(10);

      await store.set('old1', 55);

      expect(await store.get('old1')).toBe(55);
      expect(await store.getAll()).toEqual({ old3: 30, old4: 40, old1: 55 });
      expect(storedKeys()).toEqual(['old3', 'old4', 'old1']);
    });

    it('changes nothing for a record below the limit', async () => {
      const store = makeStore({ storageKey: TEST_KEY, limit: 100, label: 'test' });
      await store.set('a', 0);
      await store.set('b', 20);
      await store.set('a', 30);

      expect(await store.getAll()).toEqual({ a: 30, b: 20 });
      expect(JSON.parse(localStorage.getItem(TEST_KEY)!)).toEqual({ a: 30, b: 20 });
    });
  });

  it('clearAll() removes the underlying storage key entirely', async () => {
    const store = makeStore({ storageKey: TEST_KEY, limit: 100, label: 'test' });
    await store.set('a', 10);
    await store.clearAll();
    expect(localStorage.getItem(TEST_KEY)).toBeNull();
    expect(await store.getAll()).toEqual({});
  });

  it('retries set() once after cleanup when the first write hits QuotaExceededError', async () => {
    const store = makeStore({ storageKey: TEST_KEY, limit: 100, label: 'test' });

    // Seed an existing entry so the test exercises the merge-then-write path.
    await store.set('seed', 50);

    const originalSetItem = Storage.prototype.setItem;
    let throwNext = true;
    const setItemSpy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string
    ) {
      if (throwNext) {
        throwNext = false;
        const err = new Error('Quota exceeded');
        err.name = 'QuotaExceededError';
        throw err;
      }
      return originalSetItem.call(this, key, value);
    });

    try {
      await store.set('retry-key', 80);
      expect(await store.get('retry-key')).toBe(80);
      expect(await store.get('seed')).toBe(50);
    } finally {
      setItemSpy.mockRestore();
    }
  });

  it('does not loop forever when QuotaExceededError persists after cleanup', async () => {
    const store = makeStore({ storageKey: TEST_KEY, limit: 100, label: 'test' });

    const setItemSpy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      const err = new Error('Quota exceeded');
      err.name = 'QuotaExceededError';
      throw err;
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await store.set('stuck-key', 80);
      // Bounded: a handful of warns across the user-storage error path, factory error path,
      // and the post-cleanup retry-failure log. Unbounded recursion would produce orders of magnitude more.
      expect(warnSpy.mock.calls.length).toBeLessThanOrEqual(6);
    } finally {
      setItemSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('isolates state between two instances with different storage keys', async () => {
    const journeys = makeStore({ storageKey: 'pathfinder.journeys-test', limit: 100, label: 'j' });
    const interactives = makeStore({
      storageKey: 'pathfinder.interactives-test',
      limit: 100,
      label: 'i',
    });

    await journeys.set('shared-key', 10);
    await interactives.set('shared-key', 90);

    expect(await journeys.get('shared-key')).toBe(10);
    expect(await interactives.get('shared-key')).toBe(90);
  });
});
