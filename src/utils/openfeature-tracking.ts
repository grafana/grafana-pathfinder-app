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
 * Variants for which we emit a FeatureFlagEvaluated exposure event.
 *
 * We intentionally skip 'excluded' (user isn't in the experiment) so the
 * event stream only contains real experiment exposures (control + treatment),
 * which is what downstream A/B analysis needs.
 */
const TRACKED_EXPERIMENT_VARIANTS = new Set(['control', 'treatment']);

/**
 * OpenFeature hook that tracks experiment exposures to analytics.
 *
 * Fires `pathfinder_feature_flag_evaluated` once per experiment flag per page
 * load, but only when the user is actually assigned to an experiment arm
 * (variant === 'control' or 'treatment'). Non-experiment flags (boolean
 * kill-switches, auto-open toggles) and excluded users do NOT generate events.
 *
 * @example
 * OpenFeature.addHooks(new TrackingHook());
 */
export class TrackingHook implements Hook {
  /**
   * Called after a flag is successfully evaluated.
   *
   * Filtering rules (in order):
   *   1. Flag key must start with 'pathfinder.' (ignore other plugins' flags)
   *   2. Flag must be defined in pathfinderFeatureFlags with a trackingKey
   *   3. Flag must be an experiment flag (valueType === 'object' with a variant)
   *   4. Variant must be 'control' or 'treatment' (skip 'excluded')
   *   5. Flag must not have been reported yet this page load
   */
  after(hookContext: HookContext, evaluationDetails: EvaluationDetails<JsonValue>): void {
    if (!hookContext.flagKey.startsWith('pathfinder.')) {
      return;
    }

    const flagKey = hookContext.flagKey as FeatureFlagName;
    const flagDef = pathfinderFeatureFlags[flagKey];

    if (!flagDef || !('trackingKey' in flagDef) || !flagDef.trackingKey) {
      return;
    }

    // Only experiment flags (object-valued with a `variant` field) are exposures.
    // Boolean flags like pathfinder.enabled / auto-open-sidebar are config, not
    // experiment arms, so they don't generate exposure events.
    if (flagDef.valueType !== 'object') {
      return;
    }

    const variant = this.extractVariant(evaluationDetails.value);
    if (!variant || !TRACKED_EXPERIMENT_VARIANTS.has(variant)) {
      return;
    }

    if (reportedFlags.has(flagKey)) {
      return;
    }
    reportedFlags.add(flagKey);

    reportAppInteraction(UserInteraction.FeatureFlagEvaluated, {
      flag_key: hookContext.flagKey,
      flag_value: this.stringifyValue(evaluationDetails.value),
      tracking_key: flagDef.trackingKey,
      variant,
    });
  }

  /**
   * Safely extract a string `variant` field from a JSON flag value.
   * Returns null if the value isn't an object or has no string variant.
   */
  private extractVariant(value: JsonValue): string | null {
    if (value && typeof value === 'object' && !Array.isArray(value) && 'variant' in value) {
      const raw = (value as { variant: unknown }).variant;
      return typeof raw === 'string' ? raw : null;
    }
    return null;
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
