/**
 * Debug utilities for the Pathfinder experiment system
 *
 * Exposes window.__pathfinderExperiment for console debugging:
 * - config: The experiment config captured at module load
 * - variant: The experiment variant
 * - loadedAt: Timestamp when config was loaded
 * - refetch(): Re-fetch from GOFF and compare (rate limited)
 * - clearCache(): Clear all Pathfinder storage to reset state
 * - showCache(): Display current storage state
 */

import { experimentAutoOpenStorage } from '../../lib/user-storage';
import { collectKeysByPrefix } from '../../lib/storage/key-utils';
import { StorageKeys } from '../../lib/storage-keys';
import {
  getExperimentConfig,
  setFlagOverride,
  removeFlagOverride,
  clearFlagOverrides,
  getFlagOverrides,
  pathfinderFeatureFlags,
  type ExperimentConfig,
} from '../openfeature';
import { getStorageKeys } from './experiment-utils';

interface ExposureMarker {
  key: string;
  flag: string;
  variant: string;
}

function listExposureMarkers(hostname: string): ExposureMarker[] {
  const prefix = `${StorageKeys.EXPERIMENT_EXPOSURE_REPORTED_PREFIX}${hostname}:`;
  return collectKeysByPrefix(localStorage, prefix).map((key) => {
    // Marker shape: `{prefix}{hostname}:{flagKey}:{variant}`
    // flagKey contains a dot but never a colon, so split on the last colon.
    const suffix = key.slice(prefix.length);
    const lastColon = suffix.lastIndexOf(':');
    const flag = lastColon >= 0 ? suffix.slice(0, lastColon) : suffix;
    const variant = lastColon >= 0 ? suffix.slice(lastColon + 1) : '';
    return { key, flag, variant };
  });
}

// Rate limiting for refetch
const REFETCH_COOLDOWN_MS = 5000; // 5 second cooldown
let lastRefetchTime = 0;

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
      const perPageKeys = collectKeysByPrefix(sessionStorage, storageKeys.treatmentPagePrefix);

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
        [storageKeys.autoOpened]: localStorage.getItem(storageKeys.autoOpened),
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
      localStorage.removeItem(storageKeys.autoOpened);

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
      for (const key of collectKeysByPrefix(sessionStorage, storageKeys.treatmentPagePrefix)) {
        perPageKeys[key] = sessionStorage.getItem(key);
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
          autoOpened: localStorage.getItem(storageKeys.autoOpened),
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

    // --- Flag override methods (persist in localStorage, take effect on next page load) ---

    flags: Object.keys(pathfinderFeatureFlags),

    setOverride: (flagName: string, value: unknown) => {
      if (!(flagName in pathfinderFeatureFlags)) {
        console.warn(`[Pathfinder] Unknown flag '${flagName}'. Known flags:`, Object.keys(pathfinderFeatureFlags));
      }
      setFlagOverride(flagName, value);
      console.log(`[Pathfinder] Override set for '${flagName}':`, value);
      console.log('[Pathfinder] Refresh the page for the override to take effect.');
    },

    removeOverride: (flagName: string) => {
      removeFlagOverride(flagName);
      console.log(`[Pathfinder] Override removed for '${flagName}'. Refresh the page to use GOFF value.`);
    },

    clearOverrides: () => {
      clearFlagOverrides();
      console.log('[Pathfinder] All overrides cleared. Refresh the page to use GOFF values.');
    },

    showOverrides: () => {
      const overrides = getFlagOverrides();
      if (Object.keys(overrides).length === 0) {
        console.log('[Pathfinder] No flag overrides set.');
      } else {
        console.log('[Pathfinder] Active flag overrides (take effect on page load):');
        for (const [flag, value] of Object.entries(overrides)) {
          console.log(`  ${flag}:`, value);
        }
      }
      return overrides;
    },

    // --- Analytics exposure dedup ---
    // pathfinder_feature_flag_evaluated fires at most once per (hostname, flag, variant)
    // per browser, persisted under StorageKeys.EXPERIMENT_EXPOSURE_REPORTED_PREFIX. These
    // helpers show or clear those markers so a QA tester can verify "did the exposure
    // event fire already?" and "force it to re-fire on the next reload."

    showExposures: () => {
      const markers = listExposureMarkers(hostname);
      if (markers.length === 0) {
        console.log(
          '[Pathfinder] No analytics exposures deduped for this hostname. The next non-excluded experiment evaluation will fire pathfinder_feature_flag_evaluated.'
        );
      } else {
        console.log(`[Pathfinder] ${markers.length} analytics exposure(s) already reported for this hostname:`);
        for (const m of markers) {
          console.log(`  ${m.flag} (variant=${m.variant})`);
        }
      }
      return markers;
    },

    clearExposures: () => {
      const markers = listExposureMarkers(hostname);
      markers.forEach((m) => {
        try {
          localStorage.removeItem(m.key);
        } catch {
          // localStorage unavailable
        }
      });
      console.log(
        `[Pathfinder] Cleared ${markers.length} analytics exposure marker(s). Reload the page to re-fire pathfinder_feature_flag_evaluated for any active experiment.`
      );
      return { cleared: markers.length };
    },
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
