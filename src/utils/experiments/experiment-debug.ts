/**
 * Debug surface for the highlighted-guide experiment (window.__pathfinderExperiment).
 *
 * Exposes flag overrides (setOverride / removeOverride / clearOverrides /
 * showOverrides) and analytics exposure inspection (showExposures /
 * clearExposures) for local QA and demos. See docs/developer/EXPERIMENT_TESTING.md.
 */

import { collectKeysByPrefix } from '../../lib/storage/key-utils';
import { StorageKeys } from '../../lib/storage-keys';
import {
  setFlagOverride,
  removeFlagOverride,
  clearFlagOverrides,
  getFlagOverrides,
  pathfinderFeatureFlags,
  type HighlightedGuideConfig,
} from '../openfeature';

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

/**
 * Creates the debug object exposed on window.__pathfinderExperiment
 */
export function createExperimentDebugger(config: HighlightedGuideConfig): void {
  const hostname = window.location.hostname;

  (window as any).__pathfinderExperiment = {
    // Highlighted-guide config captured at module load time
    config,
    variant: config.variant,
    loadedAt: new Date().toISOString(),

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
