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
