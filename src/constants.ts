import pluginJson from './plugin.json';
import { config } from '@grafana/runtime';

export const PLUGIN_BASE_URL = `/a/${pluginJson.id}`;

// Backend API URL for plugin resource endpoints
// Grafana routes backend resource calls through /api/plugins/{pluginId}/resources/
export const PLUGIN_BACKEND_URL = `/api/plugins/${pluginJson.id}/resources`;

// Default configuration values
export const DEFAULT_DOCS_BASE_URL = 'https://grafana.com';

const RECOMMENDER_PROD_URL = 'https://recommender.grafana.com';
const RECOMMENDER_DEV_URL = 'https://recommender.grafana-dev.com';
const KNOWN_RECOMMENDER_URLS = new Set([RECOMMENDER_PROD_URL, RECOMMENDER_DEV_URL]);

/**
 * Derive the correct recommender URL from the Grafana instance hostname.
 * Instances on *.grafana-dev.net use the dev recommender; everything else uses prod.
 */
export function getDefaultRecommenderUrl(hostnameOverride?: string): string {
  try {
    const hostname = hostnameOverride ?? window.location.hostname;
    if (hostname.endsWith('.grafana-dev.net')) {
      return RECOMMENDER_DEV_URL;
    }
  } catch {
    // SSR / test environments where window is unavailable
  }
  return RECOMMENDER_PROD_URL;
}

/**
 * True when the saved URL is one of the two managed recommender endpoints.
 * Auto-detection should own these; only genuinely custom URLs (e.g. localhost)
 * should bypass environment-based selection.
 */
export function isKnownRecommenderUrl(url: string): boolean {
  return KNOWN_RECOMMENDER_URLS.has(url.replace(/\/+$/, ''));
}

export const DEFAULT_RECOMMENDER_SERVICE_URL = RECOMMENDER_PROD_URL;
export const DEFAULT_TERMS_ACCEPTED = false;
export const DEFAULT_TUTORIAL_URL = '';
export const TERMS_VERSION = '1.1.0';

// Interactive Features defaults
export const DEFAULT_ENABLE_AUTO_DETECTION = true; // Enabled by default
export const DEFAULT_REQUIREMENTS_CHECK_TIMEOUT = 3000; // ms
export const DEFAULT_GUIDED_STEP_TIMEOUT = 30000; // ms (30 seconds)
export const DEFAULT_DISABLE_AUTO_COLLAPSE = false; // Auto-collapse enabled by default

// Global Link Interception defaults
export const DEFAULT_INTERCEPT_GLOBAL_DOCS_LINKS = false; // Experimental opt-in feature

// Open Panel on Launch defaults
// Note: This is overridden by feature toggle if set
export const DEFAULT_OPEN_PANEL_ON_LAUNCH = false; // Experimental opt-in feature

// Live Sessions defaults
export const DEFAULT_ENABLE_LIVE_SESSIONS = false; // Opt-in feature - disabled by default for stability

// Coda Terminal defaults (experimental dev feature)
export const DEFAULT_ENABLE_CODA_TERMINAL = false;

// Kiosk Mode defaults (dev feature for presenting guide catalogs)
export const DEFAULT_ENABLE_KIOSK_MODE = false;
export const DEFAULT_KIOSK_RULES_URL = '';

// AI auto-heal: default OFF — the AI write path requires explicit admin opt-in
export const DEFAULT_ENABLE_AI_AUTO_HEAL = false;

// Two-tab controller: default OFF — the live-tab executor drives the user's
// authenticated Grafana DOM, so it requires explicit admin opt-in
export const DEFAULT_ENABLE_TWO_TAB_CONTROLLER = false;

// PeerJS Server defaults (for live sessions)
export const DEFAULT_PEERJS_HOST = 'localhost';
export const DEFAULT_PEERJS_PORT = 9000;
export const DEFAULT_PEERJS_KEY = 'pathfinder';
export const DEFAULT_PEERJS_SECURE = false;

// Network timeout defaults
export const DEFAULT_CONTENT_FETCH_TIMEOUT = 10000; // 10 seconds for document retrieval
export const DEFAULT_RECOMMENDER_TIMEOUT = 5000; // 5 seconds for recommender API
export const ONLINE_PACKAGES_BOOT_BUDGET_MS = 3000; // max wait before rendering recommendations without the online package index

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
export const DEFAULT_DEV_MODE_OPT_IN = false;

// ============================================================================
// CONFIGURATION SHAPE AND OWNERSHIP
//
// Three stores own disjoint slices of what used to be one plugin-jsonData blob:
//
//   1. PathfinderSettings (App Platform, tenant-scoped, admin-write) — every
//      field in TENANT_SETTING_KEYS below. See utils/pathfinder-settings-api.ts.
//   2. Grafana per-user storage — `devModeOptIn`. Per-user state must never sit
//      in a tenant-scoped store; the old `devModeUserIds` array was a per-user
//      list kept in an org-wide blob for want of anywhere better.
//   3. Plugin jsonData — provisioning only (`stackId`, and
//      `secureJsonData.accessToken`), plus the legacy copy of slice 1 that is
//      still read as a fallback wherever App Platform is unavailable (OSS,
//      self-managed, local dev).
//
// Why the split: Grafana's plugin-settings write replaces jsonData wholesale,
// and Cloud provisioning targets the same record, so a user-editable value kept
// there is lost on the next instance restart.
// ============================================================================

/**
 * Tenant-owned settings — the `PathfinderSettings` App Platform kind. Field
 * names and defaults are in lockstep with kinds/pathfindersettings.cue in
 * grafana-pathfinder-backend.
 */
export interface PathfinderTenantSettings {
  recommenderServiceUrl: string;
  tutorialUrl: string;
  // Terms and Conditions
  acceptedTermsAndConditions: boolean;
  termsVersion: string;
  // Interactive Features
  enableAutoDetection: boolean;
  requirementsCheckTimeout: number;
  guidedStepTimeout: number;
  disableAutoCollapse: boolean;
  // Global Link Interception
  interceptGlobalDocsLinks: boolean;
  // Open Panel on Launch
  openPanelOnLaunch: boolean;
  // Live Sessions (Collaborative Learning)
  enableLiveSessions: boolean;
  peerjsHost: string;
  peerjsPort: number;
  peerjsKey: string;
  peerjsSecure: boolean;
  // Coda terminal UI. The VM backend and its credentials live in the separate
  // grafana-coda-app plugin, which owns its own settings.
  enableCodaTerminal: boolean;
  // AI auto-heal
  enableAiAutoHeal: boolean;
  // Two-tab interactive controller (admin opt-in; drives the authenticated DOM)
  enableTwoTabController: boolean;
  // Dev-only surfaces. `devMode` is the instance gate an admin controls; a user
  // sees dev features only when it is true AND that user opted in (see
  // `devModeOptIn`). Stored as `devModeEnabled` in the kind.
  devMode: boolean;
  // Assistant Dev Mode - for testing assistant integration in OSS environments
  enableAssistantDevMode: boolean;
  // Kiosk Mode (dev feature for presenting guide catalogs)
  enableKioskMode: boolean;
  kioskRulesUrl: string;
}

/**
 * Every tenant-owned key, in one place so the settings client and the jsonData
 * fallback cannot drift from `PathfinderTenantSettings`. The satisfies clause
 * makes a missing key a compile error.
 */
export const TENANT_SETTING_KEYS = [
  'recommenderServiceUrl',
  'tutorialUrl',
  'acceptedTermsAndConditions',
  'termsVersion',
  'enableAutoDetection',
  'requirementsCheckTimeout',
  'guidedStepTimeout',
  'disableAutoCollapse',
  'interceptGlobalDocsLinks',
  'openPanelOnLaunch',
  'enableLiveSessions',
  'peerjsHost',
  'peerjsPort',
  'peerjsKey',
  'peerjsSecure',
  'enableCodaTerminal',
  'enableAiAutoHeal',
  'enableTwoTabController',
  'devMode',
  'enableAssistantDevMode',
  'enableKioskMode',
  'kioskRulesUrl',
] as const satisfies ReadonlyArray<keyof PathfinderTenantSettings>;

/** Per-user settings, resolved from Grafana per-user storage. */
export interface PathfinderUserSettings {
  /**
   * Whether THIS user has opted into developer surfaces. Gated by the
   * tenant-level `devMode`; both must be true. Replaces the old
   * `devModeUserIds` array.
   */
  devModeOptIn: boolean;
}

/**
 * The resolved plugin configuration every consumer reads. Also the shape of the
 * legacy jsonData blob, which is why every field stays optional: a jsonData
 * record predating this split has none of them, and a stack with no
 * PathfinderSettings resource yet has none either.
 */
export interface PathfinderPluginConfig extends Partial<PathfinderTenantSettings>, Partial<PathfinderUserSettings> {
  /**
   * Per-user dev-mode allow-list.
   *
   * @deprecated Superseded by `devModeOptIn` in per-user storage. Still read so
   * a stack that has not yet written new-style settings keeps working; never
   * written. Do not add new readers.
   */
  devModeUserIds?: number[];
  /**
   * Grafana Cloud stack identifier, provisioned into plugin jsonData by
   * stack-state-service. Never written by this plugin — it is the field whose
   * accidental erasure motivated moving settings out of jsonData.
   */
  stackId?: string;
}

/** Fully-resolved configuration: every tenant and per-user field present. */
export type ResolvedPathfinderConfig = PathfinderTenantSettings & PathfinderUserSettings;

// Helper functions to get configuration values with defaults.
// `devModeUserIds` and `stackId` are deliberately absent from the result: the
// first is legacy-read-only (folded into devModeOptIn by the resolve layer), and
// the second is provisioning's, not ours.
export const getConfigWithDefaults = (config: PathfinderPluginConfig): ResolvedPathfinderConfig => ({
  recommenderServiceUrl:
    config.recommenderServiceUrl && !isKnownRecommenderUrl(config.recommenderServiceUrl)
      ? config.recommenderServiceUrl
      : getDefaultRecommenderUrl(),
  tutorialUrl: config.tutorialUrl || DEFAULT_TUTORIAL_URL,
  acceptedTermsAndConditions: config.acceptedTermsAndConditions ?? getPlatformSpecificDefault(),
  termsVersion: config.termsVersion || TERMS_VERSION,
  // Dev mode: `devMode` is the tenant-level gate, `devModeOptIn` is this user's
  // opt-in from per-user storage. Both must be true for dev surfaces to show.
  devMode: config.devMode ?? DEFAULT_DEV_MODE,
  devModeOptIn: config.devModeOptIn ?? DEFAULT_DEV_MODE_OPT_IN,
  // Assistant dev mode
  enableAssistantDevMode: config.enableAssistantDevMode ?? false,
  // Interactive Features
  enableAutoDetection: config.enableAutoDetection ?? DEFAULT_ENABLE_AUTO_DETECTION,
  requirementsCheckTimeout: config.requirementsCheckTimeout ?? DEFAULT_REQUIREMENTS_CHECK_TIMEOUT,
  guidedStepTimeout: config.guidedStepTimeout ?? DEFAULT_GUIDED_STEP_TIMEOUT,
  disableAutoCollapse: config.disableAutoCollapse ?? DEFAULT_DISABLE_AUTO_COLLAPSE,
  // Global Link Interception
  interceptGlobalDocsLinks: config.interceptGlobalDocsLinks ?? DEFAULT_INTERCEPT_GLOBAL_DOCS_LINKS,
  // Open Panel on Launch
  openPanelOnLaunch: config.openPanelOnLaunch ?? DEFAULT_OPEN_PANEL_ON_LAUNCH,
  // Live Sessions
  enableLiveSessions: config.enableLiveSessions ?? DEFAULT_ENABLE_LIVE_SESSIONS,
  peerjsHost: config.peerjsHost || DEFAULT_PEERJS_HOST,
  peerjsPort: config.peerjsPort ?? DEFAULT_PEERJS_PORT,
  peerjsKey: config.peerjsKey || DEFAULT_PEERJS_KEY,
  peerjsSecure: config.peerjsSecure ?? DEFAULT_PEERJS_SECURE,
  // Coda Terminal
  enableCodaTerminal: config.enableCodaTerminal ?? DEFAULT_ENABLE_CODA_TERMINAL,
  // Kiosk Mode
  enableKioskMode: config.enableKioskMode ?? DEFAULT_ENABLE_KIOSK_MODE,
  kioskRulesUrl: config.kioskRulesUrl ?? DEFAULT_KIOSK_RULES_URL,
  // AI auto-heal
  enableAiAutoHeal: config.enableAiAutoHeal ?? DEFAULT_ENABLE_AI_AUTO_HEAL,
  // Two-tab interactive controller
  enableTwoTabController: config.enableTwoTabController ?? DEFAULT_ENABLE_TWO_TAB_CONTROLLER,
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
    // eslint-disable-next-line no-console -- tier 0 cannot import lib/logging (it's in the logger's own import chain)
    console.warn('Failed to detect platform, defaulting to disabled:', error);
    return false; // Conservative default
  }
};

export const isRecommenderEnabled = (pluginConfig: PathfinderPluginConfig): boolean => {
  return getConfigWithDefaults(pluginConfig).acceptedTermsAndConditions;
};

// Legacy exports for backward compatibility - now require config parameter
export const getRecommenderServiceUrl = (config: PathfinderPluginConfig) =>
  getConfigWithDefaults(config).recommenderServiceUrl;
export const getTutorialUrl = (config: PathfinderPluginConfig) => getConfigWithDefaults(config).tutorialUrl;
export const getTermsAccepted = (config: PathfinderPluginConfig) =>
  getConfigWithDefaults(config).acceptedTermsAndConditions;
export const getTermsVersion = (config: PathfinderPluginConfig) => getConfigWithDefaults(config).termsVersion;

// Get dev mode setting from config
export const getDevMode = (config: PathfinderPluginConfig) => config.devMode ?? DEFAULT_DEV_MODE;

// Legacy exports for backward compatibility
export const RECOMMENDER_SERVICE_URL = DEFAULT_RECOMMENDER_SERVICE_URL;
export const DOCS_BASE_URL = DEFAULT_DOCS_BASE_URL;

export enum ROUTES {
  Home = '',
  Context = 'context',
  FullScreen = 'fullscreen',
}
