import { logger } from '../logging';
import type { UserStorage } from '../../types/storage.types';

export interface BoundedRecordStorage {
  get(key: string): Promise<number>;
  /**
   * Synchronous read of the whole record — for callers that cannot await one
   * (a path rollup's mean runs synchronously, in several places, and needs
   * the whole record rather than one key: `path-member-join.ts` reads by key
   * presence across several candidate keys per member). The hybrid storage
   * backend writes through to localStorage before it queues the Grafana
   * write, so the value is already there. `{}` when nothing has been
   * written yet or the stored value is malformed.
   */
  peekAll(): Record<string, number>;
  /**
   * Clamps `percentage` to `[0, 100]` and retries once after `cleanup()` on quota errors.
   *
   * On overflow the record is trimmed to `limit` entries: zero-progress
   * entries go first (a missing key reads back as 0, so dropping one loses
   * nothing), then the least recently written of the rest. Writing a key
   * counts as touching it, so a guide the reader keeps returning to outlives
   * one they opened earlier and abandoned.
   */
  set(key: string, percentage: number): Promise<void>;
  clear(key: string): Promise<void>;
  /** Deletes every key in one read-modify-write. Concurrent `clear` calls share one record, so each write restores the keys its siblings deleted. */
  clearMany(keys: string[]): Promise<void>;
  getAll(): Promise<Record<string, number>>;
  /**
   * Trims the record down to `limit` entries, evicting zero-progress entries
   * first and then the least recently written of the rest. No-op when already
   * within budget.
   */
  cleanup(): Promise<void>;
  clearAll(): Promise<void>;
}

export interface BoundedRecordStorageConfig {
  storageKey: string;
  limit: number;
  /** Short label used in diagnostic console messages, e.g. `'journey completion'`. */
  label: string;
  /**
   * Storage backend factory, injected rather than imported. This building
   * block is a lower layer than the user-storage module that supplies the
   * backend; importing it directly would form an import cycle
   * (user-storage → bounded-record-storage → user-storage), so callers pass
   * the factory in.
   */
  createStorage: () => UserStorage;
  /** Quota-exceeded notifier, injected for the same reason as `createStorage`. */
  onQuotaExceeded: () => void;
}

export function createBoundedRecordStorage(config: BoundedRecordStorageConfig): BoundedRecordStorage {
  const { storageKey, limit, label, createStorage, onQuotaExceeded } = config;

  // Serializes every mutation this store instance makes: set/clear/clearMany/
  // cleanup/clearAll all read the whole record at `storageKey`, mutate it, and
  // write the whole record back. Two such calls fired without an await
  // between them both read the same pre-write record, and whichever resolves
  // last silently discards the other's change (a lost update) — reproduced
  // directly in this file's own test suite. Chaining every mutation through
  // this queue guarantees each one sees the previous one's result, regardless
  // of which caller (across the whole codebase — every consumer shares this
  // one queue per store instance) issued it.
  let mutationQueue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mutationQueue.then(operation);
    // Swallow so one failed mutation doesn't poison the queue for mutations
    // queued after it; every operation below already catches and logs its
    // own errors internally.
    mutationQueue = result.catch(() => undefined);
    return result;
  };

  const trimToLimit = (data: Record<string, number>): Record<string, number> => {
    const entries = Object.entries(data);
    const surplus = entries.length - limit;
    if (surplus <= 0) {
      return data;
    }
    const evicted = new Set<string>();
    for (const [key, value] of entries) {
      if (evicted.size >= surplus) {
        break;
      }
      if (value <= 0) {
        evicted.add(key);
      }
    }
    const survivors = entries.filter(([key]) => !evicted.has(key));
    // A just-written 0 is evictable like any other, so writing one at the cap
    // leaves the record untouched. Intended: a stored 0 and an absent key read
    // back identically, so displacing a real record for one is a pure loss.
    return Object.fromEntries(survivors.slice(-limit));
  };

  const writeWithCap = async (data: Record<string, number>): Promise<void> => {
    const storage = createStorage();
    await storage.setItem(storageKey, trimToLimit(data));
  };

  // Raw (unserialized) cleanup, shared by the public `cleanup()` (wrapped in
  // `serialize` below) and `setInternal`'s quota-retry path. The retry path
  // runs from inside an already-serialized `set()` call, so it must call this
  // directly rather than the public `api.cleanup()` — going through
  // `serialize` there would queue the retry's cleanup behind itself and
  // deadlock, since the still-running `set()` call is what the queue is
  // currently waiting on.
  const cleanupInternal = async (): Promise<void> => {
    try {
      const storage = createStorage();
      const data = (await storage.getItem<Record<string, number>>(storageKey)) || {};
      if (Object.keys(data).length > limit) {
        await writeWithCap(data);
      }
    } catch (error) {
      logger.warn(`Failed to cleanup ${label} entries`, { error });
    }
  };

  const setInternal = async (key: string, percentage: number, hasRetried: boolean): Promise<void> => {
    try {
      const storage = createStorage();
      const data = (await storage.getItem<Record<string, number>>(storageKey)) || {};
      // Delete before re-adding so the key moves to the end of the record's
      // key order, which is what `trimToLimit` reads as write recency.
      delete data[key];
      data[key] = Math.max(0, Math.min(100, percentage));
      await writeWithCap(data);
    } catch (error) {
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        if (hasRetried) {
          // Quota still exceeded after cleanup — likely consumed by other keys.
          // Stop here rather than recursing forever.
          logger.warn(`Failed to save ${label} percentage after cleanup retry`, { error });
          return;
        }
        logger.warn(`Storage quota exceeded, clearing old ${label} data`);
        onQuotaExceeded();
        await cleanupInternal();
        await setInternal(key, percentage, true);
      } else {
        logger.warn(`Failed to save ${label} percentage`, { error });
      }
    }
  };

  const api: BoundedRecordStorage = {
    async get(key: string): Promise<number> {
      try {
        const storage = createStorage();
        const data = await storage.getItem<Record<string, number>>(storageKey);
        return data?.[key] || 0;
      } catch {
        return 0;
      }
    },

    peekAll(): Record<string, number> {
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) {
          return {};
        }
        const data = JSON.parse(raw) as unknown;
        return data && typeof data === 'object' ? (data as Record<string, number>) : {};
      } catch {
        return {};
      }
    },

    async set(key: string, percentage: number): Promise<void> {
      await serialize(() => setInternal(key, percentage, false));
    },

    async clear(key: string): Promise<void> {
      await serialize(async () => {
        try {
          const storage = createStorage();
          const data = (await storage.getItem<Record<string, number>>(storageKey)) || {};
          delete data[key];
          await storage.setItem(storageKey, data);
        } catch (error) {
          logger.warn(`Failed to clear ${label}`, { error });
        }
      });
    },

    async clearMany(keys: string[]): Promise<void> {
      await serialize(async () => {
        try {
          const storage = createStorage();
          const data = (await storage.getItem<Record<string, number>>(storageKey)) || {};
          for (const key of keys) {
            delete data[key];
          }
          await storage.setItem(storageKey, data);
        } catch (error) {
          logger.warn(`Failed to clear ${label}`, { error });
        }
      });
    },

    async getAll(): Promise<Record<string, number>> {
      try {
        const storage = createStorage();
        return (await storage.getItem<Record<string, number>>(storageKey)) || {};
      } catch {
        return {};
      }
    },

    async cleanup(): Promise<void> {
      await serialize(cleanupInternal);
    },

    async clearAll(): Promise<void> {
      await serialize(async () => {
        try {
          const storage = createStorage();
          await storage.removeItem(storageKey);
        } catch (error) {
          logger.warn(`Failed to clear all ${label} entries`, { error });
        }
      });
    },
  };

  return api;
}
