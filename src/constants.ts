import pluginJson from './plugin.json';
import { config } from '@grafana/runtime';

export const PLUGIN_BASE_URL = `/a/${pluginJson.id}`;

// Default configuration values
export const DEFAULT_DOCS_BASE_URL = 'https://grafana.com';
export const DEFAULT_RECOMMENDER_SERVICE_URL = 'https://recommender.grafana.com';
export const DEFAULT_TERMS_ACCEPTED = false;
export const DEFAULT_TUTORIAL_URL = '';
export const TERMS_VERSION = '1.0.0';

// Interactive Features defaults
export const DEFAULT_ENABLE_AUTO_DETECTION = false; // Opt-in feature
export const DEFAULT_REQUIREMENTS_CHECK_TIMEOUT = 3000; // ms
export const DEFAULT_GUIDED_STEP_TIMEOUT = 30000; // ms (30 seconds)

// Global Link Interception defaults
export const DEFAULT_INTERCEPT_GLOBAL_DOCS_LINKS = true; // Opt-in feature

// Network timeout defaults
export const DEFAULT_CONTENT_FETCH_TIMEOUT = 10000; // 10 seconds for document retrieval
export const DEFAULT_RECOMMENDER_TIMEOUT = 5000; // 5 seconds for recommender API

// Security: Allowed GitHub repository paths for interactive tutorials
// Meeting commitment: ONLY the single controlled interactive-tutorials repo
export const ALLOWED_GITHUB_REPO_PATHS = [
  '/grafana/interactive-tutorials/', // Single source of truth for interactive tutorials
];

// Security: Allowed recommender service domains
// Only these domains are permitted for the recommendation API to prevent MITM attacks
export const ALLOWED_RECOMMENDER_DOMAINS = ['recommender.grafana.com', 'recommender-staging.grafana.com'];

// Configuration interface
export interface DocsPluginConfig {
  recommenderServiceUrl?: string;
  tutorialUrl?: string;
  // Terms and Conditions
  acceptedTermsAndConditions?: boolean;
  termsVersion?: string;
  // Dev mode is now per-user via localStorage (deprecated in plugin settings)
  /** @deprecated Dev mode is now stored per-user in localStorage, not in plugin settings */
  devMode?: boolean;
  // Interactive Features
  enableAutoDetection?: boolean;
  requirementsCheckTimeout?: number;
  guidedStepTimeout?: number;
  // Global Link Interception
  interceptGlobalDocsLinks?: boolean;
}

// Helper functions to get configuration values with defaults
export const getConfigWithDefaults = (config: DocsPluginConfig): Required<DocsPluginConfig> => ({
  recommenderServiceUrl: config.recommenderServiceUrl || DEFAULT_RECOMMENDER_SERVICE_URL,
  tutorialUrl: config.tutorialUrl || DEFAULT_TUTORIAL_URL,
  acceptedTermsAndConditions: config.acceptedTermsAndConditions ?? getPlatformSpecificDefault(),
  termsVersion: config.termsVersion || TERMS_VERSION,
  // Dev mode is now per-user via localStorage, not in config
  devMode: false, // Deprecated: always returns false, use isDevModeEnabled() from utils/dev-mode.ts
  // Interactive Features
  enableAutoDetection: config.enableAutoDetection ?? DEFAULT_ENABLE_AUTO_DETECTION,
  requirementsCheckTimeout: config.requirementsCheckTimeout ?? DEFAULT_REQUIREMENTS_CHECK_TIMEOUT,
  guidedStepTimeout: config.guidedStepTimeout ?? DEFAULT_GUIDED_STEP_TIMEOUT,
  // Global Link Interception
  interceptGlobalDocsLinks: config.interceptGlobalDocsLinks ?? DEFAULT_INTERCEPT_GLOBAL_DOCS_LINKS,
});

/**
 * Get platform-specific default for recommender enabled state
 * Cloud: enabled by default (always online)
 * OSS: disabled by default (might be offline)
 */
const getPlatformSpecificDefault = (): boolean => {
  try {
    const isCloud = config.bootData.settings.buildInfo.versionString.startsWith('Grafana Cloud');
    return isCloud; // Cloud = true (enabled), OSS = false (disabled)
  } catch (error) {
    console.warn('Failed to detect platform, defaulting to disabled:', error);
    return false; // Conservative default
  }
};

export const isRecommenderEnabled = (pluginConfig: DocsPluginConfig): boolean => {
  return getConfigWithDefaults(pluginConfig).acceptedTermsAndConditions;
};

// Legacy exports for backward compatibility - now require config parameter
export const getRecommenderServiceUrl = (config: DocsPluginConfig) =>
  getConfigWithDefaults(config).recommenderServiceUrl;
export const getTutorialUrl = (config: DocsPluginConfig) => getConfigWithDefaults(config).tutorialUrl;
export const getTermsAccepted = (config: DocsPluginConfig) => getConfigWithDefaults(config).acceptedTermsAndConditions;
export const getTermsVersion = (config: DocsPluginConfig) => getConfigWithDefaults(config).termsVersion;

/**
 * @deprecated Dev mode is now per-user via localStorage. Use isDevModeEnabled() from utils/dev-mode.ts instead.
 * This function now always returns false for backward compatibility.
 */
export const getDevMode = (_config: DocsPluginConfig) => false;

// Legacy exports for backward compatibility
export const RECOMMENDER_SERVICE_URL = DEFAULT_RECOMMENDER_SERVICE_URL;
export const DOCS_BASE_URL = DEFAULT_DOCS_BASE_URL;

export enum ROUTES {
  Context = '',
}
