/**
 * Storage-related type definitions
 * Types for user storage abstraction and persistence
 */

/**
 * Storage interface for user data operations
 * Provides unified API for localStorage and Grafana user storage
 */
export interface UserStorage {
  getItem<T>(key: string): Promise<T | null>;
  setItem<T>(key: string, value: T): Promise<void>;
  removeItem(key: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Storage backend type
 * Indicates which storage mechanism is being used
 */
export type StorageBackend = 'user-storage' | 'local-storage';

/**
 * Narrow shape of the storage object returned by `usePluginUserStorage()` from
 * `@grafana/runtime`. Values are written and read as JSON strings — the
 * hybrid-storage layer wraps them in `StorageEnvelope` form for timestamp-based
 * conflict resolution.
 */
export interface GrafanaUserStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}
