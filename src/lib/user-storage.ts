/**
 * User storage abstraction for the Grafana Docs Plugin
 *
 * This module provides a unified storage API that uses Grafana's user storage
 * when available (Grafana 11.5+) and falls back to localStorage for older versions.
 *
 * Key features:
 * - User-specific storage in Grafana database (when available)
 * - Automatic fallback to localStorage
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
} as const;

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

/**
 * Storage interface for user data operations
 */
export interface UserStorage {
  getItem<T>(key: string): Promise<T | null>;
  setItem<T>(key: string, value: T): Promise<void>;
  removeItem(key: string): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Storage backend type
 */
export type StorageBackend = 'user-storage' | 'local-storage';

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
        // Create wrapper for Grafana storage
        storage = {
          async getItem<T>(key: string): Promise<T | null> {
            try {
              const value = await grafanaStorage.getItem(key);

              // Handle null, undefined, and empty string (all mean "not found")
              if (value === null || value === undefined || value === '') {
                return null;
              }

              // Try to parse as JSON
              try {
                const parsed = JSON.parse(value) as T;
                return parsed;
              } catch {
                return value as unknown as T;
              }
            } catch (error) {
              console.warn(`Failed to get item from user storage: ${key}`, error);
              return null;
            }
          },

          async setItem<T>(key: string, value: T): Promise<void> {
            try {
              const serialized = JSON.stringify(value);
              await grafanaStorage.setItem(key, serialized);
            } catch (error) {
              console.error(`Failed to set item in user storage: ${key}`, error);
              throw error;
            }
          },

          async removeItem(key: string): Promise<void> {
            try {
              // Grafana storage doesn't have removeItem, set to empty string
              await grafanaStorage.setItem(key, '');
            } catch (error) {
              console.warn(`Failed to remove item from user storage: ${key}`, error);
            }
          },

          async clear(): Promise<void> {
            console.warn('Clear operation not fully supported for Grafana user storage');
          },
        };
        storageRef.current = storage;

        // Set global storage so standalone helpers can use it
        setGlobalStorage(storage);
      } else {
        // Fall back to localStorage
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
