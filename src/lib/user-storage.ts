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
// STORAGE KEYS
// ============================================================================

export const StorageKeys = {
  JOURNEY_COMPLETION: 'grafana-pathfinder-app-journey-completion',
  TABS: 'grafana-pathfinder-app-tabs',
  ACTIVE_TAB: 'grafana-pathfinder-app-active-tab',
  INTERACTIVE_STEPS_PREFIX: 'grafana-pathfinder-app-interactive-steps-', // Dynamic: grafana-pathfinder-app-interactive-steps-{contentKey}-{sectionId}
  WYSIWYG_PREVIEW: 'grafana-pathfinder-app-wysiwyg-preview', // HTML content for editor persistence
  WYSIWYG_PREVIEW_JSON: 'grafana-pathfinder-app-wysiwyg-preview-json', // JSON content for test preview
  SECTION_COLLAPSE_PREFIX: 'grafana-pathfinder-app-section-collapse-', // Dynamic: grafana-pathfinder-app-section-collapse-{contentKey}-{sectionId}
  // Full screen mode persistence (for page refreshes during recording)
  FULLSCREEN_MODE_STATE: 'grafana-pathfinder-app-fullscreen-mode-state',
  FULLSCREEN_BUNDLED_STEPS: 'grafana-pathfinder-app-fullscreen-bundled-steps',
  FULLSCREEN_BUNDLING_ACTION: 'grafana-pathfinder-app-fullscreen-bundling-action',
  FULLSCREEN_SECTION_INFO: 'grafana-pathfinder-app-fullscreen-section-info',
  // Learning paths and badges progress
  LEARNING_PROGRESS: 'grafana-pathfinder-app-learning-progress',
  // Dev tools recording state persistence
  DEVTOOLS_RECORDING_STATE: 'grafana-pathfinder-app-devtools-recording-state',
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
    const keysToSync = [
      StorageKeys.JOURNEY_COMPLETION,
      StorageKeys.TABS,
      StorageKeys.ACTIVE_TAB,
      StorageKeys.LEARNING_PROGRESS,
    ];

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
        } else if (hasGrafanaTimestamp && !hasLocalData) {
          // Only Grafana has timestamp AND localStorage is empty
          if (hasGrafanaData) {
            // Grafana has data - use it
            localStorage.setItem(key, grafanaValue);
            localStorage.setItem(getTimestampKey(key), grafanaTimestampStr);
          }
          // Don't apply Grafana deletions if localStorage never had data
        } else if (hasGrafanaTimestamp && hasLocalData) {
          // Grafana has timestamp but localStorage has un-timestamped data
          // PRESERVE localStorage data - it was likely written before hybrid storage was set up
          // Assign it a timestamp and sync to Grafana
          const nowTimestamp = Date.now().toString();
          localStorage.setItem(getTimestampKey(key), nowTimestamp);
          await grafanaStorage.setItem(key, localValue);
          await grafanaStorage.setItem(getTimestampKey(key), nowTimestamp);
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
        } else if (hasLocalData) {
          // localStorage has data but no timestamp - assign one and sync to Grafana
          const nowTimestamp = Date.now().toString();
          localStorage.setItem(getTimestampKey(key), nowTimestamp);
          await grafanaStorage.setItem(key, localValue);
          await grafanaStorage.setItem(getTimestampKey(key), nowTimestamp);
        }
        // If neither has data, nothing to sync
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
