import { createUserStorage, warnQuotaExceededOnce } from '../user-storage';

export interface BoundedRecordStorage {
  get(key: string): Promise<number>;
  /** Clamps `percentage` to `[0, 100]`, trims down to `limit` entries on overflow, and retries once after `cleanup()` on quota errors. */
  set(key: string, percentage: number): Promise<void>;
  clear(key: string): Promise<void>;
  getAll(): Promise<Record<string, number>>;
  /** Trims the record down to `limit` entries (most recent kept). No-op when already within budget. */
  cleanup(): Promise<void>;
  clearAll(): Promise<void>;
}

export interface BoundedRecordStorageConfig {
  storageKey: string;
  limit: number;
  /** Short label used in diagnostic console messages, e.g. `'journey completion'`. */
  label: string;
}

export function createBoundedRecordStorage(config: BoundedRecordStorageConfig): BoundedRecordStorage {
  const { storageKey, limit, label } = config;

  const writeWithCap = async (data: Record<string, number>): Promise<void> => {
    const storage = createUserStorage();
    const entries = Object.entries(data);
    const payload = entries.length > limit ? Object.fromEntries(entries.slice(-limit)) : data;
    await storage.setItem(storageKey, payload);
  };

  const setInternal = async (key: string, percentage: number, hasRetried: boolean): Promise<void> => {
    try {
      const storage = createUserStorage();
      const data = (await storage.getItem<Record<string, number>>(storageKey)) || {};
      data[key] = Math.max(0, Math.min(100, percentage));
      await writeWithCap(data);
    } catch (error) {
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        if (hasRetried) {
          // Quota still exceeded after cleanup — likely consumed by other keys.
          // Stop here rather than recursing forever.
          console.warn(`Failed to save ${label} percentage after cleanup retry:`, error);
          return;
        }
        console.warn(`Storage quota exceeded, clearing old ${label} data`);
        warnQuotaExceededOnce();
        await api.cleanup();
        await setInternal(key, percentage, true);
      } else {
        console.warn(`Failed to save ${label} percentage:`, error);
      }
    }
  };

  const api: BoundedRecordStorage = {
    async get(key: string): Promise<number> {
      try {
        const storage = createUserStorage();
        const data = await storage.getItem<Record<string, number>>(storageKey);
        return data?.[key] || 0;
      } catch {
        return 0;
      }
    },

    async set(key: string, percentage: number): Promise<void> {
      await setInternal(key, percentage, false);
    },

    async clear(key: string): Promise<void> {
      try {
        const storage = createUserStorage();
        const data = (await storage.getItem<Record<string, number>>(storageKey)) || {};
        delete data[key];
        await storage.setItem(storageKey, data);
      } catch (error) {
        console.warn(`Failed to clear ${label}:`, error);
      }
    },

    async getAll(): Promise<Record<string, number>> {
      try {
        const storage = createUserStorage();
        return (await storage.getItem<Record<string, number>>(storageKey)) || {};
      } catch {
        return {};
      }
    },

    async cleanup(): Promise<void> {
      try {
        const storage = createUserStorage();
        const data = (await storage.getItem<Record<string, number>>(storageKey)) || {};
        if (Object.keys(data).length > limit) {
          await writeWithCap(data);
        }
      } catch (error) {
        console.warn(`Failed to cleanup ${label} entries:`, error);
      }
    },

    async clearAll(): Promise<void> {
      try {
        const storage = createUserStorage();
        await storage.removeItem(storageKey);
      } catch (error) {
        console.warn(`Failed to clear all ${label} entries:`, error);
      }
    },
  };

  return api;
}
