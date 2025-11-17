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

// ============================================================================
// STORAGE KEYS
// ============================================================================

export const StorageKeys = {
  JOURNEY_COMPLETION: 'grafana-pathfinder-app-journey-completion',
  TABS: 'grafana-pathfinder-app-tabs',
  ACTIVE_TAB: 'grafana-pathfinder-app-active-tab',
  INTERACTIVE_STEPS_PREFIX: 'grafana-pathfinder-app-interactive-steps-', // Dynamic: grafana-pathfinder-app-interactive-steps-{contentKey}-{sectionId}
  WYSIWYG_PREVIEW: 'grafana-pathfinder-app-wysiwyg-preview',
  SECTION_COLLAPSE_PREFIX: 'grafana-pathfinder-app-section-collapse-', // Dynamic: grafana-pathfinder-app-section-collapse-{contentKey}-{sectionId}
} as const;

// Timestamp suffix for conflict resolution
const TIMESTAMP_SUFFIX = '__timestamp';

/**
 * Gets the timestamp key for a given storage key
 */
function getTimestampKey(key: string): string {
  return `${key}${TIMESTAMP_SUFFIX}`;
}

// ============================================================================
// SECURITY LIMITS
// ============================================================================

const LIMITS = {
  MAX_JOURNEY_COMPLETIONS: 100, // Prevent quota exhaustion
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

  // Queue for async writes to Grafana storage
  const writeQueue: Array<{ key: string; value: string }> = [];
  let isProcessingQueue = false;

  // Process queued writes to Grafana storage
  const processQueue = async () => {
    if (isProcessingQueue || writeQueue.length === 0) {
      return;
    }

    isProcessingQueue = true;

    while (writeQueue.length > 0) {
      const item = writeQueue.shift();
      if (item) {
        try {
          await grafanaStorage.setItem(item.key, item.value);
        } catch (error) {
          console.warn(`Failed to sync to Grafana storage: ${item.key}`, error);
          // Don't retry - localStorage is the immediate source of truth
        }
      }
    }

    isProcessingQueue = false;
  };

  return {
    async getItem<T>(key: string): Promise<T | null> {
      // Read from localStorage for immediate access
      return localStorage.getItem<T>(key);
    },

    async setItem<T>(key: string, value: T): Promise<void> {
      try {
        const serialized = JSON.stringify(value);
        const timestamp = Date.now().toString();

        // 1. Write to localStorage first (synchronous, survives page refresh)
        await localStorage.setItem(key, value);
        // Store timestamp for conflict resolution
        await localStorage.setItem(getTimestampKey(key), timestamp);

        // 2. Queue write to Grafana storage (async, eventual consistency)
        writeQueue.push({ key, value: serialized });
        writeQueue.push({ key: getTimestampKey(key), value: timestamp });

        // Process queue in background (don't await - we don't want to block)
        processQueue().catch((error) => {
          console.warn('Error processing Grafana storage queue:', error);
        });
      } catch (error) {
        // If localStorage fails, at least try Grafana storage
        console.warn(`Failed to write to localStorage: ${key}, trying Grafana storage`, error);
        try {
          const serialized = JSON.stringify(value);
          const timestamp = Date.now().toString();
          await grafanaStorage.setItem(key, serialized);
          await grafanaStorage.setItem(getTimestampKey(key), timestamp);
        } catch (grafanaError) {
          console.error(`Failed to write to both storages: ${key}`, grafanaError);
          throw grafanaError;
        }
      }
    },

    async removeItem(key: string): Promise<void> {
      const timestamp = Date.now().toString();

      // Remove from localStorage first
      await localStorage.removeItem(key);
      // Store deletion timestamp so we can resolve conflicts properly
      await localStorage.setItem(getTimestampKey(key), timestamp);

      // Queue removal to Grafana storage (set to empty string with timestamp)
      writeQueue.push({ key, value: '' });
      writeQueue.push({ key: getTimestampKey(key), value: timestamp });
      processQueue().catch((error) => {
        console.warn('Error processing Grafana storage queue:', error);
      });
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
 * Syncs data from Grafana user storage to localStorage on initialization
 * Uses timestamp comparison to keep the most recent data (last-write-wins)
 *
 * Deletion Handling:
 * - Deletions are represented by a timestamp without data (value='')
 * - If a deletion timestamp is newer than existing data, the deletion is applied
 * - This ensures deletions propagate correctly across devices/sessions
 */
async function syncFromGrafanaStorage(grafanaStorage: any): Promise<void> {
  try {
    // Get all our storage keys
    const keysToSync = [StorageKeys.JOURNEY_COMPLETION, StorageKeys.TABS, StorageKeys.ACTIVE_TAB];

    for (const key of keysToSync) {
      try {
        // Get value and timestamp from Grafana storage
        const grafanaValue = await grafanaStorage.getItem(key);
        const grafanaTimestampStr = await grafanaStorage.getItem(getTimestampKey(key));

        // Get value and timestamp from localStorage
        const localValue = localStorage.getItem(key);
        const localTimestampStr = localStorage.getItem(getTimestampKey(key));

        // Parse timestamps (default to 0 if not found)
        const grafanaTimestamp = grafanaTimestampStr ? parseInt(grafanaTimestampStr, 10) : 0;
        const localTimestamp = localTimestampStr ? parseInt(localTimestampStr, 10) : 0;

        const hasGrafanaData = grafanaValue && grafanaValue !== '';
        const hasLocalData = localValue && localValue !== '';
        const hasGrafanaTimestamp = grafanaTimestamp > 0;
        const hasLocalTimestamp = localTimestamp > 0;

        // Conflict resolution based on timestamps
        // Note: A timestamp without data indicates a deletion
        if (hasGrafanaTimestamp && hasLocalTimestamp) {
          // Both have timestamps - compare them to resolve conflict
          if (grafanaTimestamp > localTimestamp) {
            // Grafana is newer
            if (hasGrafanaData) {
              // Grafana has newer data - use it
              localStorage.setItem(key, grafanaValue);
              localStorage.setItem(getTimestampKey(key), grafanaTimestampStr);
            } else {
              // Grafana has newer deletion - apply it
              localStorage.removeItem(key);
              localStorage.setItem(getTimestampKey(key), grafanaTimestampStr);
            }
          } else if (localTimestamp > grafanaTimestamp) {
            // localStorage is newer
            if (hasLocalData) {
              // localStorage has newer data - sync it back to Grafana
              await grafanaStorage.setItem(key, localValue);
              await grafanaStorage.setItem(getTimestampKey(key), localTimestampStr);
            } else {
              // localStorage has newer deletion - sync it back to Grafana
              await grafanaStorage.setItem(key, '');
              await grafanaStorage.setItem(getTimestampKey(key), localTimestampStr);
            }
          }
          // If timestamps are equal, they're in sync
        } else if (hasGrafanaTimestamp) {
          // Only Grafana has timestamp
          if (hasGrafanaData) {
            // Grafana has data - use it
            localStorage.setItem(key, grafanaValue);
            localStorage.setItem(getTimestampKey(key), grafanaTimestampStr);
          } else {
            // Grafana has deletion - apply it
            localStorage.removeItem(key);
            localStorage.setItem(getTimestampKey(key), grafanaTimestampStr);
          }
        } else if (hasLocalTimestamp) {
          // Only localStorage has timestamp
          if (hasLocalData) {
            // localStorage has data - sync it to Grafana
            await grafanaStorage.setItem(key, localValue);
            await grafanaStorage.setItem(getTimestampKey(key), localTimestampStr);
          } else {
            // localStorage has deletion - sync it to Grafana
            await grafanaStorage.setItem(key, '');
            await grafanaStorage.setItem(getTimestampKey(key), localTimestampStr);
          }
        }
        // If neither has timestamp, nothing to sync
      } catch (error) {
        console.warn(`Failed to sync key from Grafana storage: ${key}`, error);
      }
    }
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
      const storage = createUserStorage();
      const key = `${StorageKeys.INTERACTIVE_STEPS_PREFIX}${contentKey}-${sectionId}`;
      await storage.removeItem(key);
    } catch (error) {
      console.warn('Failed to clear completed steps:', error);
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
