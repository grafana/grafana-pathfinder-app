/**
 * Debug utilities for the Pathfinder experiment system
 *
 * Exposes window.__pathfinderExperiment for console debugging:
 * - config: The experiment config captured at module load
 * - variant: The experiment variant
 * - loadedAt: Timestamp when config was loaded
 * - refetch(): Re-fetch from GOFF and compare (rate limited)
 * - clearCache(): Clear all Pathfinder storage to reset state
 */

import { getExperimentConfig, matchPathPattern, type ExperimentConfig } from './openfeature';
import { experimentAutoOpenStorage, StorageKeys } from '../lib/user-storage';

// Rate limiting for refetch
const REFETCH_COOLDOWN_MS = 5000; // 5 second cooldown
let lastRefetchTime = 0;

/**
 * Storage keys used by Pathfinder for auto-open tracking
 * Uses centralized key prefixes from StorageKeys
 */
const getStorageKeys = (hostname: string) => ({
  // localStorage - persists across sessions
  resetProcessed: `${StorageKeys.EXPERIMENT_RESET_PROCESSED_PREFIX}${hostname}`,

  // sessionStorage - cleared when browser closes
  autoOpened: `${StorageKeys.EXPERIMENT_SESSION_AUTO_OPENED_PREFIX}${hostname}`,
  // Legacy global treatment key (kept for backwards compatibility)
  treatmentOpened: `grafana-pathfinder-experiment-treatment-opened-${hostname}`,
  // Per-page treatment prefix
  treatmentPagePrefix: `${StorageKeys.EXPERIMENT_TREATMENT_PAGE_PREFIX}${hostname}-`,
});

/**
 * Extract the parent path from a page pattern for app-level tracking.
 *
 * For app paths (/a/app-id/*), extracts /a/app-id so all pages within
 * an app are tracked together (e.g., all IRM pages count as one).
 *
 * For non-app paths, extracts the first segment (e.g., /dashboard).
 *
 * Examples:
 * - /a/grafana-irm-app/integrations* → /a/grafana-irm-app
 * - /a/grafana-irm-app?tab=home* → /a/grafana-irm-app
 * - /a/grafana-synthetic-monitoring-app* → /a/grafana-synthetic-monitoring-app
 * - /dashboard/snapshots* → /dashboard
 * - /alerting/list* → /alerting
 */
export function getParentPath(pattern: string): string {
  // For app paths (/a/app-id/*), extract /a/app-id
  // Stop at /, *, or ? (query string)
  if (pattern.startsWith('/a/')) {
    const match = pattern.match(/^(\/a\/[^/*?]+)/);
    return match ? match[1]! : pattern;
  }

  // For non-app paths, extract first segment (e.g., /dashboard)
  // Stop at /, *, or ? (query string)
  const match = pattern.match(/^(\/[^/*?]+)/);
  return match ? match[1]! : pattern;
}

/**
 * Get the session storage key for a specific parent path
 */
export function getTreatmentPageKey(hostname: string, parentPath: string): string {
  return `${StorageKeys.EXPERIMENT_TREATMENT_PAGE_PREFIX}${hostname}-${parentPath}`;
}

/**
 * Check if a parent path has already triggered auto-open this session.
 * Uses parent path (e.g., /a/grafana-irm-app) for app-level tracking.
 */
export function hasParentAutoOpened(hostname: string, parentPath: string): boolean {
  const key = getTreatmentPageKey(hostname, parentPath);
  return sessionStorage.getItem(key) === 'true';
}

/**
 * Mark a parent path as having triggered auto-open this session.
 * Writes to both sessionStorage (sync, immediate) and Grafana user storage (async, persistent).
 * Uses parent path (e.g., /a/grafana-irm-app) for app-level tracking.
 */
export function markParentAutoOpened(hostname: string, parentPath: string): void {
  // Write to sessionStorage immediately (sync) for same-session checks
  const key = getTreatmentPageKey(hostname, parentPath);
  sessionStorage.setItem(key, 'true');

  // Also write to Grafana user storage (async) for cross-browser persistence
  // Fire and forget - don't block on this
  experimentAutoOpenStorage.markPageAutoOpened(parentPath).catch((error: unknown) => {
    console.warn('[Pathfinder] Failed to persist parent auto-open to user storage:', error);
  });
}

/**
 * Mark global auto-open as having occurred (excluded variant)
 * Writes to both sessionStorage (sync) and Grafana user storage (async)
 */
export function markGlobalAutoOpened(hostname: string): void {
  const keys = getStorageKeys(hostname);
  sessionStorage.setItem(keys.autoOpened, 'true');

  // Also write to Grafana user storage for cross-browser persistence
  experimentAutoOpenStorage.markGlobalAutoOpened().catch((error: unknown) => {
    console.warn('[Pathfinder] Failed to persist global auto-open to user storage:', error);
  });
}

/**
 * Sync experiment auto-open state from Grafana user storage to sessionStorage
 * This should be called on app initialization to restore state from previous sessions
 * Returns a promise that resolves when sync is complete
 */
export async function syncExperimentStateFromUserStorage(hostname: string, targetPages: string[]): Promise<void> {
  try {
    const state = await experimentAutoOpenStorage.get();

    // Sync global auto-open state
    if (state.globalAutoOpened) {
      const keys = getStorageKeys(hostname);
      sessionStorage.setItem(keys.autoOpened, 'true');
    }

    // Sync per-page auto-open state
    for (const pagePattern of state.pagesAutoOpened) {
      const key = getTreatmentPageKey(hostname, pagePattern);
      sessionStorage.setItem(key, 'true');
    }
  } catch (error) {
    console.warn('[Pathfinder] Failed to sync experiment state from user storage:', error);
  }
}

/**
 * Reset experiment auto-open state in both storages
 * Called when resetCache flag is toggled in GOFF
 */
export async function resetExperimentState(hostname: string): Promise<void> {
  const keys = getStorageKeys(hostname);

  // Clear sessionStorage
  sessionStorage.removeItem(keys.autoOpened);
  sessionStorage.removeItem(keys.treatmentOpened);

  // Clear per-page keys from sessionStorage
  for (let i = sessionStorage.length - 1; i >= 0; i--) {
    const key = sessionStorage.key(i);
    if (key && key.startsWith(keys.treatmentPagePrefix)) {
      sessionStorage.removeItem(key);
    }
  }

  // Reset Grafana user storage
  await experimentAutoOpenStorage.reset();
}

/**
 * Find which target page pattern matches the current path
 * Returns the first matching pattern or null if no match
 */
export function findMatchingTargetPage(targetPages: string[], currentPath: string): string | null {
  for (const pattern of targetPages) {
    if (matchPathPattern(pattern, currentPath)) {
      return pattern;
    }
  }
  return null;
}

/**
 * Check if the sidebar should auto-open for the current path.
 * Uses app-level tracking: returns the parent path (e.g., /a/grafana-irm-app)
 * if the path matches a target page and the parent hasn't auto-opened yet.
 *
 * Returns the parent path if should open, null otherwise.
 */
export function shouldAutoOpenForPath(hostname: string, targetPages: string[], currentPath: string): string | null {
  const matchingPattern = findMatchingTargetPage(targetPages, currentPath);
  if (!matchingPattern) {
    return null;
  }

  // Extract parent path for app-level tracking
  const parentPath = getParentPath(matchingPattern);

  // Check if this parent (app) has already auto-opened
  if (hasParentAutoOpened(hostname, parentPath)) {
    return null;
  }

  // Return parent path for tracking (not exact pattern)
  return parentPath;
}

/**
 * Creates the debug object exposed on window.__pathfinderExperiment
 */
export function createExperimentDebugger(experimentConfig: ExperimentConfig): void {
  const hostname = window.location.hostname;
  const storageKeys = getStorageKeys(hostname);

  (window as any).__pathfinderExperiment = {
    // Config captured at module load time
    config: experimentConfig,
    variant: experimentConfig.variant,
    loadedAt: new Date().toISOString(),

    // Method to re-fetch from GOFF and compare (for debugging only)
    // Rate limited to prevent spam (5 second cooldown)
    refetch: () => {
      const now = Date.now();
      const timeSinceLastRefetch = now - lastRefetchTime;

      if (timeSinceLastRefetch < REFETCH_COOLDOWN_MS) {
        const waitTime = Math.ceil((REFETCH_COOLDOWN_MS - timeSinceLastRefetch) / 1000);
        console.warn(`[Pathfinder] Refetch rate limited. Try again in ${waitTime}s`);
        return null;
      }

      lastRefetchTime = now;
      const freshConfig = getExperimentConfig('pathfinder.experiment-variant');
      console.log('[Pathfinder] Experiment config comparison:');
      console.log('  Loaded at init:', {
        variant: experimentConfig.variant,
        pages: experimentConfig.pages,
        resetCache: experimentConfig.resetCache,
      });
      console.log('  Fresh from GOFF:', {
        variant: freshConfig.variant,
        pages: freshConfig.pages,
        resetCache: freshConfig.resetCache,
      });
      return freshConfig;
    },

    // Method to clear all Pathfinder storage (localStorage + sessionStorage + Grafana user storage)
    clearCache: async () => {
      console.log('[Pathfinder] Clearing all storage...');

      // Find all per-page treatment keys
      const perPageKeys: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith(storageKeys.treatmentPagePrefix)) {
          perPageKeys.push(key);
        }
      }

      // Show current state before clearing
      const perPageState: Record<string, string | null> = {};
      perPageKeys.forEach((key) => {
        perPageState[key] = sessionStorage.getItem(key);
      });

      // Get Grafana user storage state
      let userStorageState = null;
      try {
        userStorageState = await experimentAutoOpenStorage.get();
      } catch {
        console.warn('[Pathfinder] Could not read user storage state');
      }

      console.log('[Pathfinder] Current state:');
      console.log('  localStorage:', {
        [storageKeys.resetProcessed]: localStorage.getItem(storageKeys.resetProcessed),
      });
      console.log('  sessionStorage (global):', {
        [storageKeys.autoOpened]: sessionStorage.getItem(storageKeys.autoOpened),
        [storageKeys.treatmentOpened]: sessionStorage.getItem(storageKeys.treatmentOpened),
      });
      if (perPageKeys.length > 0) {
        console.log('[Pathfinder] Per-page treatment keys:', perPageState);
      }
      if (userStorageState) {
        console.log('[Pathfinder] Grafana user storage:', userStorageState);
      }

      // Clear localStorage
      localStorage.removeItem(storageKeys.resetProcessed);

      // Clear sessionStorage (global keys)
      sessionStorage.removeItem(storageKeys.autoOpened);
      sessionStorage.removeItem(storageKeys.treatmentOpened);

      // Clear per-page treatment keys
      perPageKeys.forEach((key) => sessionStorage.removeItem(key));

      // Clear Grafana user storage
      try {
        await experimentAutoOpenStorage.clear();
        console.log('[Pathfinder] Grafana user storage cleared');
      } catch (error) {
        console.warn('[Pathfinder] Failed to clear Grafana user storage:', error);
      }

      console.log(
        `[Pathfinder] Storage cleared (${perPageKeys.length} per-page keys). Refresh the page to re-evaluate experiment.`
      );
      return { cleared: true, keys: storageKeys, perPageKeysCleared: perPageKeys.length };
    },

    // Show current storage state without clearing
    showCache: async () => {
      // Find all per-page treatment keys
      const perPageKeys: Record<string, string | null> = {};
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith(storageKeys.treatmentPagePrefix)) {
          perPageKeys[key] = sessionStorage.getItem(key);
        }
      }

      // Get Grafana user storage state
      let userStorageState = null;
      try {
        userStorageState = await experimentAutoOpenStorage.get();
      } catch {
        console.warn('[Pathfinder] Could not read user storage state');
      }

      const state = {
        localStorage: {
          resetProcessed: localStorage.getItem(storageKeys.resetProcessed),
        },
        sessionStorage: {
          autoOpened: sessionStorage.getItem(storageKeys.autoOpened),
          treatmentOpened: sessionStorage.getItem(storageKeys.treatmentOpened),
        },
        perPageKeys,
        userStorage: userStorageState,
      };

      console.log('[Pathfinder] Global keys:');
      console.log(
        '  Reset processed (localStorage):',
        storageKeys.resetProcessed,
        '=',
        state.localStorage.resetProcessed
      );
      console.log('  Auto-opened (sessionStorage):', storageKeys.autoOpened, '=', state.sessionStorage.autoOpened);
      console.log(
        '  Treatment opened (sessionStorage):',
        storageKeys.treatmentOpened,
        '=',
        state.sessionStorage.treatmentOpened
      );

      if (Object.keys(perPageKeys).length > 0) {
        console.log('[Pathfinder] Per-page treatment keys (auto-open once per target page):', perPageKeys);
      } else {
        console.log('[Pathfinder] No per-page treatment keys found.');
      }

      if (userStorageState) {
        console.log('[Pathfinder] Grafana user storage (persists across browsers):', userStorageState);
      }

      return state;
    },

    // Storage keys for reference
    storageKeys,
  };
}

/**
 * Logs the experiment config at load time (always visible as warning)
 */
export function logExperimentConfig(config: ExperimentConfig): void {
  console.warn(
    `[Pathfinder] Experiment config loaded: variant="${config.variant}", pages=${JSON.stringify(config.pages)}, resetCache=${config.resetCache}`
  );
}
