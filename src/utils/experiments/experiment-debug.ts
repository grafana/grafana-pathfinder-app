/**
 * Debug surface for the live experiments (window.__pathfinderExperiment).
 *
 * Exposes feature-flag names and analytics exposure inspection for local QA and
 * demos. See docs/developer/EXPERIMENT_TESTING.md.
 */

import { collectKeysByPrefix } from '../../lib/storage/key-utils';
import { StorageKeys } from '../../lib/storage-keys';
import { pathfinderFeatureFlags, type HighlightedGuideConfig } from '../openfeature';
import { getEnrolledInteractiveLearningBannerConfig } from './interactive-learning-banner';

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

  window.__pathfinderExperiment = {
    // Highlighted-guide config captured at module load time
    config,
    variant: config.variant,
    loadedAt: new Date().toISOString(),

    // A getter, not a snapshot: the banner arm is resolved lazily when a Pathfinder
    // panel first opens, so a value captured here would always read 'not-enrolled'.
    // Reads the memo only — calling this never enrolls anyone.
    bannerVariant: () => getEnrolledInteractiveLearningBannerConfig()?.variant ?? 'not-enrolled',

    flags: Object.keys(pathfinderFeatureFlags),
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
