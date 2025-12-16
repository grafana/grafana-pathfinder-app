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

import { getExperimentConfig, FeatureFlags, matchPathPattern, type ExperimentConfig } from './openfeature';

// Rate limiting for refetch
const REFETCH_COOLDOWN_MS = 5000; // 5 second cooldown
let lastRefetchTime = 0;

// Prefix for per-page treatment tracking keys
const TREATMENT_PAGE_PREFIX = 'grafana-pathfinder-treatment-page-';

/**
 * Storage keys used by Pathfinder for auto-open tracking
 */
const getStorageKeys = (hostname: string) => ({
  // localStorage - persists across sessions
  resetProcessed: `grafana-pathfinder-pop-open-reset-processed-${hostname}`,

  // sessionStorage - cleared when browser closes
  autoOpened: `grafana-interactive-learning-panel-auto-opened-${hostname}`,
  // Legacy global treatment key (kept for backwards compatibility)
  treatmentOpened: `grafana-pathfinder-experiment-treatment-opened-${hostname}`,
  // Per-page treatment prefix
  treatmentPagePrefix: `${TREATMENT_PAGE_PREFIX}${hostname}-`,
});

/**
 * Get the session storage key for a specific target page pattern
 */
export function getTreatmentPageKey(hostname: string, pagePattern: string): string {
  return `${TREATMENT_PAGE_PREFIX}${hostname}-${pagePattern}`;
}

/**
 * Check if a specific target page pattern has already triggered auto-open this session
 */
export function hasPageAutoOpened(hostname: string, pagePattern: string): boolean {
  const key = getTreatmentPageKey(hostname, pagePattern);
  return sessionStorage.getItem(key) === 'true';
}

/**
 * Mark a target page pattern as having triggered auto-open this session
 */
export function markPageAutoOpened(hostname: string, pagePattern: string): void {
  const key = getTreatmentPageKey(hostname, pagePattern);
  sessionStorage.setItem(key, 'true');
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
 * Check if the sidebar should auto-open for the current path
 * Returns the matching pattern if should open, null otherwise
 */
export function shouldAutoOpenForPath(hostname: string, targetPages: string[], currentPath: string): string | null {
  const matchingPattern = findMatchingTargetPage(targetPages, currentPath);
  if (!matchingPattern) {
    return null;
  }

  if (hasPageAutoOpened(hostname, matchingPattern)) {
    return null;
  }

  return matchingPattern;
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
      const freshConfig = getExperimentConfig(FeatureFlags.EXPERIMENT_VARIANT);
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

    // Method to clear all Pathfinder storage (localStorage + sessionStorage)
    clearCache: () => {
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

      // Clear localStorage
      localStorage.removeItem(storageKeys.resetProcessed);

      // Clear sessionStorage (global keys)
      sessionStorage.removeItem(storageKeys.autoOpened);
      sessionStorage.removeItem(storageKeys.treatmentOpened);

      // Clear per-page treatment keys
      perPageKeys.forEach((key) => sessionStorage.removeItem(key));

      console.log(
        `[Pathfinder] Storage cleared (${perPageKeys.length} per-page keys). Refresh the page to re-evaluate experiment.`
      );
      return { cleared: true, keys: storageKeys, perPageKeysCleared: perPageKeys.length };
    },

    // Show current storage state without clearing
    showCache: () => {
      // Find all per-page treatment keys
      const perPageKeys: Record<string, string | null> = {};
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith(storageKeys.treatmentPagePrefix)) {
          perPageKeys[key] = sessionStorage.getItem(key);
        }
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
