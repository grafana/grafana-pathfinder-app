import pluginJson from './plugin.json';
import { config } from '@grafana/runtime';

export const PLUGIN_BASE_URL = `/a/${pluginJson.id}`;

// Backend API URL for plugin resource endpoints
// Grafana routes backend resource calls through /api/plugins/{pluginId}/resources/
export const PLUGIN_BACKEND_URL = `/api/plugins/${pluginJson.id}/resources`;

// Default configuration values
export const DEFAULT_DOCS_BASE_URL = 'https://grafana.com';
export const DEFAULT_RECOMMENDER_SERVICE_URL = 'https://recommender.grafana.com';
export const DEFAULT_TERMS_ACCEPTED = false;
export const DEFAULT_TUTORIAL_URL = '';
export const TERMS_VERSION = '1.0.0';

// Interactive Features defaults
export const DEFAULT_ENABLE_AUTO_DETECTION = true; // Enabled by default
export const DEFAULT_REQUIREMENTS_CHECK_TIMEOUT = 3000; // ms
export const DEFAULT_GUIDED_STEP_TIMEOUT = 30000; // ms (30 seconds)

// Global Link Interception defaults
export const DEFAULT_INTERCEPT_GLOBAL_DOCS_LINKS = false; // Experimental opt-in feature

// Open Panel on Launch defaults
// Note: This is overridden by feature toggle if set
export const DEFAULT_OPEN_PANEL_ON_LAUNCH = false; // Experimental opt-in feature

// Live Sessions defaults
export const DEFAULT_ENABLE_LIVE_SESSIONS = false; // Opt-in feature - disabled by default for stability

// Coda Terminal defaults (experimental dev feature)
export const DEFAULT_ENABLE_CODA_TERMINAL = false; // Experimental - disabled by default

// Coda API configuration (hardcoded URL - no longer configurable)
// The Coda backend uses JWT authentication via enrollment keys
export const CODA_API_URL = 'https://coda.lg.grafana-dev.com';

// PeerJS Server defaults (for live sessions)
export const DEFAULT_PEERJS_HOST = 'localhost';
export const DEFAULT_PEERJS_PORT = 9000;
export const DEFAULT_PEERJS_KEY = 'pathfinder';

// Network timeout defaults
export const DEFAULT_CONTENT_FETCH_TIMEOUT = 10000; // 10 seconds for document retrieval
export const DEFAULT_RECOMMENDER_TIMEOUT = 5000; // 5 seconds for recommender API

// Security: Allowed interactive learning hostnames (exact match only, no wildcards)
// These are the only hostnames permitted for fetching interactive guides
export const ALLOWED_INTERACTIVE_LEARNING_HOSTNAMES = [
  'interactive-learning.grafana-dev.net',
  'interactive-learning.grafana.net',
  'interactive-learning.grafana-ops.net',
];

// Security: Allowed recommender service domains
// Only these domains are permitted for the recommendation API to prevent MITM attacks
export const ALLOWED_RECOMMENDER_DOMAINS = ['recommender.grafana.com', 'recommender.grafana-dev.com'];

// Security: Allowed Grafana documentation hostnames (exact match only, no wildcards)
// These are the only hostnames permitted for fetching documentation content
export const ALLOWED_GRAFANA_DOCS_HOSTNAMES = ['grafana.com', 'docs.grafana.com', 'play.grafana.com'];

// Dev mode defaults
export const DEFAULT_DEV_MODE = false;
export const DEFAULT_DEV_MODE_USER_IDS: number[] = [];

// Configuration interface
export interface DocsPluginConfig {
  recommenderServiceUrl?: string;
  tutorialUrl?: string;
  // Terms and Conditions
  acceptedTermsAndConditions?: boolean;
  termsVersion?: string;
  // Dev mode - SECURITY: Hybrid approach (instance-wide storage, per-user scoping)
  // Stored in plugin jsonData (server-side, admin-only) but scoped to specific user IDs
  devMode?: boolean; // Whether dev mode is enabled for the instance
  devModeUserIds?: number[]; // Array of user IDs who have dev mode access (only they see dev features)
  // Assistant Dev Mode - for testing assistant integration in OSS environments
  enableAssistantDevMode?: boolean; // Whether to mock assistant availability for testing
  // Interactive Features
  enableAutoDetection?: boolean;
  requirementsCheckTimeout?: number;
  guidedStepTimeout?: number;
  // Global Link Interception
  interceptGlobalDocsLinks?: boolean;
  // Open Panel on Launch
  openPanelOnLaunch?: boolean;
  // Live Sessions (Collaborative Learning)
  enableLiveSessions?: boolean;
  peerjsHost?: string;
  peerjsPort?: number;
  peerjsKey?: string;
  // Coda Terminal (Experimental dev feature for interactive sandbox)
  enableCodaTerminal?: boolean;
  // Coda registration status (JWT auth)
  // Note: codaEnrollmentKey and codaJwtToken are stored in secureJsonData, not here
  codaRegistered?: boolean; // Whether this instance has successfully registered with Coda
}

// Helper functions to get configuration values with defaults
// Note: devModeUserIds remains as array (empty when dev mode is disabled)
export const getConfigWithDefaults = (
  config: DocsPluginConfig
): Omit<Required<DocsPluginConfig>, 'devModeUserIds'> & { devModeUserIds: number[] } => ({
  recommenderServiceUrl: config.recommenderServiceUrl || DEFAULT_RECOMMENDER_SERVICE_URL,
  tutorialUrl: config.tutorialUrl || DEFAULT_TUTORIAL_URL,
  acceptedTermsAndConditions: config.acceptedTermsAndConditions ?? getPlatformSpecificDefault(),
  termsVersion: config.termsVersion || TERMS_VERSION,
  // Dev mode - SECURITY: Hybrid approach (stored server-side, scoped per-user)
  devMode: config.devMode ?? DEFAULT_DEV_MODE,
  devModeUserIds: config.devModeUserIds ?? DEFAULT_DEV_MODE_USER_IDS,
  // Assistant dev mode
  enableAssistantDevMode: config.enableAssistantDevMode ?? false,
  // Interactive Features
  enableAutoDetection: config.enableAutoDetection ?? DEFAULT_ENABLE_AUTO_DETECTION,
  requirementsCheckTimeout: config.requirementsCheckTimeout ?? DEFAULT_REQUIREMENTS_CHECK_TIMEOUT,
  guidedStepTimeout: config.guidedStepTimeout ?? DEFAULT_GUIDED_STEP_TIMEOUT,
  // Global Link Interception
  interceptGlobalDocsLinks: config.interceptGlobalDocsLinks ?? DEFAULT_INTERCEPT_GLOBAL_DOCS_LINKS,
  // Open Panel on Launch
  openPanelOnLaunch: config.openPanelOnLaunch ?? DEFAULT_OPEN_PANEL_ON_LAUNCH,
  // Live Sessions
  enableLiveSessions: config.enableLiveSessions ?? DEFAULT_ENABLE_LIVE_SESSIONS,
  peerjsHost: config.peerjsHost || DEFAULT_PEERJS_HOST,
  peerjsPort: config.peerjsPort ?? DEFAULT_PEERJS_PORT,
  peerjsKey: config.peerjsKey || DEFAULT_PEERJS_KEY,
  // Coda Terminal
  enableCodaTerminal: config.enableCodaTerminal ?? DEFAULT_ENABLE_CODA_TERMINAL,
  // Coda registration
  codaRegistered: config.codaRegistered ?? false,
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

// Get dev mode setting from config
export const getDevMode = (config: DocsPluginConfig) => config.devMode ?? DEFAULT_DEV_MODE;
export const getDevModeUserIds = (config: DocsPluginConfig) => config.devModeUserIds ?? DEFAULT_DEV_MODE_USER_IDS;

// Legacy exports for backward compatibility
export const RECOMMENDER_SERVICE_URL = DEFAULT_RECOMMENDER_SERVICE_URL;
export const DOCS_BASE_URL = DEFAULT_DOCS_BASE_URL;

export enum ROUTES {
  Context = '',
}
