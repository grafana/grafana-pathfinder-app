import type { Hook, HookContext, EvaluationDetails, JsonValue } from '@openfeature/web-sdk';

import { reportAppInteraction, UserInteraction } from '../lib/analytics';
import { StorageKeys } from '../lib/storage-keys';
import { pathfinderFeatureFlags, type FeatureFlagName } from './openfeature';

/**
 * In-memory fast path so the same flag never fires twice within one page load
 * (e.g. if localStorage is unavailable and the persistent dedup below silently
 * fails). Resets on every page reload — the persistent marker takes over after
 * the first successful fire.
 */
const reportedFlagsThisPageLoad = new Set<string>();

function getExposureMarkerKey(flagKey: string, variant: string): string {
  const hostname = window.location.hostname;
  return `${StorageKeys.EXPERIMENT_EXPOSURE_REPORTED_PREFIX}${hostname}:${flagKey}:${variant}`;
}

function hasReportedExposure(flagKey: string, variant: string): boolean {
  try {
    return localStorage.getItem(getExposureMarkerKey(flagKey, variant)) === 'true';
  } catch {
    return false;
  }
}

function markReportedExposure(flagKey: string, variant: string): void {
  try {
    localStorage.setItem(getExposureMarkerKey(flagKey, variant), 'true');
  } catch {
    // localStorage unavailable — the in-memory Set still prevents double-fires
    // within this page load. Next page load may re-fire; acceptable tradeoff.
  }
}

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
 * Fires `pathfinder_feature_flag_evaluated` **once per browser per (flag,
 * variant) combination**, persisted via localStorage. Variant reassignment
 * (e.g. control → treatment) re-fires because the marker key changes, which
 * is what downstream A/B tools expect for fresh-arm exposures.
 *
 * Only experiment flags (object-valued with a `variant` field) generate
 * exposures, and only when the user is actually assigned to an arm
 * (variant === 'control' or 'treatment'). Excluded users, boolean
 * kill-switch flags, and untracked flags produce zero events.
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
   *   5. Flag must not have been reported yet this page load (in-memory fast path)
   *   6. Flag must not have been reported in any previous page load on this
   *      browser+hostname for this (flag, variant) combo (localStorage)
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

    const sessionKey = `${flagKey}:${variant}`;
    if (reportedFlagsThisPageLoad.has(sessionKey)) {
      return;
    }
    if (hasReportedExposure(flagKey, variant)) {
      reportedFlagsThisPageLoad.add(sessionKey);
      return;
    }

    reportAppInteraction(UserInteraction.FeatureFlagEvaluated, {
      flag_key: hookContext.flagKey,
      flag_value: this.stringifyValue(evaluationDetails.value),
      tracking_key: flagDef.trackingKey,
      variant,
    });

    reportedFlagsThisPageLoad.add(sessionKey);
    markReportedExposure(flagKey, variant);
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
