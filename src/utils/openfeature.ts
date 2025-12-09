import { warn, error } from '../lib/logger';
import { config } from '@grafana/runtime';

/**
 * Feature toggle keys used in grafana-pathfinder-app
 *
 * These flags are managed through Grafana's core feature toggle system,
 * accessible via config.featureToggles.
 *
 * To add a new flag:
 * 1. Define the constant here
 * 2. Register in Grafana's feature toggle registry (for Cloud/Enterprise)
 * 3. Use getFeatureToggle() to check the flag value
 *
 * Define all feature flags here as constants for type safety and easy discovery.
 */
export const FeatureFlags = {
  // Controls whether the sidebar automatically opens on first Grafana load per session
  // When true: sidebar opens automatically on first page load
  // When false: sidebar only opens when user explicitly requests it
  AUTO_OPEN_SIDEBAR_ON_LAUNCH: 'grafanaPathfinderAutoOpenSidebar',
} as const;

/**
 * Get the value of a Grafana feature toggle
 *
 * @param flagName - The feature toggle name (use FeatureFlags constants)
 * @param defaultValue - Default value if toggle is not found or featureToggles is unavailable
 * @returns The feature toggle value, or undefined if not set and no default provided
 *
 * @example
 * // With default value
 * const isEnabled = getFeatureToggle(FeatureFlags.AUTO_OPEN_SIDEBAR_ON_LAUNCH, true);
 *
 * // Without default (returns undefined if not set)
 * const toggleValue = getFeatureToggle(FeatureFlags.AUTO_OPEN_SIDEBAR_ON_LAUNCH);
 * if (toggleValue === false) {
 *   // Toggle explicitly disabled
 * } else {
 *   // Toggle true or not set - use other logic
 * }
 */
export const getFeatureToggle = (flagName: string, defaultValue?: boolean): boolean | undefined => {
  try {
    const featureToggles = config.featureToggles as Record<string, boolean> | undefined;

    if (!featureToggles) {
      if (defaultValue !== undefined) {
        warn(`[FeatureFlags] featureToggles not available, using default: ${defaultValue}`);
      }
      return defaultValue;
    }

    // Return the toggle value if it exists, otherwise use default
    const value = featureToggles[flagName];
    return value !== undefined ? value : defaultValue;
  } catch (err) {
    error(`[FeatureFlags] Error checking feature toggle '${flagName}':`, err);
    return defaultValue;
  }
};
