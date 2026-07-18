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
