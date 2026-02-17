/**
 * User storage abstraction for the Grafana Docs Plugin
 *
 * This module provides a unified storage API with a hybrid approach to ensure
 * data persistence even during page navigations/refreshes.
 *
 * Storage Strategy:
 * - When Grafana user storage is available (11.5+):
 *   1. Writes to localStorage immediately (synchronous, survives page refresh)
 *   2. Queues async writes to Grafana storage (eventual consistency)
 *   3. Reads from localStorage (fast, always available)
 *   4. On init, syncs bidirectionally using timestamp-based conflict resolution
 *
 * - When Grafana user storage is unavailable:
 *   Falls back to localStorage only
 *
 * Conflict Resolution:
 * - Each write/delete includes a timestamp
 * - On initialization, timestamps are compared between localStorage and Grafana storage
 * - The most recent operation (last-write-wins) is applied
 * - Deletions are represented by timestamp without data
 * - If localStorage is newer, it syncs back to Grafana storage
 * - This handles cases where page refresh happened before Grafana storage could sync
 *
 * Key features:
 * - No data loss during page navigation/refresh
 * - User-specific storage in Grafana database (when available)
 * - Timestamp-based conflict resolution (last-write-wins)
 * - Proper deletion propagation across devices
 * - Eventual consistency between localStorage and Grafana storage
 * - Security measures for quota exhaustion
 * - Type-safe operations with JSON serialization
 * - Consistent API across storage mechanisms
 *
 * SECURITY NOTE: Data is NOT encrypted. Do not store sensitive information.
 */

import { usePluginUserStorage } from '@grafana/runtime';
import { useCallback, useRef, useEffect } from 'react';
import { z } from 'zod';

import type { LearningProgress, EarnedBadgeRecord } from '../types/learning-paths.types';
import { reportAppInteraction, UserInteraction } from './analytics';
import { StorageKeys } from './storage-keys';

// ============================================================================
// LEARNING PROGRESS SCHEMA (for defense-in-depth validation)
// ============================================================================

const EarnedBadgeRecordSchema = z.object({
  id: z.string(),
  earnedAt: z.number(),
});

const LearningProgressSchema = z.object({
  completedGuides: z.array(z.string()),
  earnedBadges: z.array(EarnedBadgeRecordSchema),
  streakDays: z.number(),
  lastActivityDate: z.string(),
  pendingCelebrations: z.array(z.string()),
});

const DEFAULT_PROGRESS: LearningProgress = {
  completedGuides: [],
  earnedBadges: [],
  streakDays: 0,
  lastActivityDate: '',
  pendingCelebrations: [],
};

// ============================================================================
// GUIDE RESPONSES SCHEMA (for input block variable storage)
// ============================================================================

/** Supported response value types from input blocks */
export type GuideResponseValue = string | boolean | number;

/** Schema for individual response values */
const GuideResponseValueSchema = z.union([z.string(), z.boolean(), z.number()]);

/** Schema for all responses (guideId -> variableName -> value) */
const GuideResponsesSchema = z.record(z.string(), z.record(z.string(), GuideResponseValueSchema));

/** Type for all guide responses */
export type GuideResponses = z.infer<typeof GuideResponsesSchema>;

const DEFAULT_GUIDE_RESPONSES: GuideResponses = {};

// ============================================================================
// STORAGE KEYS
// Re-exported from storage-keys.ts for backward compatibility.
// The separate file allows importing keys without browser dependencies
// (e.g., in Playwright E2E tests).
// ============================================================================

export { StorageKeys, type StorageKeyName, type StorageKeyValue } from './storage-keys';

// Timestamp suffix used by the OLD storage format (separate companion keys).
// Kept for migration detection and cleanup only — new writes use envelope format.
const TIMESTAMP_SUFFIX = '__timestamp';

/**
 * Gets the timestamp key for a given storage key (old format, used during migration)
 */
function getTimestampKey(key: string): string {
  return `${key}${TIMESTAMP_SUFFIX}`;
}

// ============================================================================
// ENVELOPE FORMAT HELPERS
// ============================================================================

/**
 * Envelope wrapper for Grafana storage values.
 * Embeds the timestamp alongside the value in a single key, eliminating
 * the need for separate `__timestamp` companion keys.
 */
export interface StorageEnvelope {
  /** The serialized value (JSON string) */
  v: string;
  /** Timestamp in milliseconds */
  t: number;
}

/**
 * Wraps a value and timestamp into an envelope for Grafana storage.
 * Deletion is represented by an empty-string value with a timestamp.
 */
export function wrapEnvelope(serializedValue: string, timestamp: number): string {
  const envelope: StorageEnvelope = { v: serializedValue, t: timestamp };
  return JSON.stringify(envelope);
}

/**
 * Attempts to unwrap an envelope. Returns null if the value is not in envelope format
 * (i.e. it's old-format raw data).
 */
export function unwrapEnvelope(raw: string | null | undefined): StorageEnvelope | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'v' in parsed && 't' in parsed && typeof parsed.t === 'number') {
      return parsed as StorageEnvelope;
    }
  } catch {
    // Not JSON or not an envelope — old format
  }
  return null;
}

// ============================================================================
// SECURITY LIMITS
// ============================================================================

const LIMITS = {
  MAX_JOURNEY_COMPLETIONS: 100, // Prevent quota exhaustion
  MAX_INTERACTIVE_COMPLETIONS: 100, // Prevent quota exhaustion
  MAX_PERSISTED_TABS: 50, // Prevent quota exhaustion
} as const;

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

import type { UserStorage, StorageBackend } from '../types/storage.types';

// Re-export for backward compatibility with existing imports
export type { UserStorage, StorageBackend };

// ============================================================================
// STORAGE IMPLEMENTATION
// ============================================================================

/**
 * Global storage instance that can be initialized from React components
 * This allows non-React code to use Grafana's user storage when available
 */
let globalStorageInstance: UserStorage | null = null;
let storageInitialized = false;

/**
 * Sets the global storage instance (called from React components with access to Grafana storage)
 */
export function setGlobalStorage(storage: UserStorage): void {
  const wasInitialized = storageInitialized;
  globalStorageInstance = storage;
  storageInitialized = true;

  // Only log once when first initialized
  if (!wasInitialized) {
    // Migration will be triggered separately
  }
}

/**
 * Gets the global storage instance, falling back to localStorage if not initialized
 *
 * This is used by all standalone (non-React) storage helpers.
 * For React components, use the useUserStorage hook which can leverage Grafana's user storage.
 *
 * @returns UserStorage - Storage interface with async operations
 */
function createUserStorage(): UserStorage {
  return globalStorageInstance || createLocalStorage();
}

/**
 * Creates a storage implementation using browser localStorage
 *
 * This is the fallback for when Grafana user storage is unavailable.
 */
function createLocalStorage(): UserStorage {
  return {
    async getItem<T>(key: string): Promise<T | null> {
      try {
        const value = localStorage.getItem(key);
        if (value === null) {
          return null;
        }
        try {
          return JSON.parse(value) as T;
        } catch {
          // Not JSON, return as-is
          return value as unknown as T;
        }
      } catch (error) {
        console.warn(`Failed to get item from localStorage: ${key}`, error);
        return null;
      }
    },

    async setItem<T>(key: string, value: T): Promise<void> {
      try {
        const serialized = JSON.stringify(value);
        localStorage.setItem(key, serialized);
      } catch (error) {
        // SECURITY: Handle QuotaExceededError
        if (error instanceof Error && error.name === 'QuotaExceededError') {
          console.warn('localStorage quota exceeded', error);
          throw error;
        }
        console.error(`Failed to set item in localStorage: ${key}`, error);
        throw error;
      }
    },

    async removeItem(key: string): Promise<void> {
      try {
        localStorage.removeItem(key);
      } catch (error) {
        console.warn(`Failed to remove item from localStorage: ${key}`, error);
      }
    },

    async clear(): Promise<void> {
      try {
        // Only clear keys that belong to this plugin
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('grafana-pathfinder-app-')) {
            keys.push(key);
          }
        }
        keys.forEach((key) => localStorage.removeItem(key));
      } catch (error) {
        console.warn('Failed to clear localStorage', error);
      }
    },
  };
}

/**
 * Creates a hybrid storage implementation that writes to localStorage immediately
 * and then syncs to Grafana user storage asynchronously for eventual consistency.
 *
 * This prevents data loss during page navigation/refresh while maintaining
 * the benefits of user-scoped storage in Grafana.
 *
 * Strategy:
 * 1. Writes happen to localStorage first (synchronous, reliable)
 * 2. Then queued to Grafana storage (async, eventual consistency)
 * 3. Reads come from localStorage (fast, always available)
 * 4. On init, sync from Grafana storage to localStorage (Grafana is source of truth)
 */
function createHybridStorage(grafanaStorage: any): UserStorage {
  const localStorage = createLocalStorage();

  // Queue for async writes to Grafana storage.
  // Each entry is an envelope-formatted string ready to be written.
  const writeQueue: Array<{ key: string; value: string }> = [];
  let isProcessingQueue = false;

  // Debounce timer for queue processing
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Process queued writes to Grafana storage with deduplication.
  // Only the latest value per key is sent (earlier writes for the same key are dropped).
  const processQueue = async () => {
    if (isProcessingQueue || writeQueue.length === 0) {
      return;
    }

    isProcessingQueue = true;

    // Deduplicate: collapse entries so only the latest value per key is sent
    const deduped = new Map<string, string>();
    while (writeQueue.length > 0) {
      const item = writeQueue.shift()!;
      deduped.set(item.key, item.value);
    }

    for (const [key, value] of deduped) {
      try {
        await grafanaStorage.setItem(key, value);
      } catch (error) {
        console.warn(`Failed to sync to Grafana storage: ${key}`, error);
        // Don't retry - localStorage is the immediate source of truth
      }
    }

    isProcessingQueue = false;

    // Re-check: items may have been added during the await calls above.
    // If the debounce timer fired while we were processing, it bailed early
    // due to the isProcessingQueue guard, leaving those items stranded.
    // Process them now.
    if (writeQueue.length > 0) {
      processQueue().catch((error) => {
        console.warn('Error processing Grafana storage queue:', error);
      });
    }
  };

  // Schedule queue processing with debounce (500ms) so rapid writes
  // batch into a single queue drain instead of firing individually.
  const scheduleQueueProcessing = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      processQueue().catch((error) => {
        console.warn('Error processing Grafana storage queue:', error);
      });
    }, 500);
  };

  return {
    async getItem<T>(key: string): Promise<T | null> {
      // Read from localStorage for immediate access
      return localStorage.getItem<T>(key);
    },

    async setItem<T>(key: string, value: T): Promise<void> {
      try {
        const serialized = JSON.stringify(value);
        const timestamp = Date.now();

        // 1. Write to localStorage first (synchronous, survives page refresh)
        await localStorage.setItem(key, value);
        // Store timestamp in localStorage for conflict resolution
        await localStorage.setItem(getTimestampKey(key), timestamp);

        // 2. Queue a single envelope write to Grafana storage (halves API calls)
        writeQueue.push({ key, value: wrapEnvelope(serialized, timestamp) });

        // Process queue in background with debounce
        scheduleQueueProcessing();
      } catch (error) {
        // If localStorage fails, at least try Grafana storage
        console.warn(`Failed to write to localStorage: ${key}, trying Grafana storage`, error);
        try {
          const serialized = JSON.stringify(value);
          const timestamp = Date.now();
          await grafanaStorage.setItem(key, wrapEnvelope(serialized, timestamp));
        } catch (grafanaError) {
          console.error(`Failed to write to both storages: ${key}`, grafanaError);
          throw grafanaError;
        }
      }
    },

    async removeItem(key: string): Promise<void> {
      const timestamp = Date.now();

      // Remove from localStorage first
      await localStorage.removeItem(key);
      // Store deletion timestamp so we can resolve conflicts properly
      await localStorage.setItem(getTimestampKey(key), timestamp);

      // Queue a single envelope write for deletion (empty value with timestamp)
      writeQueue.push({ key, value: wrapEnvelope('', timestamp) });
      scheduleQueueProcessing();
    },

    async clear(): Promise<void> {
      // Clear localStorage
      await localStorage.clear();

      // Note: Grafana storage doesn't support bulk clear
      console.warn('Clear operation not fully supported for Grafana user storage');
    },
  };
}

/**
 * Module-level guard: ensures syncFromGrafanaStorage runs at most once per page lifecycle.
 * Multiple `useUserStorage()` mounts (React Strict Mode, component remounts) would
 * otherwise trigger 3-6 syncs per page load, each generating 10-20 API calls.
 */
let hasSynced = false;

/**
 * Reads a key from Grafana storage and returns its value and timestamp,
 * handling both the new envelope format and the old separate-timestamp format.
 *
 * During migration: if the old format is detected (separate `__timestamp` key),
 * the data is re-written in envelope format and the orphaned timestamp key is deleted
 * from both Grafana storage and localStorage.
 */
async function readGrafanaKeyWithMigration(
  grafanaStorage: any,
  key: string
): Promise<{ value: string | null; timestamp: number; migrated: boolean }> {
  const rawValue = await grafanaStorage.getItem(key);

  // Try to unwrap as new envelope format first
  const envelope = unwrapEnvelope(rawValue);
  if (envelope) {
    return {
      value: envelope.v && envelope.v !== '' ? envelope.v : null,
      timestamp: envelope.t,
      migrated: false,
    };
  }

  // Not envelope format — check for old separate-timestamp format
  const oldTimestampStr = await grafanaStorage.getItem(getTimestampKey(key));
  const oldTimestamp = oldTimestampStr ? parseInt(oldTimestampStr, 10) : 0;
  const hasData = rawValue && rawValue !== '';

  if (oldTimestamp > 0 || hasData) {
    // Old format detected — migrate to envelope format
    const migratedValue = hasData ? rawValue : '';
    const migratedTimestamp = oldTimestamp || Date.now();

    try {
      // Re-write in envelope format (single key)
      await grafanaStorage.setItem(key, wrapEnvelope(migratedValue, migratedTimestamp));
      // Clear orphaned __timestamp key from Grafana storage (API has no removeItem, so set to empty)
      await grafanaStorage.setItem(getTimestampKey(key), '');
    } catch (error) {
      console.warn(`Failed to migrate key to envelope format: ${key}`, error);
    }

    // NOTE: Do NOT clean up localStorage __timestamp key here.
    // syncFromGrafanaStorage still needs it for conflict resolution, and it must
    // persist for future page loads. Only Grafana storage migrates to envelope format;
    // localStorage continues using the separate timestamp key pattern.

    return {
      value: hasData ? rawValue : null,
      timestamp: migratedTimestamp,
      migrated: true,
    };
  }

  // No data at all
  return { value: null, timestamp: 0, migrated: false };
}

/**
 * Syncs data from Grafana user storage to localStorage on initialization.
 * Uses timestamp comparison to keep the most recent data (last-write-wins).
 *
 * Automatically migrates old-format data (separate `__timestamp` keys) to the
 * new envelope format and cleans up orphaned keys.
 *
 * Deletion Handling:
 * - Deletions are represented by a timestamp without data (value is empty/null)
 * - If a deletion timestamp is newer than existing data, the deletion is applied
 * - This ensures deletions propagate correctly across devices/sessions
 */
async function syncFromGrafanaStorage(grafanaStorage: any): Promise<void> {
  // Guard: only sync once per page lifecycle
  if (hasSynced) {
    return;
  }
  hasSynced = true;

  try {
    const keysToSync = [
      StorageKeys.JOURNEY_COMPLETION,
      StorageKeys.TABS,
      StorageKeys.ACTIVE_TAB,
      StorageKeys.LEARNING_PROGRESS,
      StorageKeys.GUIDE_RESPONSES,
    ];

    for (const key of keysToSync) {
      try {
        // Read from Grafana storage (with automatic migration of old format)
        const grafana = await readGrafanaKeyWithMigration(grafanaStorage, key);

        // Read from localStorage
        const localValue = window.localStorage.getItem(key);
        const localTimestampRaw = window.localStorage.getItem(getTimestampKey(key));
        const localTimestamp = localTimestampRaw ? parseInt(localTimestampRaw, 10) : 0;

        const hasGrafanaData = grafana.value !== null;
        const hasLocalData = localValue !== null && localValue !== '';
        const hasGrafanaTimestamp = grafana.timestamp > 0;
        const hasLocalTimestamp = localTimestamp > 0;

        // Conflict resolution based on timestamps
        if (hasGrafanaTimestamp && hasLocalTimestamp) {
          if (grafana.timestamp > localTimestamp) {
            // Grafana is newer
            if (hasGrafanaData) {
              window.localStorage.setItem(key, grafana.value!);
            } else {
              window.localStorage.removeItem(key);
            }
            window.localStorage.setItem(getTimestampKey(key), grafana.timestamp.toString());
          } else if (localTimestamp > grafana.timestamp) {
            // localStorage is newer — sync back to Grafana in envelope format
            const serialized = hasLocalData ? localValue! : '';
            await grafanaStorage.setItem(key, wrapEnvelope(serialized, localTimestamp));
          }
          // If timestamps are equal, they're in sync
        } else if (hasGrafanaTimestamp && !hasLocalData) {
          if (hasGrafanaData) {
            window.localStorage.setItem(key, grafana.value!);
            window.localStorage.setItem(getTimestampKey(key), grafana.timestamp.toString());
          }
        } else if (hasGrafanaTimestamp && hasLocalData) {
          // Grafana has timestamp but localStorage has un-timestamped data
          // PRESERVE localStorage data — assign timestamp and sync to Grafana
          const nowTimestamp = Date.now();
          window.localStorage.setItem(getTimestampKey(key), nowTimestamp.toString());
          await grafanaStorage.setItem(key, wrapEnvelope(localValue!, nowTimestamp));
        } else if (hasLocalTimestamp) {
          // Only localStorage has timestamp — sync to Grafana in envelope format
          const serialized = hasLocalData ? localValue! : '';
          await grafanaStorage.setItem(key, wrapEnvelope(serialized, localTimestamp));
        } else if (hasLocalData) {
          // localStorage has data but no timestamp — assign one and sync
          const nowTimestamp = Date.now();
          window.localStorage.setItem(getTimestampKey(key), nowTimestamp.toString());
          await grafanaStorage.setItem(key, wrapEnvelope(localValue!, nowTimestamp));
        }
        // If neither has data, nothing to sync
      } catch (error) {
        console.warn(`Failed to sync key from Grafana storage: ${key}`, error);
      }
    }

    // NOTE: We do NOT clean up localStorage __timestamp keys here.
    // They're still used by the hybrid storage for conflict resolution on future page loads.
    // The Grafana storage side has been migrated to envelope format, but localStorage
    // continues using the separate timestamp key pattern.
  } catch (error) {
    console.warn('Failed to sync from Grafana storage:', error);
  }
}

// ============================================================================
// REACT HOOK
// ============================================================================

/**
 * React hook that provides access to user storage with Grafana integration
 *
 * This hook uses Grafana's user storage API when available (11.5+) and falls back
 * to localStorage for older versions or when the feature flag is disabled.
 *
 * @returns UserStorage - Storage interface with async operations
 *
 * @example
 * ```typescript
 * function MyComponent() {
 *   const storage = useUserStorage();
 *
 *   useEffect(() => {
 *     storage.getItem('my-key').then(value => {
 *       console.log('Stored value:', value);
 *     });
 *   }, [storage]);
 *
 *   const handleSave = async () => {
 *     await storage.setItem('my-key', { foo: 'bar' });
 *   };
 *
 *   return <button onClick={handleSave}>Save</button>;
 * }
 * ```
 */
export function useUserStorage(): UserStorage {
  // Try to use Grafana's user storage API
  // This will be null/undefined if not available (older Grafana or feature flag disabled)
  const grafanaStorage = usePluginUserStorage();
  const storageRef = useRef<UserStorage | null>(null);

  // Initialize storage on mount based on availability
  useEffect(() => {
    let storage: UserStorage;

    try {
      // Check if Grafana storage is actually available and functional
      if (grafanaStorage && typeof grafanaStorage.getItem === 'function') {
        // Use hybrid storage: localStorage for immediate writes, Grafana for sync
        storage = createHybridStorage(grafanaStorage);
        storageRef.current = storage;

        // Set global storage so standalone helpers can use it
        setGlobalStorage(storage);

        // Sync from Grafana storage to localStorage on init
        // Grafana storage is the source of truth across devices/sessions
        syncFromGrafanaStorage(grafanaStorage).catch((error) => {
          console.warn('Failed initial sync from Grafana storage:', error);
        });
      } else {
        // Fall back to localStorage only
        storage = createLocalStorage();
        storageRef.current = storage;
        setGlobalStorage(storage);
      }
    } catch {
      // If anything fails, fall back to localStorage
      storage = createLocalStorage();
      storageRef.current = storage;
      setGlobalStorage(storage);
    }
  }, [grafanaStorage]);

  // Return memoized storage operations
  return {
    getItem: useCallback(async <T>(key: string): Promise<T | null> => {
      if (!storageRef.current) {
        storageRef.current = createLocalStorage();
      }
      return storageRef.current.getItem<T>(key);
    }, []),

    setItem: useCallback(async <T>(key: string, value: T): Promise<void> => {
      if (!storageRef.current) {
        storageRef.current = createLocalStorage();
      }
      return storageRef.current.setItem(key, value);
    }, []),

    removeItem: useCallback(async (key: string): Promise<void> => {
      if (!storageRef.current) {
        storageRef.current = createLocalStorage();
      }
      return storageRef.current.removeItem(key);
    }, []),

    clear: useCallback(async (): Promise<void> => {
      if (!storageRef.current) {
        storageRef.current = createLocalStorage();
      }
      return storageRef.current.clear();
    }, []),
  };
}

// ============================================================================
// SPECIALIZED STORAGE HELPERS
// ============================================================================

/**
 * Journey completion storage operations
 *
 * These functions manage learning journey progress with built-in cleanup
 * to prevent storage quota exhaustion.
 */
export const journeyCompletionStorage = {
  /**
   * Gets the completion percentage for a learning journey
   */
  async get(journeyBaseUrl: string): Promise<number> {
    try {
      const storage = createUserStorage();
      const completionData = await storage.getItem<Record<string, number>>(StorageKeys.JOURNEY_COMPLETION);
      return completionData?.[journeyBaseUrl] || 0;
    } catch {
      return 0;
    }
  },

  /**
   * Sets the completion percentage for a learning journey
   *
   * SECURITY: Automatically cleans up old completions to prevent quota exhaustion
   */
  async set(journeyBaseUrl: string, percentage: number): Promise<void> {
    try {
      const storage = createUserStorage();
      const completionData = (await storage.getItem<Record<string, number>>(StorageKeys.JOURNEY_COMPLETION)) || {};

      // Clamp percentage between 0 and 100
      completionData[journeyBaseUrl] = Math.max(0, Math.min(100, percentage));

      // SECURITY: Cleanup old completions if too many
      const entries = Object.entries(completionData);
      if (entries.length > LIMITS.MAX_JOURNEY_COMPLETIONS) {
        const reduced = Object.fromEntries(entries.slice(-LIMITS.MAX_JOURNEY_COMPLETIONS));
        await storage.setItem(StorageKeys.JOURNEY_COMPLETION, reduced);
      } else {
        await storage.setItem(StorageKeys.JOURNEY_COMPLETION, completionData);
      }
    } catch (error) {
      // SECURITY: Handle QuotaExceededError gracefully
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        console.warn('Storage quota exceeded, clearing old journey data');
        await journeyCompletionStorage.cleanup();
        // Retry after cleanup
        await journeyCompletionStorage.set(journeyBaseUrl, percentage);
      } else {
        console.warn('Failed to save journey completion percentage:', error);
      }
    }
  },

  /**
   * Clears the completion data for a specific journey
   */
  async clear(journeyBaseUrl: string): Promise<void> {
    try {
      const storage = createUserStorage();
      const completionData = (await storage.getItem<Record<string, number>>(StorageKeys.JOURNEY_COMPLETION)) || {};
      delete completionData[journeyBaseUrl];
      await storage.setItem(StorageKeys.JOURNEY_COMPLETION, completionData);
    } catch (error) {
      console.warn('Failed to clear journey completion:', error);
    }
  },

  /**
   * Gets all journey completions
   */
  async getAll(): Promise<Record<string, number>> {
    try {
      const storage = createUserStorage();
      return (await storage.getItem<Record<string, number>>(StorageKeys.JOURNEY_COMPLETION)) || {};
    } catch {
      return {};
    }
  },

  /**
   * Cleans up old completions to prevent quota exhaustion
   */
  async cleanup(): Promise<void> {
    try {
      const storage = createUserStorage();
      const completionData = (await storage.getItem<Record<string, number>>(StorageKeys.JOURNEY_COMPLETION)) || {};
      const entries = Object.entries(completionData);

      if (entries.length > LIMITS.MAX_JOURNEY_COMPLETIONS) {
        const reduced = Object.fromEntries(entries.slice(-LIMITS.MAX_JOURNEY_COMPLETIONS));
        await storage.setItem(StorageKeys.JOURNEY_COMPLETION, reduced);
      }
    } catch (error) {
      console.warn('Failed to cleanup journey completions:', error);
    }
  },
};

/**
 * Interactive guide completion storage operations
 *
 * Stores completion percentage for interactive guides (bundled and external).
 * Similar to journeyCompletionStorage but for step-based interactive content.
 */
export const interactiveCompletionStorage = {
  /**
   * Gets the completion percentage for an interactive guide
   */
  async get(contentKey: string): Promise<number> {
    try {
      const storage = createUserStorage();
      const completionData = await storage.getItem<Record<string, number>>(StorageKeys.INTERACTIVE_COMPLETION);
      return completionData?.[contentKey] || 0;
    } catch {
      return 0;
    }
  },

  /**
   * Sets the completion percentage for an interactive guide
   *
   * SECURITY: Automatically cleans up old completions to prevent quota exhaustion
   */
  async set(contentKey: string, percentage: number): Promise<void> {
    try {
      const storage = createUserStorage();
      const completionData = (await storage.getItem<Record<string, number>>(StorageKeys.INTERACTIVE_COMPLETION)) || {};

      // Clamp percentage between 0 and 100
      completionData[contentKey] = Math.max(0, Math.min(100, percentage));

      // SECURITY: Cleanup old completions if too many
      const entries = Object.entries(completionData);
      if (entries.length > LIMITS.MAX_INTERACTIVE_COMPLETIONS) {
        const reduced = Object.fromEntries(entries.slice(-LIMITS.MAX_INTERACTIVE_COMPLETIONS));
        await storage.setItem(StorageKeys.INTERACTIVE_COMPLETION, reduced);
      } else {
        await storage.setItem(StorageKeys.INTERACTIVE_COMPLETION, completionData);
      }
    } catch (error) {
      // SECURITY: Handle QuotaExceededError gracefully
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        console.warn('Storage quota exceeded, clearing old interactive completion data');
        await interactiveCompletionStorage.cleanup();
        // Retry after cleanup
        await interactiveCompletionStorage.set(contentKey, percentage);
      } else {
        console.warn('Failed to save interactive completion percentage:', error);
      }
    }
  },

  /**
   * Clears the completion data for a specific interactive guide
   */
  async clear(contentKey: string): Promise<void> {
    try {
      const storage = createUserStorage();
      const completionData = (await storage.getItem<Record<string, number>>(StorageKeys.INTERACTIVE_COMPLETION)) || {};
      delete completionData[contentKey];
      await storage.setItem(StorageKeys.INTERACTIVE_COMPLETION, completionData);
    } catch (error) {
      console.warn('Failed to clear interactive completion:', error);
    }
  },

  /**
   * Gets all interactive guide completions
   */
  async getAll(): Promise<Record<string, number>> {
    try {
      const storage = createUserStorage();
      return (await storage.getItem<Record<string, number>>(StorageKeys.INTERACTIVE_COMPLETION)) || {};
    } catch {
      return {};
    }
  },

  /**
   * Cleans up old completions to prevent quota exhaustion
   */
  async cleanup(): Promise<void> {
    try {
      const storage = createUserStorage();
      const completionData = (await storage.getItem<Record<string, number>>(StorageKeys.INTERACTIVE_COMPLETION)) || {};
      const entries = Object.entries(completionData);

      if (entries.length > LIMITS.MAX_INTERACTIVE_COMPLETIONS) {
        const reduced = Object.fromEntries(entries.slice(-LIMITS.MAX_INTERACTIVE_COMPLETIONS));
        await storage.setItem(StorageKeys.INTERACTIVE_COMPLETION, reduced);
      }
    } catch (error) {
      console.warn('Failed to cleanup interactive completions:', error);
    }
  },

  /**
   * Clears ALL interactive completion data.
   * Used by the "Reset progress" action to wipe completion percentages for every guide.
   */
  async clearAll(): Promise<void> {
    try {
      const storage = createUserStorage();
      await storage.removeItem(StorageKeys.INTERACTIVE_COMPLETION);
    } catch (error) {
      console.warn('Failed to clear all interactive completions:', error);
    }
  },
};

/**
 * Tab persistence storage operations
 */
export const tabStorage = {
  /**
   * Gets persisted tabs
   */
  async getTabs<T>(): Promise<T[]> {
    try {
      const storage = createUserStorage();
      return (await storage.getItem<T[]>(StorageKeys.TABS)) || [];
    } catch {
      return [];
    }
  },

  /**
   * Sets persisted tabs
   *
   * SECURITY: Automatically limits number of tabs to prevent quota exhaustion
   */
  async setTabs<T>(tabs: T[]): Promise<void> {
    try {
      const storage = createUserStorage();

      // SECURITY: Limit number of persisted tabs
      const tabsToSave = tabs.slice(-LIMITS.MAX_PERSISTED_TABS);

      await storage.setItem(StorageKeys.TABS, tabsToSave);
    } catch (error) {
      // SECURITY: Handle QuotaExceededError
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        console.warn('Storage quota exceeded, reducing number of tabs');
        // Save only the most recent 25 tabs
        const reducedTabs = tabs.slice(-25);
        const storage = createUserStorage();
        await storage.setItem(StorageKeys.TABS, reducedTabs);
      } else {
        console.warn('Failed to save tabs:', error);
      }
    }
  },

  /**
   * Gets the active tab ID
   */
  async getActiveTab(): Promise<string | null> {
    try {
      const storage = createUserStorage();
      return await storage.getItem<string>(StorageKeys.ACTIVE_TAB);
    } catch {
      return null;
    }
  },

  /**
   * Sets the active tab ID
   */
  async setActiveTab(tabId: string): Promise<void> {
    try {
      const storage = createUserStorage();
      await storage.setItem(StorageKeys.ACTIVE_TAB, tabId);
    } catch (error) {
      console.warn('Failed to save active tab:', error);
    }
  },

  /**
   * Clears all tab data
   */
  async clear(): Promise<void> {
    try {
      const storage = createUserStorage();
      await storage.removeItem(StorageKeys.TABS);
      await storage.removeItem(StorageKeys.ACTIVE_TAB);
    } catch (error) {
      console.warn('Failed to clear tab data:', error);
    }
  },
};

/**
 * Cache for countAllCompleted to avoid O(n) localStorage scan on every step completion.
 * Invalidated by setCompleted, clear, and clearAllForContent operations.
 */
const completedCountCache = new Map<string, number>();

/**
 * Interactive step completion storage operations
 */
export const interactiveStepStorage = {
  /**
   * Gets completed step IDs for a specific content/section
   */
  async getCompleted(contentKey: string, sectionId: string): Promise<Set<string>> {
    try {
      const storage = createUserStorage();
      const key = `${StorageKeys.INTERACTIVE_STEPS_PREFIX}${contentKey}-${sectionId}`;
      const ids = await storage.getItem<string[]>(key);
      return new Set(ids || []);
    } catch {
      return new Set();
    }
  },

  /**
   * Sets completed step IDs for a specific content/section
   */
  async setCompleted(contentKey: string, sectionId: string, completedIds: Set<string>): Promise<void> {
    try {
      // Invalidate count cache before write so next countAllCompleted() re-scans
      completedCountCache.delete(contentKey);
      const storage = createUserStorage();
      const key = `${StorageKeys.INTERACTIVE_STEPS_PREFIX}${contentKey}-${sectionId}`;
      await storage.setItem(key, Array.from(completedIds));
    } catch (error) {
      console.warn('Failed to save completed steps:', error);
    }
  },

  /**
   * Clears completed steps for a specific content/section
   */
  async clear(contentKey: string, sectionId: string): Promise<void> {
    try {
      completedCountCache.delete(contentKey);
      const storage = createUserStorage();
      const key = `${StorageKeys.INTERACTIVE_STEPS_PREFIX}${contentKey}-${sectionId}`;
      await storage.removeItem(key);
    } catch (error) {
      console.warn('Failed to clear completed steps:', error);
    }
  },

  /**
   * Check if any progress exists for a content key (any section)
   */
  async hasProgress(contentKey: string): Promise<boolean> {
    try {
      const prefix = `${StorageKeys.INTERACTIVE_STEPS_PREFIX}${contentKey}-`;
      // Check localStorage directly for keys matching the prefix
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(prefix)) {
          const value = localStorage.getItem(key);
          if (value) {
            try {
              const ids = JSON.parse(value);
              if (Array.isArray(ids) && ids.length > 0) {
                return true;
              }
            } catch {
              // Invalid JSON, skip
            }
          }
        }
      }
      return false;
    } catch {
      return false;
    }
  },

  /**
   * Clear all progress for a content key (all sections)
   * Also clears section collapse states for the same content
   */
  async clearAllForContent(contentKey: string): Promise<void> {
    try {
      completedCountCache.delete(contentKey);
      const stepsPrefix = `${StorageKeys.INTERACTIVE_STEPS_PREFIX}${contentKey}-`;
      const collapsePrefix = `${StorageKeys.SECTION_COLLAPSE_PREFIX}${contentKey}-`;

      // Find and remove all matching keys
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith(stepsPrefix) || key.startsWith(collapsePrefix))) {
          keysToRemove.push(key);
        }
      }

      // Remove all matching keys
      keysToRemove.forEach((key) => localStorage.removeItem(key));
    } catch (error) {
      console.warn('Failed to clear all progress for content:', error);
    }
  },

  /**
   * Count ALL completed step IDs across every section for a given content key.
   * Scans all localStorage entries matching the content key prefix and sums the
   * lengths of their step ID arrays. Used to compute a unified completion percentage
   * that correctly accounts for both section-managed and standalone steps.
   *
   * Results are cached per contentKey and invalidated by setCompleted, clear, and
   * clearAllForContent to avoid an O(n) localStorage scan on every step completion.
   */
  /**
   * Clear ALL interactive step and section collapse data across every content key.
   * Used by the "Reset progress" action to ensure guides don't instantly re-complete.
   * Also fully invalidates the in-memory completedCountCache.
   */
  async clearAll(): Promise<void> {
    try {
      completedCountCache.clear();
      const stepsPrefix = StorageKeys.INTERACTIVE_STEPS_PREFIX;
      const collapsePrefix = StorageKeys.SECTION_COLLAPSE_PREFIX;

      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith(stepsPrefix) || key.startsWith(collapsePrefix))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key));
    } catch (error) {
      console.warn('Failed to clear all interactive step data:', error);
    }
  },

  countAllCompleted(contentKey: string): number {
    const cached = completedCountCache.get(contentKey);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const prefix = `${StorageKeys.INTERACTIVE_STEPS_PREFIX}${contentKey}-`;
      let total = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(prefix)) {
          const value = localStorage.getItem(key);
          if (value) {
            try {
              const ids = JSON.parse(value);
              if (Array.isArray(ids)) {
                total += ids.length;
              }
            } catch {
              // Invalid JSON, skip
            }
          }
        }
      }
      completedCountCache.set(contentKey, total);
      return total;
    } catch {
      return 0;
    }
  },
};

/**
 * Section collapse state storage operations
 */
export const sectionCollapseStorage = {
  /**
   * Gets the collapse state for a specific section
   */
  async get(contentKey: string, sectionId: string): Promise<boolean> {
    try {
      const storage = createUserStorage();
      const key = `${StorageKeys.SECTION_COLLAPSE_PREFIX}${contentKey}-${sectionId}`;
      const isCollapsed = await storage.getItem<boolean>(key);
      return isCollapsed ?? false; // Default to expanded (false)
    } catch {
      return false; // Default to expanded on error
    }
  },

  /**
   * Sets the collapse state for a specific section
   */
  async set(contentKey: string, sectionId: string, isCollapsed: boolean): Promise<void> {
    try {
      const storage = createUserStorage();
      const key = `${StorageKeys.SECTION_COLLAPSE_PREFIX}${contentKey}-${sectionId}`;
      await storage.setItem(key, isCollapsed);
    } catch (error) {
      console.warn('Failed to save section collapse state:', error);
    }
  },

  /**
   * Clears collapse state for a specific section
   */
  async clear(contentKey: string, sectionId: string): Promise<void> {
    try {
      const storage = createUserStorage();
      const key = `${StorageKeys.SECTION_COLLAPSE_PREFIX}${contentKey}-${sectionId}`;
      await storage.removeItem(key);
    } catch (error) {
      console.warn('Failed to clear section collapse state:', error);
    }
  },
};

/**
 * Full screen mode state storage operations
 * Used to persist recording state across page refreshes
 */
export interface PersistedFullScreenState {
  state: 'inactive' | 'active' | 'editing' | 'bundling' | 'bundling-review';
  singleCapture: boolean;
  initialSectionId: string | null;
}

export interface PersistedBundledStep {
  selector: string;
  action: string;
  selectorInfo: {
    method: string;
    isUnique: boolean;
    matchCount: number;
    contextStrategy?: string;
  };
  interactiveComment?: string;
  requirements?: string;
}

export interface PersistedSectionInfo {
  sectionId?: string;
  sectionTitle?: string;
  description?: string;
  interactiveComment?: string;
  requirements?: string;
}

export const fullScreenModeStorage = {
  /**
   * Gets the persisted full screen mode state
   */
  async getState(): Promise<PersistedFullScreenState | null> {
    try {
      const storage = createUserStorage();
      return await storage.getItem<PersistedFullScreenState>(StorageKeys.FULLSCREEN_MODE_STATE);
    } catch {
      return null;
    }
  },

  /**
   * Sets the full screen mode state
   */
  async setState(state: PersistedFullScreenState): Promise<void> {
    try {
      const storage = createUserStorage();
      await storage.setItem(StorageKeys.FULLSCREEN_MODE_STATE, state);
    } catch (error) {
      console.warn('Failed to save full screen mode state:', error);
    }
  },

  /**
   * Gets the bundled steps
   */
  async getBundledSteps(): Promise<PersistedBundledStep[]> {
    try {
      const storage = createUserStorage();
      return (await storage.getItem<PersistedBundledStep[]>(StorageKeys.FULLSCREEN_BUNDLED_STEPS)) || [];
    } catch {
      return [];
    }
  },

  /**
   * Sets the bundled steps
   */
  async setBundledSteps(steps: PersistedBundledStep[]): Promise<void> {
    try {
      const storage = createUserStorage();
      await storage.setItem(StorageKeys.FULLSCREEN_BUNDLED_STEPS, steps);
    } catch (error) {
      console.warn('Failed to save bundled steps:', error);
    }
  },

  /**
   * Gets the bundling action type
   */
  async getBundlingAction(): Promise<string | null> {
    try {
      const storage = createUserStorage();
      return await storage.getItem<string>(StorageKeys.FULLSCREEN_BUNDLING_ACTION);
    } catch {
      return null;
    }
  },

  /**
   * Sets the bundling action type
   */
  async setBundlingAction(action: string | null): Promise<void> {
    try {
      const storage = createUserStorage();
      if (action === null) {
        await storage.removeItem(StorageKeys.FULLSCREEN_BUNDLING_ACTION);
      } else {
        await storage.setItem(StorageKeys.FULLSCREEN_BUNDLING_ACTION, action);
      }
    } catch (error) {
      console.warn('Failed to save bundling action:', error);
    }
  },

  /**
   * Gets the section info for bundling
   */
  async getSectionInfo(): Promise<PersistedSectionInfo | null> {
    try {
      const storage = createUserStorage();
      return await storage.getItem<PersistedSectionInfo>(StorageKeys.FULLSCREEN_SECTION_INFO);
    } catch {
      return null;
    }
  },

  /**
   * Sets the section info for bundling
   */
  async setSectionInfo(info: PersistedSectionInfo | null): Promise<void> {
    try {
      const storage = createUserStorage();
      if (info === null) {
        await storage.removeItem(StorageKeys.FULLSCREEN_SECTION_INFO);
      } else {
        await storage.setItem(StorageKeys.FULLSCREEN_SECTION_INFO, info);
      }
    } catch (error) {
      console.warn('Failed to save section info:', error);
    }
  },

  /**
   * Clears all full screen mode state
   */
  async clear(): Promise<void> {
    try {
      const storage = createUserStorage();
      await Promise.all([
        storage.removeItem(StorageKeys.FULLSCREEN_MODE_STATE),
        storage.removeItem(StorageKeys.FULLSCREEN_BUNDLED_STEPS),
        storage.removeItem(StorageKeys.FULLSCREEN_BUNDLING_ACTION),
        storage.removeItem(StorageKeys.FULLSCREEN_SECTION_INFO),
      ]);
    } catch (error) {
      console.warn('Failed to clear full screen mode state:', error);
    }
  },
};

// ============================================================================
// LEARNING PROGRESS STORAGE
// ============================================================================

/**
 * Learning progress storage operations
 *
 * Manages learning paths progress, earned badges, and streak tracking.
 * Designed for future migration to Grafana user storage.
 */
export const learningProgressStorage = {
  /**
   * Gets the current learning progress with Zod validation for defense-in-depth
   * against corrupted localStorage data
   */
  async get(): Promise<LearningProgress> {
    try {
      const storage = createUserStorage();
      const stored = await storage.getItem<unknown>(StorageKeys.LEARNING_PROGRESS);

      if (!stored) {
        return DEFAULT_PROGRESS;
      }

      // Validate stored data against schema to protect against corruption
      const parsed = LearningProgressSchema.safeParse(stored);
      if (parsed.success) {
        return parsed.data;
      }

      // Log validation failure for debugging but return defaults gracefully
      console.warn('Learning progress validation failed, using defaults:', parsed.error.issues);
      return DEFAULT_PROGRESS;
    } catch {
      return DEFAULT_PROGRESS;
    }
  },

  /**
   * Updates learning progress with partial data
   */
  async update(updates: Partial<LearningProgress>): Promise<void> {
    try {
      const storage = createUserStorage();
      const current = await learningProgressStorage.get();
      const updated = { ...current, ...updates };
      await storage.setItem(StorageKeys.LEARNING_PROGRESS, updated);
    } catch (error) {
      console.warn('Failed to update learning progress:', error);
    }
  },

  /**
   * Marks a guide as completed and checks for badge awards
   * Does not add duplicates
   * Dispatches events to notify listeners
   * REACT: handle errors explicitly (R10)
   */
  async markGuideCompleted(guideId: string): Promise<void> {
    try {
      // Import badge checking utilities dynamically to avoid circular deps
      const { getBadgesToAward, getBadgeById } = await import('../learning-paths/badges');
      const pathsData = await import('../learning-paths/paths.json');
      // Cast paths to correct type (JSON import has string literals, we need the union type)
      type LearningPath = import('../types/learning-paths.types').LearningPath;
      const paths = pathsData.paths as unknown as LearningPath[];

      const progress = await learningProgressStorage.get();
      if (!progress.completedGuides.includes(guideId)) {
        progress.completedGuides.push(guideId);

        // Calculate and update streak before changing lastActivityDate
        const { calculateUpdatedStreak } = await import('../learning-paths/streak-tracker');
        const today = new Date().toISOString().split('T')[0];
        progress.streakDays = calculateUpdatedStreak(progress.streakDays, progress.lastActivityDate);
        progress.lastActivityDate = today;

        // Track badges awarded in THIS call only
        const newlyAwardedBadges: string[] = [];

        // Check for ALL badges that should be awarded (including path completion)
        const badgesToAward = getBadgesToAward(progress, paths);

        for (const badgeId of badgesToAward) {
          if (!progress.earnedBadges.some((b) => b.id === badgeId)) {
            progress.earnedBadges.push({ id: badgeId, earnedAt: Date.now() });
            if (!progress.pendingCelebrations.includes(badgeId)) {
              progress.pendingCelebrations.push(badgeId);
            }
            newlyAwardedBadges.push(badgeId);

            // Track badge unlock analytics
            const badge = getBadgeById(badgeId);
            reportAppInteraction(UserInteraction.BadgeUnlocked, {
              badge_id: badgeId,
              badge_title: badge?.title || badgeId,
              trigger_type: badge?.trigger?.type || 'unknown',
            });
          }
        }

        await learningProgressStorage.update(progress);

        // Notify listeners that progress has changed
        // Only include badges awarded in THIS call, not all pending celebrations
        window.dispatchEvent(
          new CustomEvent('learning-progress-updated', {
            detail: {
              type: 'guide-completed',
              guideId,
              newBadges: newlyAwardedBadges,
              progress: { ...progress }, // Clone to prevent mutation issues
            },
          })
        );
      }
    } catch (error) {
      console.error('Failed to mark guide as completed:', error);
      // Still dispatch event so UI doesn't hang waiting for completion
      window.dispatchEvent(
        new CustomEvent('learning-progress-updated', {
          detail: {
            type: 'guide-completed',
            guideId,
            newBadges: [],
            error: true,
          },
        })
      );
    }
  },

  /**
   * Awards a badge to the user
   * Does not add duplicates, adds to pending celebrations
   */
  async awardBadge(badgeId: string): Promise<boolean> {
    try {
      const progress = await learningProgressStorage.get();
      const alreadyEarned = progress.earnedBadges.some((b) => b.id === badgeId);

      if (!alreadyEarned) {
        const record: EarnedBadgeRecord = {
          id: badgeId,
          earnedAt: Date.now(),
        };
        progress.earnedBadges.push(record);
        progress.pendingCelebrations.push(badgeId);
        await learningProgressStorage.update(progress);
        return true; // Badge was newly awarded
      }
      return false; // Badge already earned
    } catch (error) {
      console.warn('Failed to award badge:', error);
      return false;
    }
  },

  /**
   * Removes a badge from pending celebrations (after showing toast)
   */
  async dismissCelebration(badgeId: string): Promise<void> {
    try {
      const progress = await learningProgressStorage.get();
      progress.pendingCelebrations = progress.pendingCelebrations.filter((id) => id !== badgeId);
      await learningProgressStorage.update(progress);
    } catch (error) {
      console.warn('Failed to dismiss celebration:', error);
    }
  },

  /**
   * Updates streak information
   */
  async updateStreak(streakDays: number, lastActivityDate: string): Promise<void> {
    try {
      await learningProgressStorage.update({ streakDays, lastActivityDate });
    } catch (error) {
      console.warn('Failed to update streak:', error);
    }
  },

  /**
   * Checks if a badge has been earned
   */
  async hasBadge(badgeId: string): Promise<boolean> {
    try {
      const progress = await learningProgressStorage.get();
      return progress.earnedBadges.some((b) => b.id === badgeId);
    } catch {
      return false;
    }
  },

  /**
   * Checks if a guide has been completed
   */
  async hasCompletedGuide(guideId: string): Promise<boolean> {
    try {
      const progress = await learningProgressStorage.get();
      return progress.completedGuides.includes(guideId);
    } catch {
      return false;
    }
  },

  /**
   * Clears all learning progress (for testing/reset)
   */
  async clear(): Promise<void> {
    try {
      const storage = createUserStorage();
      await storage.removeItem(StorageKeys.LEARNING_PROGRESS);

      // Notify listeners that progress has been reset
      window.dispatchEvent(
        new CustomEvent('learning-progress-updated', {
          detail: { type: 'reset' },
        })
      );
    } catch (error) {
      console.warn('Failed to clear learning progress:', error);
    }
  },
};

// ============================================================================
// GUIDE RESPONSE STORAGE
// ============================================================================

/**
 * Storage interface for guide responses from input blocks.
 *
 * Responses are stored per-guide with variable names as keys.
 * Uses the same hybrid storage pattern as learning progress for cross-device sync.
 *
 * Data structure:
 * {
 *   "guide-id-1": { "datasourceName": "prometheus", "policyAccepted": true },
 *   "guide-id-2": { "region": "us-east-1" }
 * }
 */
export const guideResponseStorage = {
  /**
   * Gets all responses with Zod validation for defense-in-depth
   */
  async getAll(): Promise<GuideResponses> {
    try {
      const storage = createUserStorage();
      const stored = await storage.getItem<unknown>(StorageKeys.GUIDE_RESPONSES);

      if (!stored) {
        return DEFAULT_GUIDE_RESPONSES;
      }

      // Validate stored data against schema to protect against corruption
      const parsed = GuideResponsesSchema.safeParse(stored);
      if (parsed.success) {
        return parsed.data;
      }

      console.warn('Guide responses validation failed, using defaults:', parsed.error);
      return DEFAULT_GUIDE_RESPONSES;
    } catch (error) {
      console.warn('Failed to get guide responses:', error);
      return DEFAULT_GUIDE_RESPONSES;
    }
  },

  /**
   * Gets all responses for a specific guide
   */
  async getForGuide(guideId: string): Promise<Record<string, GuideResponseValue>> {
    const all = await guideResponseStorage.getAll();
    return all[guideId] || {};
  },

  /**
   * Gets a single response value
   */
  async getResponse(guideId: string, variableName: string): Promise<GuideResponseValue | undefined> {
    const guideResponses = await guideResponseStorage.getForGuide(guideId);
    return guideResponses[variableName];
  },

  /**
   * Checks if a response exists
   */
  async hasResponse(guideId: string, variableName: string): Promise<boolean> {
    const value = await guideResponseStorage.getResponse(guideId, variableName);
    return value !== undefined;
  },

  /**
   * Sets a response value and dispatches event for reactive updates
   */
  async setResponse(guideId: string, variableName: string, value: GuideResponseValue): Promise<void> {
    try {
      const storage = createUserStorage();
      const all = await guideResponseStorage.getAll();

      // Update the nested structure
      if (!all[guideId]) {
        all[guideId] = {};
      }
      all[guideId][variableName] = value;

      await storage.setItem(StorageKeys.GUIDE_RESPONSES, all);

      // Dispatch event to notify listeners (for requirements re-evaluation)
      window.dispatchEvent(
        new CustomEvent('guide-response-changed', {
          detail: { guideId, variableName, value },
        })
      );
    } catch (error) {
      console.warn('Failed to set guide response:', error);
    }
  },

  /**
   * Deletes a response and dispatches event
   */
  async deleteResponse(guideId: string, variableName: string): Promise<void> {
    try {
      const storage = createUserStorage();
      const all = await guideResponseStorage.getAll();

      if (all[guideId]) {
        delete all[guideId][variableName];

        // Clean up empty guide entries
        if (Object.keys(all[guideId]).length === 0) {
          delete all[guideId];
        }

        await storage.setItem(StorageKeys.GUIDE_RESPONSES, all);
      }

      // Dispatch event to notify listeners
      window.dispatchEvent(
        new CustomEvent('guide-response-changed', {
          detail: { guideId, variableName, value: undefined },
        })
      );
    } catch (error) {
      console.warn('Failed to delete guide response:', error);
    }
  },

  /**
   * Clears all responses for a specific guide
   */
  async clearForGuide(guideId: string): Promise<void> {
    try {
      const storage = createUserStorage();
      const all = await guideResponseStorage.getAll();

      delete all[guideId];
      await storage.setItem(StorageKeys.GUIDE_RESPONSES, all);

      // Dispatch event to notify listeners
      window.dispatchEvent(
        new CustomEvent('guide-response-changed', {
          detail: { guideId, variableName: '*', value: undefined },
        })
      );
    } catch (error) {
      console.warn('Failed to clear guide responses:', error);
    }
  },

  /**
   * Clears all guide responses (for testing/reset)
   */
  async clearAll(): Promise<void> {
    try {
      const storage = createUserStorage();
      await storage.removeItem(StorageKeys.GUIDE_RESPONSES);

      window.dispatchEvent(
        new CustomEvent('guide-response-changed', {
          detail: { guideId: '*', variableName: '*', value: undefined },
        })
      );
    } catch (error) {
      console.warn('Failed to clear all guide responses:', error);
    }
  },
};

// ============================================================================
// EXPERIMENT AUTO-OPEN STORAGE
// ============================================================================

/**
 * Data structure for experiment auto-open tracking
 *
 * - pagesAutoOpened: Array of page path patterns that have triggered auto-open (treatment variant)
 * - globalAutoOpened: Whether global auto-open has occurred (excluded variant)
 */
export interface ExperimentAutoOpenState {
  pagesAutoOpened: string[];
  globalAutoOpened: boolean;
}

const DEFAULT_EXPERIMENT_STATE: ExperimentAutoOpenState = {
  pagesAutoOpened: [],
  globalAutoOpened: false,
};

/** Schema for experiment auto-open state validation */
const ExperimentAutoOpenStateSchema = z.object({
  pagesAutoOpened: z.array(z.string()),
  globalAutoOpened: z.boolean(),
});

/**
 * Experiment auto-open storage operations
 *
 * Tracks whether the sidebar has been auto-opened for the experiment.
 * Persists across browsers via Grafana user storage (when available).
 *
 * This replaces sessionStorage-based tracking to ensure:
 * - State persists across browser sessions
 * - State syncs across devices (via Grafana user storage)
 * - State survives cookie/storage clears (if Grafana storage available)
 */
export const experimentAutoOpenStorage = {
  /**
   * Gets the current experiment auto-open state with Zod validation
   */
  async get(): Promise<ExperimentAutoOpenState> {
    try {
      const storage = createUserStorage();
      const stored = await storage.getItem<unknown>(StorageKeys.EXPERIMENT_AUTO_OPEN);

      if (!stored) {
        return DEFAULT_EXPERIMENT_STATE;
      }

      // Validate stored data against schema to protect against corruption
      const parsed = ExperimentAutoOpenStateSchema.safeParse(stored);
      if (parsed.success) {
        return parsed.data;
      }

      console.warn('Experiment auto-open state validation failed, using defaults:', parsed.error.issues);
      return DEFAULT_EXPERIMENT_STATE;
    } catch {
      return DEFAULT_EXPERIMENT_STATE;
    }
  },

  /**
   * Checks if a specific page pattern has been auto-opened (treatment variant)
   */
  async hasPageAutoOpened(pagePattern: string): Promise<boolean> {
    const state = await experimentAutoOpenStorage.get();
    return state.pagesAutoOpened.includes(pagePattern);
  },

  /**
   * Marks a page pattern as auto-opened (treatment variant)
   * Does not add duplicates
   */
  async markPageAutoOpened(pagePattern: string): Promise<void> {
    try {
      const storage = createUserStorage();
      const state = await experimentAutoOpenStorage.get();

      if (!state.pagesAutoOpened.includes(pagePattern)) {
        state.pagesAutoOpened.push(pagePattern);
        await storage.setItem(StorageKeys.EXPERIMENT_AUTO_OPEN, state);
      }
    } catch (error) {
      console.warn('Failed to mark page as auto-opened:', error);
    }
  },

  /**
   * Checks if global auto-open has occurred (excluded variant)
   */
  async hasGlobalAutoOpened(): Promise<boolean> {
    const state = await experimentAutoOpenStorage.get();
    return state.globalAutoOpened;
  },

  /**
   * Marks global auto-open as occurred (excluded variant)
   */
  async markGlobalAutoOpened(): Promise<void> {
    try {
      const storage = createUserStorage();
      const state = await experimentAutoOpenStorage.get();
      state.globalAutoOpened = true;
      await storage.setItem(StorageKeys.EXPERIMENT_AUTO_OPEN, state);
    } catch (error) {
      console.warn('Failed to mark global auto-open:', error);
    }
  },

  /**
   * Resets auto-open state (called when resetCache flag is toggled in GOFF)
   */
  async reset(): Promise<void> {
    try {
      const storage = createUserStorage();
      await storage.setItem(StorageKeys.EXPERIMENT_AUTO_OPEN, DEFAULT_EXPERIMENT_STATE);
    } catch (error) {
      console.warn('Failed to reset experiment auto-open state:', error);
    }
  },

  /**
   * Clears all experiment auto-open state
   */
  async clear(): Promise<void> {
    try {
      const storage = createUserStorage();
      await storage.removeItem(StorageKeys.EXPERIMENT_AUTO_OPEN);
    } catch (error) {
      console.warn('Failed to clear experiment auto-open state:', error);
    }
  },
};
