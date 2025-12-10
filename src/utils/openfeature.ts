import { OpenFeature, useBooleanFlagValue, useStringFlagValue, useNumberFlagValue } from '@openfeature/react-sdk';
import { OFREPWebProvider } from '@openfeature/ofrep-web-provider';
import { config } from '@grafana/runtime';

/**
 * OpenFeature domain for grafana-pathfinder-app
 *
 * Using a domain isolates this plugin's provider from Grafana core and other plugins.
 * This is REQUIRED per OpenFeature best practices for frontend plugins.
 */
export const OPENFEATURE_DOMAIN = 'grafana-pathfinder-app';

/**
 * Feature flag keys used in grafana-pathfinder-app
 *
 * These flags are evaluated dynamically at runtime via the Multi-Tenant Feature Flag
 * Service (MTFF) in Grafana Cloud.
 *
 * Naming convention: prefix with component name (e.g., pathfinder.feature-name)
 *
 * To add a new flag:
 * 1. Define the constant here
 * 2. Add flag definition in deployment_tools/.../feature-toggles/goff/
 * 3. Use useFeatureFlag() hook in React components or getFeatureFlagValue() elsewhere
 */
export const FeatureFlags = {
  /**
   * Controls whether the sidebar automatically opens on first Grafana load per session
   * When true: sidebar opens automatically on first page load
   * When false: sidebar only opens when user explicitly requests it
   */
  AUTO_OPEN_SIDEBAR_ON_LAUNCH: 'pathfinder.auto-open-sidebar',

  /**
   * A/B experiment variant for testing pathfinder vs native help
   * - "a" (treatment): Register sidebar, auto-open enabled
   * - "b" (control): Don't register sidebar, Grafana falls back to native help dropdown
   * Default: "a" to preserve existing behavior if flag not set
   */
  EXPERIMENT_VARIANT: 'pathfinder.experiment-variant',
} as const;

/**
 * Track initialization state to prevent double initialization
 */
let isInitialized = false;

/**
 * Initialize OpenFeature with OFREPWebProvider for Grafana Cloud
 *
 * This connects to the Multi-Tenant Feature Flag Service (MTFF) for dynamic
 * runtime flag evaluation with targeting context.
 *
 * Call this once at plugin initialization (in module.tsx) before React components mount.
 *
 * @example
 * // In module.tsx
 * import { initializeOpenFeature } from './utils/openfeature';
 * initializeOpenFeature();
 */
export const initializeOpenFeature = (): void => {
  // Prevent double initialization
  if (isInitialized) {
    return;
  }

  // Check if provider already set for this domain (in case code runs twice)
  // If getProvider(DOMAIN) returns the same as getProvider() (default), it means no provider is set
  if (OpenFeature.getProvider(OPENFEATURE_DOMAIN) !== OpenFeature.getProvider()) {
    isInitialized = true;
    return;
  }

  try {
    const namespace = config.namespace;

    if (!namespace) {
      console.warn('[OpenFeature] config.namespace not available, skipping initialization');
      return;
    }

    OpenFeature.setProvider(
      OPENFEATURE_DOMAIN,
      new OFREPWebProvider({
        baseUrl: `/apis/features.grafana.app/v0alpha1/namespaces/${namespace}`,
        pollInterval: -1, // Do not poll - flags are fetched once
        timeoutMs: 10_000, // Timeout after 10 seconds
      }),
      {
        // MTFF required context
        targetingKey: namespace,
        namespace: namespace,
      }
    );

    isInitialized = true;
  } catch (error) {
    console.error('[OpenFeature] Failed to initialize provider:', error);
  }
};

/**
 * Get an OpenFeature client for the pathfinder domain
 *
 * Use this for non-React code that needs to evaluate feature flags.
 * For React components, prefer the useFeatureFlag hooks.
 *
 * @example
 * const client = getFeatureFlagClient();
 * const isEnabled = client.getBooleanValue(FeatureFlags.AUTO_OPEN_SIDEBAR_ON_LAUNCH, false);
 */
export const getFeatureFlagClient = () => {
  return OpenFeature.getClient(OPENFEATURE_DOMAIN);
};

/**
 * Synchronously get a boolean feature flag value (for non-React code)
 *
 * Note: This returns the default value if the provider hasn't finished initializing.
 * For guaranteed up-to-date values, use the React hooks or await provider initialization.
 *
 * @param flagName - The feature flag name (use FeatureFlags constants)
 * @param defaultValue - Default value if flag evaluation fails or provider not ready
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
 * Note: This returns the default value if the provider hasn't finished initializing.
 *
 * @param flagName - The feature flag name (use FeatureFlags constants)
 * @param defaultValue - Default value if flag evaluation fails or provider not ready
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
 * React hooks for feature flag evaluation
 *
 * These hooks automatically update when flag values change and handle
 * provider initialization state.
 *
 * Must be used within an OpenFeatureProvider component tree.
 *
 * @example
 * // In a React component
 * const autoOpen = useBooleanFlag(FeatureFlags.AUTO_OPEN_SIDEBAR_ON_LAUNCH, false);
 */
export {
  useBooleanFlagValue as useBooleanFlag,
  useStringFlagValue as useStringFlag,
  useNumberFlagValue as useNumberFlag,
};
