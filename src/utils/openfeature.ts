import { ClientProviderStatus, OpenFeature, ProviderEvents, type Client, type JsonValue } from '@openfeature/web-sdk';
import { useBooleanFlagValue, useStringFlagValue, useNumberFlagValue } from '@openfeature/react-sdk';
import { OFREPWebProvider } from '@openfeature/ofrep-web-provider';
import { config } from '@grafana/runtime';

import { TrackingHook, reportFeatureFlagExposure } from './openfeature-tracking';
import { StorageKeys } from '../lib/storage-keys';

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
 * Highlighted-guide experiment configuration
 *
 * Drives the once-per-browser A/B test that opens the Pathfinder sidebar on a
 * matched Grafana page and surfaces a specific guide in the Featured slot.
 * Both `control` and `treatment` arms keep Pathfinder visible (this is the
 * key difference from the existing `pathfinder.experiment-variant` flag, whose
 * `control` arm hides the sidebar).
 *
 * @param variant - 'control' and 'treatment' both trigger sidebar-open + injection; 'excluded' is no-op
 * @param pages - URL path patterns where the sidebar should open (empty array ⇒ no match, NOT all pages)
 * @param guideId - Doc id or shorthand: 'bundled:<id>' | 'api:<id>' | 'backend-guide:<id>' | full URL
 * @param autoOpen - When false, only the Featured-slot injection runs (no auto-open of the sidebar)
 * @param resetCache - When toggled true, clears the once-per-browser markers so auto-open re-fires
 * @param docType - Optional override for the Featured-card type. When omitted, `findDocPage`
 *                  infers the type from the URL pattern. Set explicitly when the inference is
 *                  wrong (e.g. a `/docs/learning-paths/...` URL that should open as a learning
 *                  journey, not a single docs page).
 */
export type HighlightedGuideDocType = 'docs-page' | 'learning-journey' | 'interactive';

export interface HighlightedGuideConfig extends ExperimentConfig {
  guideId: string;
  autoOpen: boolean;
  docType?: HighlightedGuideDocType;
}

/**
 * Default highlighted-guide config when flag is not set or errors.
 * Defaults to 'excluded' so the auto-open + injection are no-ops.
 */
export const DEFAULT_HIGHLIGHTED_GUIDE_CONFIG: HighlightedGuideConfig = {
  variant: 'excluded',
  pages: [],
  guideId: '',
  autoOpen: true,
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
   * Global kill-switch for the Pathfinder plugin in Grafana Cloud.
   * When true: Pathfinder loads normally (sidebar available)
   * When false: plugin is dismounted, the native Grafana help menu takes over
   *
   * This is separate from the A/B experiments — it controls the cloud-wide rollout.
   * Defaults to true so existing instances keep working if the flag is not set.
   */
  'pathfinder.enabled': {
    valueType: 'boolean',
    values: [true, false],
    defaultValue: true,
    trackingKey: 'pathfinder_enabled',
  },
  /**
   * Remote kill-switch for Faro frontend telemetry (errors, sessions, and — in
   * later phases — logs and analytics-event mirroring). Independent of
   * `pathfinder.enabled`: this only stops the telemetry stream, not the plugin.
   * Telemetry is already gated to Grafana Cloud; this flag exists to disable
   * it fleet-wide without a release if the collector or filtering misbehaves.
   */
  'pathfinder.frontend-telemetry': {
    valueType: 'boolean',
    values: [true, false],
    defaultValue: true,
    trackingKey: 'frontend_telemetry',
  },
  /**
   * Fraction of sessions Faro actually sends telemetry for (Faro's own
   * `sessionTracking.samplingRate`), remotely tunable without a release.
   * A session not selected by the sample sends nothing — errors, events,
   * logs — for its entire lifetime, not just a fraction of its signals.
   * 1 = every session (default, current behavior unchanged); 0 = none.
   */
  'pathfinder.frontend-telemetry-sample-rate': {
    valueType: 'number',
    values: [1],
    defaultValue: 1,
    trackingKey: 'frontend_telemetry_sample_rate',
  },
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
   * Highlighted-guide popout A/B experiment
   * - "excluded": Not in experiment, normal Pathfinder behavior (no popout, no Featured-slot injection)
   * - "control": In experiment, popout + Featured-slot injection on matched pages with `guideId` (variant A)
   * - "treatment": In experiment, popout + Featured-slot injection on matched pages with `guideId` (variant B)
   * Both arms keep Pathfinder visible — they differ only in which guide is featured.
   */
  'pathfinder.highlighted-guide-experiment': {
    valueType: 'object',
    values: [DEFAULT_HIGHLIGHTED_GUIDE_CONFIG as unknown as JsonValue],
    defaultValue: DEFAULT_HIGHLIGHTED_GUIDE_CONFIG as unknown as JsonValue,
    trackingKey: 'highlighted_guide_experiment',
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

export interface ExperimentAnalyticsEntry {
  flag: FeatureFlagName;
  variant: ExperimentConfig['variant'];
  pages: string[];
  resetCache?: boolean;
  [key: string]: unknown;
}

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
      disableVisibilityRefresh: true, // Do not refresh
      cacheMode: 'disabled', // Do not write to localStorage
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
// LOCAL OVERRIDES (for browser console testing)
// ============================================================================

const FLAG_OVERRIDE_STORAGE_KEY = StorageKeys.FLAG_OVERRIDES;

/**
 * Read all flag overrides from localStorage.
 * Returns an empty object if none are set or localStorage is unavailable.
 */
export function getFlagOverrides(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(FLAG_OVERRIDE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Set a local override for a feature flag.
 * The override is stored in localStorage and takes effect on the next page load.
 *
 * @param flagName - The flag to override (e.g. 'pathfinder.after-24h-experiment')
 * @param value - The override value (boolean, string, number, or object)
 */
export function setFlagOverride(flagName: string, value: unknown): void {
  const overrides = getFlagOverrides();
  overrides[flagName] = value;
  localStorage.setItem(FLAG_OVERRIDE_STORAGE_KEY, JSON.stringify(overrides));
}

/**
 * Remove a single flag override.
 */
export function removeFlagOverride(flagName: string): void {
  const overrides = getFlagOverrides();
  delete overrides[flagName];
  if (Object.keys(overrides).length === 0) {
    localStorage.removeItem(FLAG_OVERRIDE_STORAGE_KEY);
  } else {
    localStorage.setItem(FLAG_OVERRIDE_STORAGE_KEY, JSON.stringify(overrides));
  }
}

/**
 * Remove all flag overrides.
 */
export function clearFlagOverrides(): void {
  localStorage.removeItem(FLAG_OVERRIDE_STORAGE_KEY);
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
 * const shouldAutoOpen = getFeatureFlagValue('pathfinder.auto-open-sidebar', false);
 */
export const getFeatureFlagValue = (flagName: string, defaultValue: boolean): boolean => {
  try {
    const overrides = getFlagOverrides();
    if (flagName in overrides && typeof overrides[flagName] === 'boolean') {
      console.warn(`[OpenFeature] Using local override for '${flagName}':`, overrides[flagName]);
      return overrides[flagName] as boolean;
    }

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
 * const variant = getStringFlagValue('pathfinder.experiment-variant', 'a');
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
 * Synchronously get a number feature flag value (for non-React code)
 *
 * Use this for flags with a numeric value, e.g. a sample rate.
 *
 * @param flagName - The feature flag name
 * @param defaultValue - Default value if flag evaluation fails
 * @returns The evaluated flag value or default
 *
 * @example
 * const sampleRate = getNumberFlagValue('pathfinder.frontend-telemetry-sample-rate', 1);
 */
export const getNumberFlagValue = (flagName: string, defaultValue: number): number => {
  try {
    const client = getFeatureFlagClient();
    return client.getNumberValue(flagName, defaultValue);
  } catch (error) {
    console.error(`[OpenFeature] Error evaluating flag '${flagName}':`, error);
    return defaultValue;
  }
};

/**
 * Get the highlighted-guide experiment configuration.
 *
 * Reads `pathfinder.highlighted-guide-experiment` and validates the extra fields
 * (`guideId`, `autoOpen`) on top of the base `ExperimentConfig` shape. Falls back
 * to `DEFAULT_HIGHLIGHTED_GUIDE_CONFIG` (variant: 'excluded') when the flag is
 * missing, malformed, or evaluation throws.
 *
 * Supports the localStorage flag-override mechanism for QA / demos.
 *
 * @returns The validated highlighted-guide config or the safe default
 *
 * @example
 * const config = getHighlightedGuideConfig();
 * if (config.variant !== 'excluded' && matchesHighlightedGuidePage(config.pages, path)) {
 *   // pop out + inject config.guideId
 * }
 */
export const getHighlightedGuideConfig = (): HighlightedGuideConfig => {
  const flagName = 'pathfinder.highlighted-guide-experiment';
  try {
    const overrides = getFlagOverrides();
    if (flagName in overrides) {
      const override = overrides[flagName];
      const validated = validateHighlightedGuideValue(override);
      if (validated) {
        console.warn(`[OpenFeature] Using local override for '${flagName}':`, validated);
        // Fire the exposure event so override-driven QA / demo runs produce
        // the same analytics as a real MTFF assignment. The dedup state is
        // shared with the OpenFeature hook path — see openfeature-tracking.ts.
        reportFeatureFlagExposure(flagName, validated as unknown as JsonValue);
        return validated;
      }
    }

    const client = getFeatureFlagClient();
    const value = client.getObjectValue(flagName, DEFAULT_HIGHLIGHTED_GUIDE_CONFIG as unknown as JsonValue);
    return validateHighlightedGuideValue(value) ?? DEFAULT_HIGHLIGHTED_GUIDE_CONFIG;
  } catch (error) {
    console.error(`[OpenFeature] Error evaluating flag '${flagName}':`, error);
    return DEFAULT_HIGHLIGHTED_GUIDE_CONFIG;
  }
};

function validateHighlightedGuideValue(value: unknown): HighlightedGuideConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.variant !== 'string' || !Array.isArray(record.pages) || typeof record.guideId !== 'string') {
    return null;
  }
  const VALID_DOC_TYPES: ReadonlySet<HighlightedGuideDocType> = new Set([
    'docs-page',
    'learning-journey',
    'interactive',
  ]);
  const docType =
    typeof record.docType === 'string' && VALID_DOC_TYPES.has(record.docType as HighlightedGuideDocType)
      ? (record.docType as HighlightedGuideDocType)
      : undefined;

  return {
    variant: record.variant as HighlightedGuideConfig['variant'],
    pages: record.pages as string[],
    guideId: record.guideId,
    autoOpen: typeof record.autoOpen === 'boolean' ? record.autoOpen : true,
    resetCache: typeof record.resetCache === 'boolean' ? record.resetCache : false,
    ...(docType ? { docType } : {}),
  };
}

// ============================================================================
// EXPERIMENT ANALYTICS
// ============================================================================

const HIGHLIGHTED_GUIDE_FLAG: FeatureFlagName = 'pathfinder.highlighted-guide-experiment';

// The highlighted-guide experiment is the only live experiment. Excluded arms
// are dropped — 'excluded' means the user isn't enrolled, matching the
// exposure-event convention (openfeature-tracking.ts).
export const getActiveExperiments = (): ExperimentAnalyticsEntry[] => {
  const config = getHighlightedGuideConfig();
  return config.variant === 'excluded' ? [] : [{ flag: HIGHLIGHTED_GUIDE_FLAG, ...config }];
};

// ============================================================================
// URL PATTERN MATCHING
// ============================================================================

/**
 * Match a URL path against a pattern with optional wildcard support
 *
 * Supports two matching modes:
 * - Pattern ending with `*`: matches the path and its children on a segment boundary
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
 * matchPathPattern('/a/app/schedules*', '/a/app/schedules-v2');   // false (segment boundary)
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
    // Prefix match on a path-segment boundary: `/a/app*` matches `/a/app` and
    // `/a/app/child` but NOT `/a/appointments` (a shared substring is not a
    // match). When the prefix already ends in `/`, that slash is the boundary.
    const prefix = trimmedPattern.slice(0, -1);
    if (!path.startsWith(prefix)) {
      return false;
    }
    if (prefix.endsWith('/')) {
      return true;
    }
    const rest = path.slice(prefix.length);
    return rest === '' || rest.startsWith('/');
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
