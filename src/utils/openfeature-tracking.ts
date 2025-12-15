import type { Hook, HookContext, EvaluationDetails, JsonValue } from '@openfeature/web-sdk';

import { reportAppInteraction, UserInteraction } from '../lib/analytics';
import { pathfinderFeatureFlags, type FeatureFlagName } from './openfeature';

/**
 * OpenFeature hook that tracks feature flag evaluations to analytics
 *
 * This hook fires after each flag evaluation and reports the flag key,
 * evaluated value, and tracking key to Rudder Stack via reportAppInteraction.
 *
 * Only flags that have a `trackingKey` defined in pathfinderFeatureFlags
 * will be tracked.
 *
 * @example
 * const client = OpenFeature.getClient(OPENFEATURE_DOMAIN);
 * client.addHooks(new TrackingHook());
 */
export class TrackingHook implements Hook {
  /**
   * Called after a flag is successfully evaluated
   *
   * @param hookContext - Context about the flag evaluation
   * @param evaluationDetails - Details about the evaluated flag value
   */
  after(hookContext: HookContext, evaluationDetails: EvaluationDetails<JsonValue>): void {
    const flagKey = hookContext.flagKey as FeatureFlagName;
    const flagDef = pathfinderFeatureFlags[flagKey];

    // Only track flags that have a trackingKey defined
    if (flagDef && 'trackingKey' in flagDef && flagDef.trackingKey) {
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
