/**
 * Interactive-learning banner experiment.
 *
 * Owns everything about `pathfinder.interactive-learning-banner-experiment` except
 * the flag-registry entry itself (which has to live in `../openfeature` so the
 * registry stays the single typed source of flag names). Retiring the experiment
 * means deleting this file, its test, the registry entry, and
 * `src/components/InteractiveLearningBanner/`.
 */

import type { JsonValue } from '@openfeature/web-sdk';

import {
  getFeatureFlagClient,
  getFlagOverrides,
  parseExperimentVariant,
  warnExperimentRejection,
  type ExperimentConfig,
  type FeatureFlagName,
} from '../openfeature';
import { reportFeatureFlagExposure } from '../openfeature-tracking';
import { logger } from '../../lib/logging';

export const INTERACTIVE_LEARNING_BANNER_FLAG: FeatureFlagName = 'pathfinder.interactive-learning-banner-experiment';

/**
 * Variant-only by design: the banner explains Pathfinder itself, so unlike the
 * highlighted-guide experiment it has no per-page targeting.
 */
export interface InteractiveLearningBannerConfig {
  variant: ExperimentConfig['variant'];
}

export const DEFAULT_INTERACTIVE_LEARNING_BANNER_CONFIG: InteractiveLearningBannerConfig = {
  variant: 'excluded',
};

let enrolledConfig: InteractiveLearningBannerConfig | null = null;

function readConfig(): InteractiveLearningBannerConfig {
  const flagName = INTERACTIVE_LEARNING_BANNER_FLAG;
  try {
    const overrides = getFlagOverrides();
    if (flagName in overrides) {
      const override = overrides[flagName];
      const overrideVariant = parseExperimentVariant(override);
      if (overrideVariant) {
        logger.warn(`[OpenFeature] Using local override for '${flagName}'`, { override });
        // The override bypasses the client, so TrackingHook never sees it. Fire the
        // exposure here so QA runs produce the same analytics as an MTFF assignment.
        reportFeatureFlagExposure(flagName, { variant: overrideVariant });
        return { variant: overrideVariant };
      }
      warnExperimentRejection('override', flagName, override);
    }

    const client = getFeatureFlagClient();
    const value = client.getObjectValue(flagName, DEFAULT_INTERACTIVE_LEARNING_BANNER_CONFIG as unknown as JsonValue);
    const variant = parseExperimentVariant(value);
    if (!variant) {
      warnExperimentRejection('remote', flagName, value);
      return DEFAULT_INTERACTIVE_LEARNING_BANNER_CONFIG;
    }
    return { variant };
  } catch (error) {
    logger.error(`[OpenFeature] Error evaluating flag '${flagName}'`, { error });
    return DEFAULT_INTERACTIVE_LEARNING_BANNER_CONFIG;
  }
}

/**
 * Enroll the caller in the interactive-learning banner experiment.
 *
 * Evaluating this flag is what emits the `pathfinder_feature_flag_evaluated`
 * exposure, so the call site *is* the enrollment timing contract: call it only
 * when a Pathfinder panel opens, never at boot. Memoised, so remounts and a
 * second panel surface enroll once.
 *
 * @returns The enrolled arm
 */
export function enrollInteractiveLearningBannerExperiment(): InteractiveLearningBannerConfig {
  enrolledConfig ??= readConfig();
  return enrolledConfig;
}

/**
 * The enrolled arm, or null if no Pathfinder panel has opened yet.
 *
 * Cache read only — it must never evaluate the flag, or analytics enrichment
 * would enroll users who never opened Pathfinder.
 *
 * @returns The enrolled arm, or null before enrollment
 */
export function getEnrolledInteractiveLearningBannerConfig(): InteractiveLearningBannerConfig | null {
  return enrolledConfig;
}
