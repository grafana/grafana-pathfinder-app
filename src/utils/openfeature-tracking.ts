import type { Hook, HookContext, EvaluationDetails, JsonValue } from '@openfeature/web-sdk';

import { reportAppInteraction, UserInteraction } from '../lib/analytics';
import { pathfinderFeatureFlags, type FeatureFlagName } from './openfeature';

/**
 * Module-level set to track which flags have been reported this page load.
 * Resets on page refresh since the module reloads.
 * This prevents duplicate analytics events when flags are evaluated multiple times.
 */
const reportedFlags = new Set<string>();

/**
 * OpenFeature hook that tracks feature flag evaluations to analytics
 *
 * This hook fires after each flag evaluation and reports the flag key,
 * evaluated value, and tracking key to Rudder Stack via reportAppInteraction.
 *
 * Only flags that have a `trackingKey` defined in pathfinderFeatureFlags
 * will be tracked. Each flag is only reported once per page load to avoid
 * duplicate events from multiple evaluations.
 *
 * @example
 * const client = OpenFeature.getClient(OPENFEATURE_DOMAIN);
 * client.addHooks(new TrackingHook());
 */
export class TrackingHook implements Hook {
  /**
   * Called after a flag is successfully evaluated
   *
   * Only processes flags with the 'pathfinder.' prefix to avoid intercepting
   * other plugins' flag evaluations when using API-level hooks.
   *
   * @param hookContext - Context about the flag evaluation
   * @param evaluationDetails - Details about the evaluated flag value
   */
  after(hookContext: HookContext, evaluationDetails: EvaluationDetails<JsonValue>): void {
    // Only process pathfinder flags - ignore other plugins' flags
    if (!hookContext.flagKey.startsWith('pathfinder.')) {
      return;
    }

    const flagKey = hookContext.flagKey as FeatureFlagName;
    const flagDef = pathfinderFeatureFlags[flagKey];

    // Only track flags that have a trackingKey defined
    if (flagDef && 'trackingKey' in flagDef && flagDef.trackingKey) {
      // Skip if already reported this page load
      if (reportedFlags.has(flagKey)) {
        return;
      }

      // Mark as reported and send analytics
      reportedFlags.add(flagKey);

      reportAppInteraction(UserInteraction.FeatureFlagEvaluated, {
        flag_key: hookContext.flagKey,
        flag_value: this.stringifyValue(evaluationDetails.value),
        tracking_key: flagDef.trackingKey,
      });
    }
  }

  /**
   * Safely stringify any flag value for analytics
   */
  private stringifyValue(value: JsonValue): string {
    if (value === null || value === undefined) {
      return 'null';
    }
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return '[object]';
      }
    }
    return String(value);
  }
}
