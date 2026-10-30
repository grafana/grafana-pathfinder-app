import { isSafeResponseName, MAX_INPUT_LENGTH } from './input-value';
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

import { AppEvents } from '@grafana/data';
import { getAppEvents, usePluginUserStorage } from '@grafana/runtime';
import { useCallback, useRef, useEffect } from 'react';
import { z } from 'zod';

import type { LearningProgress, EarnedBadgeRecord } from '../types/learning-paths.types';
import { StorageEvents } from './event-names';
import { getLearningJourneyBaseUrl } from './learning-journey-url';
import { logger } from './logging';
import { createBoundedRecordStorage } from './storage/bounded-record-storage';
import { collectKeysByPrefix, isKeyUnderPrefix } from './storage/key-utils';
import { listProgressEntries, progressSectionKey, sweepDiscardedProgressRecords } from './storage/progress-keys';
import {
  HYBRID_TIMESTAMP_SUFFIX,
  PROGRESS_SECTION_PREFIXES,
  StorageKeys,
  buildVersionedContentStorageKey,
  parseVersionedStorageKey,
} from './storage-keys';

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

/**
 * Gets the timestamp key for a given storage key (old format, used during migration)
 */
function getTimestampKey(key: string): string {
  return `${key}${HYBRID_TIMESTAMP_SUFFIX}`;
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
  // Higher than the journey cap because this record is keyed per guide *and*
  // per milestone, so one multi-milestone path consumes a slot per milestone.
  MAX_INTERACTIVE_COMPLETIONS: 250, // Prevent quota exhaustion
  MAX_PERSISTED_TABS: 50, // Prevent quota exhaustion
} as const;

// ============================================================================
// QUOTA WARNING (N-3 follow-up from PR #909)
// ============================================================================

/**
 * Module-level guard so the user only sees one quota-exceeded toast per
 * page lifecycle. The previous behavior swallowed every QuotaExceededError
 * into a `console.warn`, so the user never learned that their progress
 * had silently stopped persisting. See PR #909.
 */
let hasWarnedAboutQuota = false;

/**
 * Publish a single user-visible warning toast the first time any storage
 * write hits a `QuotaExceededError`. Subsequent calls are no-ops to avoid
 * spamming the user as repeated writes pile up against the same full quota.
 *
 * Wrapped in try/catch because `getAppEvents()` can throw in environments
 * where `@grafana/runtime` isn't fully initialized (notably some tests).
 */
export function warnQuotaExceededOnce(): void {
  if (hasWarnedAboutQuota) {
    return;
  }
  try {
    getAppEvents().publish({
      type: AppEvents.alertWarning.name,
      payload: [
        'Browser storage full',
        'Your progress may not be saved. Try resetting old guide progress via My Learning to free up space.',
      ],
    });
    // Only flip the flag after a successful publish so a runtime that
    // isn't initialized yet doesn't permanently suppress the toast.
    hasWarnedAboutQuota = true;
  } catch {
    // getAppEvents() can throw in test envs without a grafana/runtime
    // mock. Leave the flag false so a later write can retry.
  }
}

/**
 * Test-only reset of the module-level `hasWarnedAboutQuota` flag so
 * suites can exercise the once-per-lifecycle contract deterministically.
 */
export function __resetQuotaWarningForTests(): void {
  hasWarnedAboutQuota = false;
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

import type { UserStorage, GrafanaUserStorage } from '../types/storage.types';

// Re-export for backward compatibility with existing imports
export type { UserStorage, GrafanaUserStorage };

// ============================================================================
// STORAGE IMPLEMENTATION
// ============================================================================

/**
 * Global storage instance that can be initialized from React components
 * This allows non-React code to use Grafana's user storage when available
 */
let globalStorageInstance: UserStorage | null = null;

/**
 * Sets the global storage instance (called from React components with access to Grafana storage)
 */
export function setGlobalStorage(storage: UserStorage): void {
  globalStorageInstance = storage;
}

/**
 * Gets the global storage instance, falling back to localStorage if not initialized
 *
 * This is used by all standalone (non-React) storage helpers.
 * For React components, use the useUserStorage hook which can leverage Grafana's user storage.
 *
 * @returns UserStorage - Storage interface with async operations
 */
export function createUserStorage(): UserStorage {
  return globalStorageInstance || createLocalStorage();
}

/**
 * Creates a storage implementation using browser localStorage
 *
 * This is the fallback for when Grafana user storage is unavailable.
 *
 * Exported for characterization tests of the storage plumbing; production
 * callers should use `createUserStorage()` or `useUserStorage()`.
 */
export function createLocalStorage(): UserStorage {
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
        logger.warn(`Failed to get item from localStorage: ${key}`, { error });
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
          logger.warn('localStorage quota exceeded', { error });
          warnQuotaExceededOnce();
          throw error;
        }
        logger.error(`Failed to set item in localStorage: ${key}`, { error });
        throw error;
      }
    },

    async removeItem(key: string): Promise<void> {
      try {
        localStorage.removeItem(key);
      } catch (error) {
        logger.warn(`Failed to remove item from localStorage: ${key}`, { error });
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
        logger.warn('Failed to clear localStorage', { error });
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
 *
 * Exported for characterization tests of the debounced write queue; production
 * callers reach this through `useUserStorage()`.
 */
export function createHybridStorage(grafanaStorage: GrafanaUserStorage): UserStorage {
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
        logger.warn(`Failed to sync to Grafana storage: ${key}`, { error });
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
        logger.warn('Error processing Grafana storage queue', { error });
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
        logger.warn('Error processing Grafana storage queue', { error });
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
        logger.warn(`Failed to write to localStorage: ${key}, trying Grafana storage`, { error });
        try {
          const serialized = JSON.stringify(value);
          const timestamp = Date.now();
          await grafanaStorage.setItem(key, wrapEnvelope(serialized, timestamp));
        } catch (grafanaError) {
          logger.error(`Failed to write to both storages: ${key}`, { grafanaError });
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
      logger.warn('Clear operation not fully supported for Grafana user storage');
    },
  };
}

/**
 * Module-level guard so the one-off discard of progress records left in the
 * superseded key shape runs once per page lifecycle rather than on every
 * `useUserStorage()` mount.
 */
let hasSweptDiscardedProgress = false;

/**
 * Discards progress records in the superseded key shape, once per page load.
 *
 * Housekeeping, not a migration: nothing reads that shape, so when this runs
 * relative to anything else does not matter.
 */
function sweepDiscardedProgressOnce(): void {
  if (hasSweptDiscardedProgress) {
    return;
  }
  hasSweptDiscardedProgress = true;
  const removed = sweepDiscardedProgressRecords();
  if (removed > 0) {
    logger.info('Discarded progress records left in the superseded key shape', { removed });
  }
}

/**
 * Module-level guard: ensures syncFromGrafanaStorage runs at most once per page lifecycle.
 * Multiple `useUserStorage()` mounts (React Strict Mode, component remounts) would
 * otherwise trigger 3-6 syncs per page load, each generating 10-20 API calls.
 */
let hasSynced = false;

/**
 * Test-only reset of the module-level once-per-lifecycle flags (Grafana sync
 * and the discard sweep) so suites can exercise those contracts
 * deterministically.
 */
export function __resetSyncedForTests(): void {
  hasSynced = false;
  hasSweptDiscardedProgress = false;
}

/**
 * Reads a key from Grafana storage and returns its value and timestamp,
 * handling both the new envelope format and the old separate-timestamp format.
 *
 * During migration: if the old format is detected (separate `__timestamp` key),
 * the data is re-written in envelope format and the orphaned timestamp key is deleted
 * from both Grafana storage and localStorage.
 */
async function readGrafanaKeyWithMigration(
  grafanaStorage: GrafanaUserStorage,
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
      logger.warn(`Failed to migrate key to envelope format: ${key}`, { error });
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
 *
 * Exported for characterization tests of the once-per-lifecycle sync and
 * timestamp conflict resolution; production code calls this from `useUserStorage()`.
 */
export async function syncFromGrafanaStorage(grafanaStorage: GrafanaUserStorage): Promise<void> {
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
        logger.warn(`Failed to sync key from Grafana storage: ${key}`, { error });
      }
    }

    // NOTE: We do NOT clean up localStorage __timestamp keys here.
    // They're still used by the hybrid storage for conflict resolution on future page loads.
    // The Grafana storage side has been migrated to envelope format, but localStorage
    // continues using the separate timestamp key pattern.
  } catch (error) {
    logger.warn('Failed to sync from Grafana storage', { error });
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

    sweepDiscardedProgressOnce();

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
          logger.warn('Failed initial sync from Grafana storage', { error });
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
 * Journey completion storage operations.
 *
 * Manages learning journey progress with built-in cleanup to prevent storage
 * quota exhaustion. Backed by `createBoundedRecordStorage`.
 */
export const journeyCompletionStorage = createBoundedRecordStorage({
  storageKey: StorageKeys.JOURNEY_COMPLETION,
  limit: LIMITS.MAX_JOURNEY_COMPLETIONS,
  label: 'journey completion',
  createStorage: createUserStorage,
  onQuotaExceeded: warnQuotaExceededOnce,
});

function getStoredMilestoneSlugs(
  data: Record<string, string[]>,
  journeyBaseUrl: string,
  milestoneUrls: string[] = []
): Set<string> {
  const canonicalKey = getLearningJourneyBaseUrl(journeyBaseUrl);
  const exactKeys = new Set([journeyBaseUrl, ...milestoneUrls].map((key) => key.replace(/\/+$/, '')));
  const slugs = Object.entries(data).flatMap(([storedKey, storedSlugs]) =>
    getLearningJourneyBaseUrl(storedKey) === canonicalKey || exactKeys.has(storedKey.replace(/\/+$/, ''))
      ? storedSlugs
      : []
  );
  return new Set(slugs);
}

// Serializes milestone mutations so each sees the previous write, not a stale record.
let milestoneMutationQueue: Promise<unknown> = Promise.resolve();
function serializeMilestoneMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = milestoneMutationQueue.then(operation);
  milestoneMutationQueue = result.catch(() => undefined);
  return result;
}

/**
 * Milestone completion storage operations
 *
 * Tracks which milestones within a learning journey have been completed.
 * Stored as a map of journeyBaseUrl -> array of completed milestone slugs.
 */
export const milestoneCompletionStorage = {
  /**
   * Removes a single milestone from the legacy record, for the per-milestone
   * toolbar reset. Without this, resetting one milestone left this legacy
   * record untouched, and `backfillLegacyMilestoneCompletion`
   * (learning-journey-helpers.ts) — which exists precisely to carry a
   * pre-migration completion into `interactiveCompletionStorage` — read this
   * still-populated record on the very next render and silently rewrote the
   * just-reset milestone back to 100%. Whole-*path* reset
   * (`learning-paths.hook.ts`) already clears this store entirely for that
   * reason; this only removes the one slug being reset, leaving the rest of
   * the journey's legacy record intact.
   *
   * `milestoneUrls` mirrors `getCompletedSync`'s own alias
   * matching (`getStoredMilestoneSlugs`'s `exactKeys`): a legacy record can
   * be stored under a milestone's own URL, not only under a key that
   * canonicalizes to the journey base.
   */
  async removeCompleted(journeyBaseUrl: string, milestoneSlug: string, milestoneUrls: string[] = []): Promise<void> {
    return serializeMilestoneMutation(async () => {
      try {
        const storage = createUserStorage();
        const data = (await storage.getItem<Record<string, string[]>>(StorageKeys.MILESTONE_COMPLETION)) || {};
        const canonicalKey = getLearningJourneyBaseUrl(journeyBaseUrl);
        const exactKeys = new Set([journeyBaseUrl, ...milestoneUrls].map((key) => key.replace(/\/+$/, '')));
        let mutated = false;
        for (const storedKey of Object.keys(data)) {
          const storedSlugs = data[storedKey];
          if (
            storedSlugs &&
            (getLearningJourneyBaseUrl(storedKey) === canonicalKey || exactKeys.has(storedKey.replace(/\/+$/, ''))) &&
            storedSlugs.includes(milestoneSlug)
          ) {
            data[storedKey] = storedSlugs.filter((slug) => slug !== milestoneSlug);
            mutated = true;
          }
        }
        if (mutated) {
          await storage.setItem(StorageKeys.MILESTONE_COMPLETION, data);
        }
      } catch (error) {
        logger.warn('Failed to remove milestone completion', { error });
      }
    });
  },

  /**
   * Synchronous read, for the journey progress rollup (`getJourneyProgress`
   * is called synchronously from several render paths). Mirrors
   * `guideCompletionMarkStorage.isMarked`: the hybrid storage writes through
   * to localStorage before it queues the Grafana write, so the value is
   * already there.
   */
  getCompletedSync(journeyBaseUrl: string, milestoneUrls: string[] = []): Set<string> {
    try {
      const raw = localStorage.getItem(StorageKeys.MILESTONE_COMPLETION);
      const data = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
      return getStoredMilestoneSlugs(data, journeyBaseUrl, milestoneUrls);
    } catch {
      return new Set();
    }
  },

  async clear(journeyBaseUrl: string): Promise<void> {
    return serializeMilestoneMutation(async () => {
      try {
        const storage = createUserStorage();
        const data = (await storage.getItem<Record<string, string[]>>(StorageKeys.MILESTONE_COMPLETION)) || {};
        const canonicalKey = getLearningJourneyBaseUrl(journeyBaseUrl);
        for (const storedKey of Object.keys(data)) {
          if (getLearningJourneyBaseUrl(storedKey) === canonicalKey) {
            delete data[storedKey];
          }
        }
        await storage.setItem(StorageKeys.MILESTONE_COMPLETION, data);
      } catch (error) {
        logger.warn('Failed to clear milestone completion', { error });
      }
    });
  },

  async clearAll(): Promise<void> {
    return serializeMilestoneMutation(async () => {
      try {
        const storage = createUserStorage();
        await storage.removeItem(StorageKeys.MILESTONE_COMPLETION);
      } catch (error) {
        logger.warn('Failed to clear all milestone completion', { error });
      }
    });
  },
};

/**
 * Interactive guide completion storage operations.
 *
 * Stores completion percentage for interactive guides (bundled and external).
 * Same shape as `journeyCompletionStorage`, scoped to a different storage key.
 */
export const interactiveCompletionStorage = createBoundedRecordStorage({
  storageKey: StorageKeys.INTERACTIVE_COMPLETION,
  limit: LIMITS.MAX_INTERACTIVE_COMPLETIONS,
  label: 'interactive completion',
  createStorage: createUserStorage,
  onQuotaExceeded: warnQuotaExceededOnce,
});

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
        logger.warn('Storage quota exceeded, reducing number of tabs');
        warnQuotaExceededOnce();
        // Save only the most recent 25 tabs
        const reducedTabs = tabs.slice(-25);
        const storage = createUserStorage();
        await storage.setItem(StorageKeys.TABS, reducedTabs);
      } else {
        logger.warn('Failed to save tabs', { error });
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
      logger.warn('Failed to save active tab', { error });
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
      logger.warn('Failed to clear tab data', { error });
    }
  },
};

function parseStepIds(raw: string): unknown[] | null {
  try {
    const ids = JSON.parse(raw);
    return Array.isArray(ids) ? ids : null;
  } catch {
    return null;
  }
}

function readStepIds(prefix: string, contentKey: string, sectionId: string): Set<string> {
  try {
    const raw = localStorage.getItem(progressSectionKey(prefix, contentKey, sectionId));
    return new Set((raw ? (parseStepIds(raw) ?? []) : []).filter((id): id is string => typeof id === 'string'));
  } catch {
    return new Set();
  }
}

function readSkippedSteps(contentKey: string, sectionId: string): Set<string> {
  return readStepIds(StorageKeys.INTERACTIVE_SKIPPED_STEPS_PREFIX, contentKey, sectionId);
}

function writeSkippedSteps(contentKey: string, sectionId: string, skippedIds: ReadonlySet<string>): void {
  try {
    const key = progressSectionKey(StorageKeys.INTERACTIVE_SKIPPED_STEPS_PREFIX, contentKey, sectionId);
    if (skippedIds.size === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify([...skippedIds]));
    }
  } catch (error) {
    logger.warn('Failed to persist skipped step attribution', { error });
  }
}

/**
 * Cache for the completed-step id scan, so neither `countAllCompleted` nor
 * `listAllCompleted` costs an O(n) localStorage sweep per call. The count is
 * the list's length, so one cache serves both and they cannot disagree.
 *
 * Load-bearing for the render path, not just for write throughput: the
 * completion percentage's evidence bridge reads the list, and that read sits
 * on the Mark complete footer's `useSyncExternalStore` snapshot, which React
 * calls on every render.
 *
 * Invalidated by setCompleted, clear, clearAllForContent, clearAll, and the
 * cross-tab listener's `invalidateCountCache`.
 */
const completedIdsCache = new Map<string, readonly string[]>();

/** The same cache for acknowledged sections — the evidence bridge's other sweep. */
const acknowledgedIdsCache = new Map<string, readonly string[]>();

function invalidateProgressScanCaches(contentKey: string): void {
  completedIdsCache.delete(contentKey);
  acknowledgedIdsCache.delete(contentKey);
}

/**
 * Interactive step completion storage operations
 */
export const interactiveStepStorage = {
  getSkipped: readSkippedSteps,

  listAllSkipped(contentKey: string): readonly string[] {
    const skipped: string[] = [];
    for (const { sectionId, raw } of listProgressEntries(StorageKeys.INTERACTIVE_STEPS_PREFIX, contentKey)) {
      const completed = new Set(parseStepIds(raw) ?? []);
      for (const id of readSkippedSteps(contentKey, sectionId)) {
        if (completed.has(id)) {
          skipped.push(id);
        }
      }
    }
    return skipped;
  },

  /**
   * Drop the cached completion count for a content key without touching
   * localStorage. Used by the cross-tab `storage` listener in
   * `completion-store.ts` so the next `countAllCompleted` call re-scans
   * from authoritative storage rather than returning a stale per-tab
   * snapshot.
   *
   * Idempotent on unknown keys; safe to call from any tab.
   */
  invalidateCountCache(contentKey: string): void {
    invalidateProgressScanCaches(contentKey);
  },

  /**
   * Gets completed step IDs for a specific content/section
   */
  async getCompleted(contentKey: string, sectionId: string): Promise<Set<string>> {
    try {
      const storage = createUserStorage();
      const key = progressSectionKey(StorageKeys.INTERACTIVE_STEPS_PREFIX, contentKey, sectionId);
      const ids = await storage.getItem<string[]>(key);
      return new Set(ids || []);
    } catch {
      return new Set();
    }
  },

  async setCompleted(
    contentKey: string,
    sectionId: string,
    completedIds: Set<string>,
    skippedIds: ReadonlySet<string> = new Set(),
    clearedDuringLoad?: ReadonlySet<string>
  ): Promise<void> {
    // A save while the section loads must not drop stored steps the load is about to restore.
    const keepsStored = (id: string) => clearedDuringLoad !== undefined && !clearedDuringLoad.has(id);
    const unloaded = clearedDuringLoad
      ? [...readStepIds(StorageKeys.INTERACTIVE_STEPS_PREFIX, contentKey, sectionId)].filter(keepsStored)
      : [];
    const completed = new Set([...completedIds, ...unloaded]);
    if (completed.size === 0) {
      return interactiveStepStorage.clear(contentKey, sectionId);
    }
    const skipped = new Set(
      [...readSkippedSteps(contentKey, sectionId), ...skippedIds].filter(
        (id) => completedIds.has(id) || (keepsStored(id) && completed.has(id))
      )
    );
    // Skip annotations must be visible before a completion notification can record its source.
    writeSkippedSteps(contentKey, sectionId, skipped);
    try {
      completedIdsCache.delete(contentKey);
      const storage = createUserStorage();
      const key = progressSectionKey(StorageKeys.INTERACTIVE_STEPS_PREFIX, contentKey, sectionId);
      await storage.setItem(key, Array.from(completed));
    } catch (error) {
      logger.warn('Failed to save completed steps', { error });
    }
  },

  async clear(contentKey: string, sectionId: string): Promise<void> {
    writeSkippedSteps(contentKey, sectionId, new Set());
    try {
      completedIdsCache.delete(contentKey);
      const storage = createUserStorage();
      await storage.removeItem(progressSectionKey(StorageKeys.INTERACTIVE_STEPS_PREFIX, contentKey, sectionId));
    } catch (error) {
      logger.warn('Failed to clear completed steps', { error });
    }
  },

  /**
   * Check if any progress exists for a content key (any section)
   */
  async hasProgress(contentKey: string): Promise<boolean> {
    try {
      return listProgressEntries(StorageKeys.INTERACTIVE_STEPS_PREFIX, contentKey).some(
        ({ raw }) => (parseStepIds(raw)?.length ?? 0) > 0
      );
    } catch {
      return false;
    }
  },

  /**
   * Clears every section record for one content key, across all progress
   * namespaces. Rejects rather than resolving if any record survives.
   */
  async clearAllForContent(contentKey: string): Promise<void> {
    invalidateProgressScanCaches(contentKey);
    const storage = createUserStorage();

    const keysFor = (): string[] =>
      PROGRESS_SECTION_PREFIXES.flatMap((prefix) =>
        listProgressEntries(prefix, contentKey).map(({ sectionId }) =>
          progressSectionKey(prefix, contentKey, sectionId)
        )
      );

    try {
      await Promise.all(keysFor().map((key) => storage.removeItem(key)));
    } catch (error) {
      logger.warn('Failed to clear progress for content', { error });
    }

    // A reset must not look like it worked when it did not. The removal path
    // swallows its own failures — `createLocalStorage.removeItem` logs and
    // returns — so a removal that did not take is invisible here. Re-reading is
    // what lets the reader be told the guide is clear only once it is, and it
    // holds however a record came to survive: the check is on what is left, not
    // on why.
    const remaining = keysFor();
    if (remaining.length > 0) {
      throw new Error(`Progress reset left ${remaining.length} record(s) in place`);
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
   * Also fully invalidates the in-memory progress-scan caches.
   */
  async clearAll(): Promise<void> {
    try {
      completedIdsCache.clear();
      acknowledgedIdsCache.clear();
      const skippedPrefix = StorageKeys.INTERACTIVE_SKIPPED_STEPS_PREFIX;
      const stepsPrefix = StorageKeys.INTERACTIVE_STEPS_PREFIX;
      const collapsePrefix = StorageKeys.SECTION_COLLAPSE_PREFIX;
      const ackPrefix = StorageKeys.SECTION_ACKNOWLEDGED_PREFIX;
      const donePrefix = StorageKeys.SECTION_DONE_PREFIX;

      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (
          key &&
          (key.startsWith(skippedPrefix) ||
            key.startsWith(stepsPrefix) ||
            key.startsWith(collapsePrefix) ||
            key.startsWith(ackPrefix) ||
            key.startsWith(donePrefix))
        ) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key));
    } catch (error) {
      logger.warn('Failed to clear all interactive step data', { error });
    }
  },

  countAllCompleted(contentKey: string): number {
    return interactiveStepStorage.listAllCompleted(contentKey).length;
  },

  /**
   * Synchronously list every completed step id across every section for a
   * content key — the numerator `completion-store.ts`'s evidence bridge
   * feeds into `guideProgress`, and the source of `countAllCompleted`'s
   * count, so the two can never disagree.
   *
   * The #842 all-passive ack-marker is filtered out so it doesn't inflate the
   * document completion numerator: the marker is persisted to satisfy the
   * reducer's "ack requires completion" invariant but is not a real step and
   * is not counted in getTotalDocumentSteps().
   */
  listAllCompleted(contentKey: string): readonly string[] {
    const cached = completedIdsCache.get(contentKey);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const ids: string[] = [];
      for (const { raw } of listProgressEntries(StorageKeys.INTERACTIVE_STEPS_PREFIX, contentKey)) {
        const stepIds = parseStepIds(raw);
        if (stepIds) {
          for (const id of stepIds) {
            if (typeof id === 'string' && !id.endsWith('::ack-marker')) {
              ids.push(id);
            }
          }
        }
      }
      completedIdsCache.set(contentKey, ids);
      return ids;
    } catch {
      return [];
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
      const key = progressSectionKey(StorageKeys.SECTION_COLLAPSE_PREFIX, contentKey, sectionId);
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
      const key = progressSectionKey(StorageKeys.SECTION_COLLAPSE_PREFIX, contentKey, sectionId);
      await storage.setItem(key, isCollapsed);
    } catch (error) {
      logger.warn('Failed to save section collapse state', { error });
    }
  },

  /**
   * Clears collapse state for a specific section
   */
  async clear(contentKey: string, sectionId: string): Promise<void> {
    try {
      const storage = createUserStorage();
      await storage.removeItem(progressSectionKey(StorageKeys.SECTION_COLLAPSE_PREFIX, contentKey, sectionId));
    } catch (error) {
      logger.warn('Failed to clear section collapse state', { error });
    }
  },
};

/**
 * Section acknowledgement state storage operations (issue #842 gate).
 *
 * Persists whether the user has clicked "Mark section as complete" for a
 * section that requires explicit acknowledgement (trailing passive content
 * after the last interactive step, or an all-passive section).
 *
 * Unlike `sectionCollapseStorage`, `.get()` returns `boolean | null`
 * rather than defaulting absence to `false`. The distinction matters
 * for the upgrade migration path: a section with all interactive steps
 * completed under the pre-#842 rules has `ack === null`, which the
 * migration auto-converts to `true` so existing finished work does not
 * spontaneously become incomplete after upgrade.
 */
export const sectionAcknowledgementStorage = {
  /**
   * Gets the acknowledgement state for a specific section.
   *
   * Returns:
   *   - `true` if the user has explicitly acknowledged the section
   *   - `null` if the section has never been acknowledged (no entry
   *            in storage). The reducer's reset paths call `clear()`
   *            rather than writing a `false` sentinel, so the storage
   *            layer is intentionally two-state.
   */
  async get(contentKey: string, sectionId: string): Promise<true | null> {
    try {
      const storage = createUserStorage();
      const key = progressSectionKey(StorageKeys.SECTION_ACKNOWLEDGED_PREFIX, contentKey, sectionId);
      const acknowledged = await storage.getItem<boolean>(key);
      return acknowledged === true ? true : null;
    } catch {
      return null;
    }
  },

  /**
   * Sets the acknowledgement state for a specific section.
   *
   * Only `true` is accepted — the storage layer is intentionally
   * two-state (see `.get()`). Use `.clear()` to remove an entry.
   */
  async set(contentKey: string, sectionId: string, isAcknowledged: true): Promise<void> {
    try {
      acknowledgedIdsCache.delete(contentKey);
      const storage = createUserStorage();
      const key = progressSectionKey(StorageKeys.SECTION_ACKNOWLEDGED_PREFIX, contentKey, sectionId);
      await storage.setItem(key, isAcknowledged);
    } catch (error) {
      logger.warn('Failed to save section acknowledgement state', { error });
    }
  },

  /**
   * Clears the acknowledgement state for a specific section.
   *
   * Called by the section reducer's RESET_SECTION and STEP_RESET paths so
   * that a redo or full reset re-arms the gate.
   */
  async clear(contentKey: string, sectionId: string): Promise<void> {
    try {
      acknowledgedIdsCache.delete(contentKey);
      const storage = createUserStorage();
      await storage.removeItem(progressSectionKey(StorageKeys.SECTION_ACKNOWLEDGED_PREFIX, contentKey, sectionId));
    } catch (error) {
      logger.warn('Failed to clear section acknowledgement state', { error });
    }
  },

  /**
   * Synchronously count acknowledged sections under `contentKey`.
   * Mirrors `interactiveStepStorage.countAllCompleted`; required so
   * the completion store can derive an all-passive guide percentage
   * without an async read.
   */
  countAllAcknowledged(contentKey: string): number {
    return sectionAcknowledgementStorage.listAllAcknowledged(contentKey).length;
  },

  /**
   * Synchronously list every acknowledged section id for a content key — the
   * `mark-section-complete` evidence `completion-store.ts`'s evidence bridge
   * feeds into `guideProgress`, and the source of `countAllAcknowledged`'s
   * count. Cached per content key like the step scan, because the same
   * evidence bridge is read from a render-path snapshot.
   */
  listAllAcknowledged(contentKey: string): readonly string[] {
    const cached = acknowledgedIdsCache.get(contentKey);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const sectionIds: string[] = [];
      for (const { sectionId, raw } of listProgressEntries(StorageKeys.SECTION_ACKNOWLEDGED_PREFIX, contentKey)) {
        if (raw === 'true') {
          sectionIds.push(sectionId);
        }
      }
      acknowledgedIdsCache.set(contentKey, sectionIds);
      return sectionIds;
    } catch {
      return [];
    }
  },

  /**
   * Drop the cached acknowledgement scan for a content key without touching
   * localStorage — the cross-tab counterpart to
   * `interactiveStepStorage.invalidateCountCache`.
   */
  invalidateAcknowledgementCache(contentKey: string): void {
    acknowledgedIdsCache.delete(contentKey);
  },
};

/**
 * Section "done" bit storage.
 *
 * Persists whether a section has reached `isCompleted === true`, derived
 * from the section's gate analysis, objectives, completion set, and ack
 * state. Read by the `section-completed:` requirement check so it
 * works without the section being currently mounted (e.g. when the
 * dependent step is on a later milestone, in a virtualized scroll
 * region, or in a conditional branch not yet rendered).
 *
 * Storage is intentionally two-state — `true` or absent (`null`). On
 * reset paths the section calls `.clear()` rather than writing `false`.
 */
export const sectionDoneStorage = {
  /**
   * Returns `true` when the section is recorded complete; otherwise
   * `null`. Two-state shape mirrors `sectionAcknowledgementStorage`.
   */
  async get(contentKey: string, sectionId: string): Promise<true | null> {
    try {
      const storage = createUserStorage();
      const key = progressSectionKey(StorageKeys.SECTION_DONE_PREFIX, contentKey, sectionId);
      const done = await storage.getItem<boolean>(key);
      return done === true ? true : null;
    } catch {
      return null;
    }
  },

  async set(contentKey: string, sectionId: string, isDone: true): Promise<void> {
    try {
      const storage = createUserStorage();
      const key = progressSectionKey(StorageKeys.SECTION_DONE_PREFIX, contentKey, sectionId);
      await storage.setItem(key, isDone);
    } catch (error) {
      logger.warn('Failed to save section done state', { error });
    }
  },

  async clear(contentKey: string, sectionId: string): Promise<void> {
    try {
      const storage = createUserStorage();
      await storage.removeItem(progressSectionKey(StorageKeys.SECTION_DONE_PREFIX, contentKey, sectionId));
    } catch (error) {
      logger.warn('Failed to clear section done state', { error });
    }
  },
};

/**
 * Guide-level completion mark storage.
 *
 * Persists the `mark-guide-complete` evidence produced by the "Mark
 * complete" control at the foot of every guide and milestone. Keyed by
 * content key alone: the mark evidences the whole guide, so unlike
 * `sectionAcknowledgementStorage` there is no section to qualify it with.
 *
 * Ordinary guides store `true`. Choice guides store the marked block keys
 * in the same entry. All reset paths therefore remove both the mark and its
 * path evidence, without removing the reader's saved input selections. A
 * mark earned by seeing the end of a guide with no completable block also
 * carries `method: 'viewed'`, so its source is not reported as a click.
 */
function guideCompletionMarkKey(contentKey: string): string {
  return buildVersionedContentStorageKey(StorageKeys.GUIDE_COMPLETION_MARK_PREFIX, contentKey);
}

type StoredGuideCompletionMark = true | { choiceCompletionKeys?: string[]; method?: 'viewed' };

function isGuideCompletionMark(value: unknown): value is StoredGuideCompletionMark {
  if (value === true) {
    return true;
  }
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const mark = value as { choiceCompletionKeys?: unknown; method?: unknown };
  return Array.isArray(mark.choiceCompletionKeys) || mark.method === 'viewed';
}

function readGuideCompletionMark(contentKey: string): unknown {
  return JSON.parse(localStorage.getItem(guideCompletionMarkKey(contentKey)) ?? 'null');
}

export const guideCompletionMarkStorage = {
  /** `true` when the guide carries the mark; otherwise `null`. */
  async get(contentKey: string): Promise<true | null> {
    try {
      const storage = createUserStorage();
      const marked = await storage.getItem<unknown>(guideCompletionMarkKey(contentKey));
      return isGuideCompletionMark(marked) ? true : null;
    } catch {
      return null;
    }
  },

  /**
   * Synchronous read, for the completion store's percentage derivation which
   * runs during render. Mirrors
   * `sectionAcknowledgementStorage.countAllAcknowledged`: the hybrid storage
   * writes through to localStorage before it queues the Grafana write, so the
   * value is already there.
   */
  isMarked(contentKey: string): boolean {
    try {
      return isGuideCompletionMark(readGuideCompletionMark(contentKey));
    } catch {
      return false;
    }
  },

  /** Synchronous: the mark was earned by seeing the guide's end, not by a click. */
  isViewed(contentKey: string): boolean {
    try {
      const marked = readGuideCompletionMark(contentKey);
      return isGuideCompletionMark(marked) && marked !== true && marked.method === 'viewed';
    } catch {
      return false;
    }
  },

  /** Read only content-keyed completion evidence, never saved input responses. */
  getChoiceCompletionKeys(contentKey: string): string[] {
    try {
      const marked = readGuideCompletionMark(contentKey);
      return isGuideCompletionMark(marked) && marked !== true && Array.isArray(marked.choiceCompletionKeys)
        ? marked.choiceCompletionKeys.filter((key: unknown): key is string => typeof key === 'string')
        : [];
    } catch {
      return [];
    }
  },

  /** Only `true` is accepted; use `.clear()` to remove an entry. */
  async set(contentKey: string, isMarked: true, choiceCompletionKeys?: string[]): Promise<void> {
    try {
      const storage = createUserStorage();
      await storage.setItem(
        guideCompletionMarkKey(contentKey),
        choiceCompletionKeys === undefined ? isMarked : { choiceCompletionKeys }
      );
    } catch (error) {
      logger.warn('Failed to save guide completion mark', { error });
    }
  },

  async setViewed(contentKey: string, choiceCompletionKeys?: string[]): Promise<void> {
    try {
      const storage = createUserStorage();
      await storage.setItem(guideCompletionMarkKey(contentKey), {
        method: 'viewed',
        ...(choiceCompletionKeys !== undefined && { choiceCompletionKeys }),
      });
    } catch (error) {
      logger.warn('Failed to save guide completion mark', { error });
    }
  },

  async clear(contentKey: string): Promise<void> {
    try {
      const storage = createUserStorage();
      await storage.removeItem(guideCompletionMarkKey(contentKey));
    } catch (error) {
      logger.warn('Failed to clear guide completion mark', { error });
    }
  },

  async clearMany(contentKeys: string[]): Promise<void> {
    await Promise.all(contentKeys.map((contentKey) => guideCompletionMarkStorage.clear(contentKey)));
  },

  /**
   * Clear every mark whose content key is under `contentKeyPrefix` — the key
   * itself or a child below a `/`, `?`, or `#` boundary (see
   * `isKeyUnderPrefix`) — never a sibling that merely shares the text prefix,
   * which is what stops a reset of one path wiping another (#1928). When
   * `contentKeyPrefix` is omitted, all marks are cleared. Marks are keyed by
   * content key alone and milestone keys are recorded nowhere, so the bulk
   * reset paths recover them by prefix exactly as the path reset recovers step
   * keys.
   *
   * Precondition: the prefix must have no trailing slash, so the boundary test
   * applies rather than a plain `startsWith`. The sole caller
   * (`learning-paths.hook.ts`) satisfies this by stripping trailing slashes
   * from the path URL before calling.
   */
  async clearAllWithPrefix(contentKeyPrefix = ''): Promise<void> {
    try {
      const contentKeys: string[] = [];
      for (const key of collectKeysByPrefix(localStorage, StorageKeys.GUIDE_COMPLETION_MARK_PREFIX)) {
        const parsed = parseVersionedStorageKey(StorageKeys.GUIDE_COMPLETION_MARK_PREFIX, key);
        if (parsed && parsed.sectionId === '' && isKeyUnderPrefix(parsed.contentKey, contentKeyPrefix)) {
          contentKeys.push(parsed.contentKey);
        }
      }
      await guideCompletionMarkStorage.clearMany(contentKeys);
    } catch (error) {
      logger.warn('Failed to clear guide completion marks', { error });
    }
  },
};

/**
 * Durable half of each of `completion-records/completion-recorder.ts`'s
 * once-guards. Keyed by the recorder's own `kind:guideSource:guideId` dedupe
 * string — not a content key — via the same versioned-key builder, so the
 * guard survives a page reload rather than resetting with the module's
 * in-memory `Set`. A reset invalidates the specific keys for the guide being
 * reset (`completion-records`'s `invalidateEmittedCompletion`), which is what
 * lets a re-marked guide emit a fresh record.
 *
 * Deliberately `createLocalStorage()`, never `createUserStorage()` —
 * surviving a reload is the whole contract, not surviving a device change.
 * The guard is read synchronously via raw `localStorage` (`isEmitted`
 * below), so a remote-synced copy could never be consulted anyway: every
 * write through the hybrid backend would be a PATCH nothing ever reads back
 * (owd-emitted-guard-remote-tombstones), and its `removeItem` writes an
 * empty-value tombstone rather than deleting, which a bulk reset would
 * otherwise fan out into dozens of PATCHes for guard keys that never held a
 * value. `createLocalStorage()`'s `removeItem` is a plain
 * `localStorage.removeItem` — an actual delete, no tombstone.
 */
function createCompletionGuardStorage(prefix: string) {
  const guardKey = (dedupeKey: string) => buildVersionedContentStorageKey(prefix, dedupeKey);
  const guard = {
    /** Synchronous read — the recorder's dedupe check runs outside React render, but must stay non-blocking. */
    isEmitted(dedupeKey: string): boolean {
      try {
        return localStorage.getItem(guardKey(dedupeKey)) === 'true';
      } catch {
        return false;
      }
    },

    async markEmitted(dedupeKey: string): Promise<void> {
      try {
        const storage = createLocalStorage();
        await storage.setItem(guardKey(dedupeKey), true);
      } catch (error) {
        logger.warn('Failed to persist completion dedupe key', { error });
      }
    },

    async clear(dedupeKey: string): Promise<void> {
      // isEmitted is a synchronous, unconditional check, so skip the write
      // entirely when there is nothing to clear — a reset over a set of
      // members it does not know completed any of would otherwise still issue
      // one localStorage removeItem per combination that never occurred.
      if (!guard.isEmitted(dedupeKey)) {
        return;
      }
      try {
        localStorage.removeItem(guardKey(dedupeKey));
      } catch (error) {
        logger.warn('Failed to clear completion dedupe key', { error });
      }
    },

    async clearAll(): Promise<void> {
      try {
        // A plain localStorage-backed key: an actual delete, no tombstone
        // companion to sweep afterwards.
        for (const key of collectKeysByPrefix(localStorage, prefix)) {
          localStorage.removeItem(key);
        }
      } catch (error) {
        logger.warn('Failed to clear completion dedupe keys', { error });
      }
    },
  };
  return guard;
}

export const completionEmittedStorage = createCompletionGuardStorage(StorageKeys.COMPLETION_EMITTED_PREFIX);

export const completionReportedStorage = createCompletionGuardStorage(StorageKeys.COMPLETION_REPORTED_PREFIX);

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
      logger.warn('Learning progress validation failed, using defaults', { issues: parsed.error.issues });
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
      logger.warn('Failed to update learning progress', { error });
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
      logger.warn('Failed to award badge', { error });
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
      logger.warn('Failed to dismiss celebration', { error });
    }
  },

  /**
   * Removes specific guide IDs from completedGuides (for path reset).
   * Preserves badges and other progress.
   */
  async removeCompletedGuides(guideIds: string[]): Promise<void> {
    try {
      const progress = await learningProgressStorage.get();
      progress.completedGuides = progress.completedGuides.filter((id) => !guideIds.includes(id));
      await learningProgressStorage.update(progress);

      // Notify listeners that progress has changed
      window.dispatchEvent(
        new CustomEvent(StorageEvents.LearningProgressUpdated, {
          detail: { type: 'guides-removed', guideIds },
        })
      );
    } catch (error) {
      logger.warn('Failed to remove completed guides', { error });
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
        new CustomEvent(StorageEvents.LearningProgressUpdated, {
          detail: { type: 'reset' },
        })
      );
    } catch (error) {
      logger.warn('Failed to clear learning progress', { error });
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
let guideResponseWrites: Promise<void> = Promise.resolve();

function queueGuideResponseWrite(write: () => Promise<void>): Promise<void> {
  const pending = guideResponseWrites.then(write);
  guideResponseWrites = pending.catch(() => {});
  return pending;
}

export const guideResponseStorage = {
  async mergeResponses(guideId: string, responses: Record<string, string>): Promise<void> {
    return queueGuideResponseWrite(async () => {
      if (
        ['__proto__', 'prototype', 'constructor'].includes(guideId) ||
        Object.entries(responses).some(([key, value]) => !isSafeResponseName(key) || value.length > MAX_INPUT_LENGTH)
      ) {
        throw new Error('Invalid guide inputs');
      }
      const storage = createUserStorage();
      const all = await guideResponseStorage.getAll();
      const previous = Object.hasOwn(all, guideId) ? all[guideId] : {};
      await storage.setItem(StorageKeys.GUIDE_RESPONSES, { ...all, [guideId]: { ...previous, ...responses } });
      window.dispatchEvent(
        new CustomEvent(StorageEvents.GuideResponseChanged, {
          detail: { guideId, variableName: '*', value: undefined },
        })
      );
    });
  },

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

      logger.warn('Guide responses validation failed, using defaults', { error: parsed.error });
      return DEFAULT_GUIDE_RESPONSES;
    } catch (error) {
      logger.warn('Failed to get guide responses', { error });
      return DEFAULT_GUIDE_RESPONSES;
    }
  },

  /**
   * Gets all responses for a specific guide
   */
  async getForGuide(guideId: string): Promise<Record<string, GuideResponseValue>> {
    const all = await guideResponseStorage.getAll();
    if (!Object.hasOwn(all, guideId)) {
      return {};
    }
    return all[guideId] ?? {};
  },

  /**
   * Gets a single response value
   */
  async getResponse(guideId: string, variableName: string): Promise<GuideResponseValue | undefined> {
    const guideResponses = await guideResponseStorage.getForGuide(guideId);
    return Object.hasOwn(guideResponses, variableName) ? guideResponses[variableName] : undefined;
  },

  /**
   * Sets a response value and dispatches event for reactive updates
   */
  async setResponse(guideId: string, variableName: string, value: GuideResponseValue): Promise<void> {
    return queueGuideResponseWrite(async () => {
      try {
        const storage = createUserStorage();
        const all = await guideResponseStorage.getAll();

        const previous = Object.hasOwn(all, guideId) ? (all[guideId] ?? {}) : {};
        const guideRecord = { ...previous, [variableName]: value };
        await storage.setItem(StorageKeys.GUIDE_RESPONSES, { ...all, [guideId]: guideRecord });

        // Dispatch event to notify listeners (for requirements re-evaluation)
        window.dispatchEvent(
          new CustomEvent(StorageEvents.GuideResponseChanged, {
            detail: { guideId, variableName, value },
          })
        );
      } catch (error) {
        logger.warn('Failed to set guide response', { error });
      }
    });
  },

  /**
   * Deletes a response and dispatches event
   */
  async deleteResponse(guideId: string, variableName: string): Promise<void> {
    return queueGuideResponseWrite(async () => {
      try {
        const storage = createUserStorage();
        const all = await guideResponseStorage.getAll();

        const previous = Object.hasOwn(all, guideId) ? all[guideId] : undefined;
        if (previous) {
          const guideRecord = { ...previous };
          delete guideRecord[variableName];
          const next = { ...all, [guideId]: guideRecord };
          if (Object.keys(guideRecord).length === 0) {
            delete next[guideId];
          }
          await storage.setItem(StorageKeys.GUIDE_RESPONSES, next);
        }

        // Dispatch event to notify listeners
        window.dispatchEvent(
          new CustomEvent(StorageEvents.GuideResponseChanged, {
            detail: { guideId, variableName, value: undefined },
          })
        );
      } catch (error) {
        logger.warn('Failed to delete guide response', { error });
      }
    });
  },

  /**
   * Clears all responses for a specific guide
   */
  async clearForGuide(guideId: string): Promise<void> {
    return queueGuideResponseWrite(async () => {
      try {
        const storage = createUserStorage();
        const all = await guideResponseStorage.getAll();

        const next = { ...all };
        delete next[guideId];
        await storage.setItem(StorageKeys.GUIDE_RESPONSES, next);

        // Dispatch event to notify listeners
        window.dispatchEvent(
          new CustomEvent(StorageEvents.GuideResponseChanged, {
            detail: { guideId, variableName: '*', value: undefined },
          })
        );
      } catch (error) {
        logger.warn('Failed to clear guide responses', { error });
      }
    });
  },
};
