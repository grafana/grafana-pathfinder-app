import { ClientProviderStatus, OpenFeature, ProviderEvents, type Client, type JsonValue } from '@openfeature/web-sdk';
import { useBooleanFlagValue, useStringFlagValue, useNumberFlagValue } from '@openfeature/react-sdk';
import { OFREPWebProvider } from '@openfeature/ofrep-web-provider';
import { config } from '@grafana/runtime';

import { TrackingHook } from './openfeature-tracking';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Discriminated union for feature flag type definitions
 *
 * @param valueType - The type of the feature flag value
 * @param values - The possible values for the feature flag
 * @param defaultValue - The default value for the feature flag
 * @param trackingKey - If provided, the feature flag value will be tracked using the given key
 */
type FeatureFlag =
  | { valueType: 'boolean'; values: readonly boolean[]; defaultValue: boolean; trackingKey?: string }
  | { valueType: 'object'; values: readonly JsonValue[]; defaultValue: JsonValue; trackingKey?: string }
  | { valueType: 'number'; values: readonly number[]; defaultValue: number; trackingKey?: string }
  | { valueType: 'string'; values: readonly string[]; defaultValue: string; trackingKey?: string };

/**
 * Experiment configuration returned by GOFF
 * Contains both the variant assignment and target pages for auto-open
 *
 * @param variant - The experiment variant assignment
 * @param pages - Target pages where sidebar should auto-open (for treatment)
 * @param resetCache - When toggled true, clears session storage to allow sidebar to auto-open again
 */
export interface ExperimentConfig {
  variant: 'excluded' | 'control' | 'treatment';
  pages: string[];
  resetCache?: boolean;
}

/**
 * Default experiment config when flag is not set or errors
 * Defaults to 'excluded' to preserve normal Pathfinder behavior
 */
export const DEFAULT_EXPERIMENT_CONFIG: ExperimentConfig = {
  variant: 'excluded',
  pages: [],
  resetCache: false,
};

// ============================================================================
// FEATURE FLAG DEFINITIONS
// ============================================================================

/**
 * All feature flags used in Grafana Pathfinder
 *
 * These flags are evaluated dynamically at runtime via the Multi-Tenant Feature Flag
 * Service (MTFF) in Grafana Cloud.
 *
 * Naming convention: prefix with component name (e.g., pathfinder.feature-name)
 */
const pathfinderFeatureFlags = {
  /**
   * Controls whether the sidebar automatically opens on first Grafana load per session
   * When true: sidebar opens automatically on first page load
   * When false: sidebar only opens when user explicitly requests it
   */
  'pathfinder.auto-open-sidebar': {
    valueType: 'boolean',
    values: [true, false],
    defaultValue: false,
    trackingKey: 'auto_open_sidebar',
  },
  /**
   * A/B experiment variant for testing Pathfinder impact on onboarding
   * - "excluded": Not in experiment, normal Pathfinder behavior (sidebar available)
   * - "control": In experiment, no sidebar (native Grafana help only)
   * - "treatment": In experiment, sidebar auto-opens on target pages
   * Default: "excluded" to preserve normal behavior if flag not set
   */
  'pathfinder.experiment-variant': {
    valueType: 'object',
    values: [DEFAULT_EXPERIMENT_CONFIG as unknown as JsonValue],
    defaultValue: DEFAULT_EXPERIMENT_CONFIG as unknown as JsonValue,
    trackingKey: 'experiment_variant',
  },
} as const satisfies Record<`pathfinder.${string}`, FeatureFlag>;

// Helper to get typed keys from the flag definitions
const getObjectKeys = <T extends object>(obj: T): Array<keyof T> => Object.keys(obj) as Array<keyof T>;

const featureFlagNames = getObjectKeys(pathfinderFeatureFlags);

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type FeatureFlagName = (typeof featureFlagNames)[number];
export type FlagValue<T extends FeatureFlagName> = (typeof pathfinderFeatureFlags)[T]['values'][number];
export type FlagTrackingKey = (typeof pathfinderFeatureFlags)[keyof typeof pathfinderFeatureFlags] extends infer Flag
  ? Flag extends { trackingKey: infer K }
    ? K
    : never
  : never;

/**
 * Map of flag names to their tracking keys (only for flags with trackingKey defined)
 */
export const featureFlagTrackingKeys = Object.fromEntries(
  featureFlagNames.reduce<Array<[FeatureFlagName, FlagTrackingKey]>>((acc, flagName) => {
    const flagDef = pathfinderFeatureFlags[flagName];
    if ('trackingKey' in flagDef && flagDef.trackingKey) {
      acc.push([flagName, flagDef.trackingKey as FlagTrackingKey]);
    }
    return acc;
  }, [])
);

/**
 * Export the flag definitions for use by TrackingHook
 */
export { pathfinderFeatureFlags };

// ============================================================================
// BACKWARDS COMPATIBILITY - Legacy constants
// ============================================================================

/**
 * @deprecated Use FeatureFlagName type and flag names directly instead
 * Legacy feature flag keys - kept for backwards compatibility
 */
export const FeatureFlags = {
  AUTO_OPEN_SIDEBAR_ON_LAUNCH: 'pathfinder.auto-open-sidebar' as const,
  EXPERIMENT_VARIANT: 'pathfinder.experiment-variant' as const,
} as const;

// ============================================================================
// OPENFEATURE CONFIGURATION
// ============================================================================

/**
 * OpenFeature domain for grafana-pathfinder-app
 *
 * Using a domain isolates this plugin's provider from Grafana core and other plugins.
 * This is REQUIRED per OpenFeature best practices for frontend plugins.
 */
export const OPENFEATURE_DOMAIN = 'grafana-pathfinder-app';

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize OpenFeature with OFREPWebProvider for Grafana Cloud
 *
 * This connects to the Multi-Tenant Feature Flag Service (MTFF) for dynamic
 * runtime flag evaluation with targeting context.
 *
 * Call this once at plugin initialization (in module.tsx) before React components mount.
 * Uses setProviderAndWait to ensure flags are ready before evaluation.
 * Adds TrackingHook once to track all flag evaluations to analytics.
 *
 * @returns Promise that resolves when provider is ready
 *
 * @example
 * // In module.tsx
 * import { initializeOpenFeature } from './utils/openfeature';
 * await initializeOpenFeature();
 */
export async function initializeOpenFeature(): Promise<void> {
  const namespace = config.namespace;

  if (!namespace) {
    console.warn('[OpenFeature] config.namespace not available, skipping initialization');
    return;
  }

  await OpenFeature.setProviderAndWait(
    OPENFEATURE_DOMAIN,
    new OFREPWebProvider({
      baseUrl: `/apis/features.grafana.app/v0alpha1/namespaces/${namespace}`,
      pollInterval: -1, // Do not poll - flags are fetched once on init
      timeoutMs: 10_000, // Timeout after 10 seconds
    }),
    {
      targetingKey: config.namespace, // Dimension of uniqueness, to ensure flags are evaluated consistently for a given stack
      namespace: config.namespace, // Required by the multi-tenant feature flag service
      ...config.openFeatureContext,
    }
  );

  // Add TrackingHook at API level (not client level) so it applies to ALL clients
  // This is necessary because OpenFeature.getClient() may return different instances
  OpenFeature.addHooks(new TrackingHook());
}

// ============================================================================
// CLIENT HELPERS
// ============================================================================

/**
 * Helper to wait for a client to be ready
 *
 * @param client - The OpenFeature client
 * @returns Promise that resolves when client is ready
 */
function waitForClientReady(client: Client): Promise<void> {
  if (client.providerStatus === ClientProviderStatus.READY) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    client.addHandler(ProviderEvents.Ready, () => resolve());
  });
}

/**
 * Get an OpenFeature client for the pathfinder domain
 *
 * Use this for non-React code that needs to evaluate feature flags.
 * For React components, prefer the useFeatureFlag hooks.
 *
 * @example
 * const client = getFeatureFlagClient();
 * const isEnabled = client.getBooleanValue('pathfinder.auto-open-sidebar', false);
 */
export const getFeatureFlagClient = () => {
  return OpenFeature.getClient(OPENFEATURE_DOMAIN);
};

// ============================================================================
// FLAG EVALUATION
// ============================================================================

/**
 * Evaluates a feature flag from the GOFF service
 *
 * This is the primary async function for evaluating flags with guaranteed
 * client readiness. It waits for the provider to be ready before evaluation.
 * TrackingHook is added once during initializeOpenFeature(), so all evaluations
 * (including this one) are automatically tracked.
 *
 * @param flagName - The name of the feature flag to evaluate
 * @returns The value of the feature flag
 *
 * @example
 * const autoOpen = await evaluateFeatureFlag('pathfinder.auto-open-sidebar');
 */
export async function evaluateFeatureFlag<T extends FeatureFlagName>(flagName: T): Promise<FlagValue<T>> {
  try {
    const client = OpenFeature.getClient(OPENFEATURE_DOMAIN);
    await waitForClientReady(client);

    const flagDef = pathfinderFeatureFlags[flagName] as FeatureFlag;

    switch (flagDef.valueType) {
      case 'boolean': {
        const booleanValue = client.getBooleanValue(flagName, flagDef.defaultValue);
        return booleanValue as unknown as FlagValue<T>;
      }
      case 'number': {
        const numberValue = client.getNumberValue(flagName, flagDef.defaultValue);
        return numberValue as unknown as FlagValue<T>;
      }
      case 'object': {
        const objectValue = client.getObjectValue(flagName, flagDef.defaultValue);
        return objectValue as unknown as FlagValue<T>;
      }
      case 'string': {
        const stringValue = client.getStringValue(flagName, flagDef.defaultValue);
        return stringValue as unknown as FlagValue<T>;
      }
      default:
        throw new Error(`Invalid flag value type for flag ${flagName}`);
    }
  } catch (error) {
    console.error(`[OpenFeature] Error evaluating flag '${flagName}':`, error);
    return pathfinderFeatureFlags[flagName].defaultValue as FlagValue<T>;
  }
}

// ============================================================================
// BACKWARDS COMPATIBLE SYNC FUNCTIONS
// ============================================================================
// Note: All sync functions below are automatically tracked by the TrackingHook
// that was added during initializeOpenFeature(). The hook fires for ALL
// flag evaluations on the client, including sync getBooleanValue, etc.

/**
 * Synchronously get a boolean feature flag value (for non-React code)
 *
 * Note: With async initialization, the provider should be ready by the time
 * this is called. Returns the default value on error.
 * Automatically tracked by TrackingHook if the flag has a trackingKey defined.
 *
 * @param flagName - The feature flag name
 * @param defaultValue - Default value if flag evaluation fails
 * @returns The evaluated flag value or default
 *
 * @example
 * const shouldAutoOpen = getFeatureFlagValue(FeatureFlags.AUTO_OPEN_SIDEBAR_ON_LAUNCH, false);
 */
export const getFeatureFlagValue = (flagName: string, defaultValue: boolean): boolean => {
  try {
    const client = getFeatureFlagClient();
    return client.getBooleanValue(flagName, defaultValue);
  } catch (error) {
    console.error(`[OpenFeature] Error evaluating flag '${flagName}':`, error);
    return defaultValue;
  }
};

/**
 * Synchronously get a string feature flag value (for non-React code)
 *
 * Use this for flags that have string variants (e.g., A/B experiments).
 *
 * @param flagName - The feature flag name
 * @param defaultValue - Default value if flag evaluation fails
 * @returns The evaluated flag value or default
 *
 * @example
 * const variant = getStringFlagValue(FeatureFlags.EXPERIMENT_VARIANT, 'a');
 */
export const getStringFlagValue = (flagName: string, defaultValue: string): string => {
  try {
    const client = getFeatureFlagClient();
    return client.getStringValue(flagName, defaultValue);
  } catch (error) {
    console.error(`[OpenFeature] Error evaluating flag '${flagName}':`, error);
    return defaultValue;
  }
};

/**
 * Get experiment configuration from a feature flag that returns a JSON object
 *
 * Use this for experiment flags that need to return both a variant and additional config.
 * The flag should return an object with { variant: string, pages: string[], resetCache?: boolean }
 *
 * @param flagName - The feature flag name
 * @returns The experiment configuration or DEFAULT_EXPERIMENT_CONFIG on error
 *
 * @example
 * const config = getExperimentConfig(FeatureFlags.EXPERIMENT_VARIANT);
 * if (config.variant === 'treatment') {
 *   // Auto-open on config.pages
 * }
 * if (config.resetCache) {
 *   // Clear session storage to allow sidebar to auto-open again
 * }
 */
export const getExperimentConfig = (flagName: string): ExperimentConfig => {
  try {
    const client = getFeatureFlagClient();
    const value = client.getObjectValue(flagName, DEFAULT_EXPERIMENT_CONFIG as unknown as JsonValue);

    // Validate the response has required fields before using
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      'variant' in value &&
      typeof (value as Record<string, unknown>).variant === 'string' &&
      'pages' in value &&
      Array.isArray((value as Record<string, unknown>).pages)
    ) {
      const record = value as Record<string, unknown>;
      return {
        variant: record.variant as ExperimentConfig['variant'],
        pages: record.pages as string[],
        resetCache: typeof record.resetCache === 'boolean' ? record.resetCache : false,
      };
    }
    return DEFAULT_EXPERIMENT_CONFIG;
  } catch (error) {
    console.error(`[OpenFeature] Error evaluating flag '${flagName}':`, error);
    return DEFAULT_EXPERIMENT_CONFIG;
  }
};

// ============================================================================
// URL PATTERN MATCHING
// ============================================================================

/**
 * Match a URL path against a pattern with optional wildcard support
 *
 * Supports two matching modes:
 * - Pattern ending with `*`: matches path and all children (prefix match)
 * - Pattern without `*`: exact match with trailing slash normalization
 *
 * @param pattern - The pattern to match against (e.g., "/a/app/schedules*" or "/a/app/schedules")
 * @param path - The current URL path to check
 * @returns True if the path matches the pattern
 *
 * @example
 * // Wildcard matching
 * matchPathPattern('/a/app/schedules*', '/a/app/schedules');      // true
 * matchPathPattern('/a/app/schedules*', '/a/app/schedules/123');  // true
 * matchPathPattern('/a/app/schedules*', '/a/app/schedule');       // false
 *
 * // Exact matching (with trailing slash normalization)
 * matchPathPattern('/a/app/schedules', '/a/app/schedules');       // true
 * matchPathPattern('/a/app/schedules', '/a/app/schedules/');      // true
 * matchPathPattern('/a/app/schedules', '/a/app/schedules/123');   // false
 */
export const matchPathPattern = (pattern: string, path: string): boolean => {
  const trimmedPattern = pattern.trim();
  const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path;

  if (trimmedPattern.endsWith('*')) {
    // Wildcard: match prefix
    const prefix = trimmedPattern.slice(0, -1);
    return path.startsWith(prefix);
  }

  // Exact match with trailing slash normalization
  const normalizedPattern = trimmedPattern.endsWith('/') ? trimmedPattern.slice(0, -1) : trimmedPattern;
  return normalizedPath === normalizedPattern;
};

// ============================================================================
// REACT HOOKS
// ============================================================================

/**
 * React hooks for feature flag evaluation
 *
 * These hooks automatically update when flag values change and handle
 * provider initialization state.
 *
 * Must be used within an OpenFeatureProvider component tree.
 *
 * @example
 * // In a React component
 * const autoOpen = useBooleanFlag('pathfinder.auto-open-sidebar', false);
 */
export {
  useBooleanFlagValue as useBooleanFlag,
  useStringFlagValue as useStringFlag,
  useNumberFlagValue as useNumberFlag,
};
