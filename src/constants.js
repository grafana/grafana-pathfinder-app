"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROUTES = exports.DOCS_BASE_URL = exports.RECOMMENDER_SERVICE_URL = exports.getDevModeUserIds = exports.getDevMode = exports.getTermsVersion = exports.getTermsAccepted = exports.getTutorialUrl = exports.getRecommenderServiceUrl = exports.isRecommenderEnabled = exports.getConfigWithDefaults = exports.DEFAULT_DEV_MODE_USER_IDS = exports.DEFAULT_DEV_MODE = exports.ALLOWED_GRAFANA_DOCS_HOSTNAMES = exports.ALLOWED_RECOMMENDER_DOMAINS = exports.ALLOWED_INTERACTIVE_LEARNING_HOSTNAMES = exports.DEFAULT_RECOMMENDER_TIMEOUT = exports.DEFAULT_CONTENT_FETCH_TIMEOUT = exports.DEFAULT_PEERJS_KEY = exports.DEFAULT_PEERJS_PORT = exports.DEFAULT_PEERJS_HOST = exports.DEFAULT_ENABLE_LIVE_SESSIONS = exports.DEFAULT_OPEN_PANEL_ON_LAUNCH = exports.DEFAULT_INTERCEPT_GLOBAL_DOCS_LINKS = exports.DEFAULT_GUIDED_STEP_TIMEOUT = exports.DEFAULT_REQUIREMENTS_CHECK_TIMEOUT = exports.DEFAULT_ENABLE_AUTO_DETECTION = exports.TERMS_VERSION = exports.DEFAULT_TUTORIAL_URL = exports.DEFAULT_TERMS_ACCEPTED = exports.DEFAULT_RECOMMENDER_SERVICE_URL = exports.DEFAULT_DOCS_BASE_URL = exports.PLUGIN_BASE_URL = void 0;
const plugin_json_1 = __importDefault(require("./plugin.json"));
const runtime_1 = require("@grafana/runtime");
exports.PLUGIN_BASE_URL = `/a/${plugin_json_1.default.id}`;
// Default configuration values
exports.DEFAULT_DOCS_BASE_URL = 'https://grafana.com';
exports.DEFAULT_RECOMMENDER_SERVICE_URL = 'https://recommender.grafana.com';
exports.DEFAULT_TERMS_ACCEPTED = false;
exports.DEFAULT_TUTORIAL_URL = '';
exports.TERMS_VERSION = '1.0.0';
// Interactive Features defaults
exports.DEFAULT_ENABLE_AUTO_DETECTION = false; // Opt-in feature
exports.DEFAULT_REQUIREMENTS_CHECK_TIMEOUT = 3000; // ms
exports.DEFAULT_GUIDED_STEP_TIMEOUT = 30000; // ms (30 seconds)
// Global Link Interception defaults
exports.DEFAULT_INTERCEPT_GLOBAL_DOCS_LINKS = false; // Experimental opt-in feature
// Open Panel on Launch defaults
// Note: This is overridden by feature toggle if set
exports.DEFAULT_OPEN_PANEL_ON_LAUNCH = false; // Experimental opt-in feature
// Live Sessions defaults
exports.DEFAULT_ENABLE_LIVE_SESSIONS = false; // Opt-in feature - disabled by default for stability
// PeerJS Server defaults (for live sessions)
exports.DEFAULT_PEERJS_HOST = 'localhost';
exports.DEFAULT_PEERJS_PORT = 9000;
exports.DEFAULT_PEERJS_KEY = 'pathfinder';
// Network timeout defaults
exports.DEFAULT_CONTENT_FETCH_TIMEOUT = 10000; // 10 seconds for document retrieval
exports.DEFAULT_RECOMMENDER_TIMEOUT = 5000; // 5 seconds for recommender API
// Security: Allowed interactive learning hostnames (exact match only, no wildcards)
// These are the only hostnames permitted for fetching interactive guides
exports.ALLOWED_INTERACTIVE_LEARNING_HOSTNAMES = [
    'interactive-learning.grafana-dev.net',
    'interactive-learning.grafana.net',
    'interactive-learning.grafana-ops.net',
];
// Security: Allowed recommender service domains
// Only these domains are permitted for the recommendation API to prevent MITM attacks
exports.ALLOWED_RECOMMENDER_DOMAINS = ['recommender.grafana.com', 'recommender.grafana-dev.com'];
// Security: Allowed Grafana documentation hostnames (exact match only, no wildcards)
// These are the only hostnames permitted for fetching documentation content
exports.ALLOWED_GRAFANA_DOCS_HOSTNAMES = ['grafana.com', 'docs.grafana.com', 'play.grafana.com'];
// Dev mode defaults
exports.DEFAULT_DEV_MODE = false;
exports.DEFAULT_DEV_MODE_USER_IDS = [];
// Helper functions to get configuration values with defaults
// Note: devModeUserIds remains as array (empty when dev mode is disabled)
const getConfigWithDefaults = (config) => ({
    recommenderServiceUrl: config.recommenderServiceUrl || exports.DEFAULT_RECOMMENDER_SERVICE_URL,
    tutorialUrl: config.tutorialUrl || exports.DEFAULT_TUTORIAL_URL,
    acceptedTermsAndConditions: config.acceptedTermsAndConditions ?? getPlatformSpecificDefault(),
    termsVersion: config.termsVersion || exports.TERMS_VERSION,
    // Dev mode - SECURITY: Hybrid approach (stored server-side, scoped per-user)
    devMode: config.devMode ?? exports.DEFAULT_DEV_MODE,
    devModeUserIds: config.devModeUserIds ?? exports.DEFAULT_DEV_MODE_USER_IDS,
    // Assistant dev mode
    enableAssistantDevMode: config.enableAssistantDevMode ?? false,
    // Interactive Features
    enableAutoDetection: config.enableAutoDetection ?? exports.DEFAULT_ENABLE_AUTO_DETECTION,
    requirementsCheckTimeout: config.requirementsCheckTimeout ?? exports.DEFAULT_REQUIREMENTS_CHECK_TIMEOUT,
    guidedStepTimeout: config.guidedStepTimeout ?? exports.DEFAULT_GUIDED_STEP_TIMEOUT,
    // Global Link Interception
    interceptGlobalDocsLinks: config.interceptGlobalDocsLinks ?? exports.DEFAULT_INTERCEPT_GLOBAL_DOCS_LINKS,
    // Open Panel on Launch
    openPanelOnLaunch: config.openPanelOnLaunch ?? exports.DEFAULT_OPEN_PANEL_ON_LAUNCH,
    // Live Sessions
    enableLiveSessions: config.enableLiveSessions ?? exports.DEFAULT_ENABLE_LIVE_SESSIONS,
    peerjsHost: config.peerjsHost || exports.DEFAULT_PEERJS_HOST,
    peerjsPort: config.peerjsPort ?? exports.DEFAULT_PEERJS_PORT,
    peerjsKey: config.peerjsKey || exports.DEFAULT_PEERJS_KEY,
});
exports.getConfigWithDefaults = getConfigWithDefaults;
/**
 * Get platform-specific default for recommender enabled state
 * Cloud: enabled by default (always online)
 * OSS: disabled by default (might be offline)
 */
const getPlatformSpecificDefault = () => {
    try {
        const isCloud = runtime_1.config.bootData.settings.buildInfo.versionString.startsWith('Grafana Cloud');
        return isCloud; // Cloud = true (enabled), OSS = false (disabled)
    }
    catch (error) {
        console.warn('Failed to detect platform, defaulting to disabled:', error);
        return false; // Conservative default
    }
};
const isRecommenderEnabled = (pluginConfig) => {
    return (0, exports.getConfigWithDefaults)(pluginConfig).acceptedTermsAndConditions;
};
exports.isRecommenderEnabled = isRecommenderEnabled;
// Legacy exports for backward compatibility - now require config parameter
const getRecommenderServiceUrl = (config) => (0, exports.getConfigWithDefaults)(config).recommenderServiceUrl;
exports.getRecommenderServiceUrl = getRecommenderServiceUrl;
const getTutorialUrl = (config) => (0, exports.getConfigWithDefaults)(config).tutorialUrl;
exports.getTutorialUrl = getTutorialUrl;
const getTermsAccepted = (config) => (0, exports.getConfigWithDefaults)(config).acceptedTermsAndConditions;
exports.getTermsAccepted = getTermsAccepted;
const getTermsVersion = (config) => (0, exports.getConfigWithDefaults)(config).termsVersion;
exports.getTermsVersion = getTermsVersion;
// Get dev mode setting from config
const getDevMode = (config) => config.devMode ?? exports.DEFAULT_DEV_MODE;
exports.getDevMode = getDevMode;
const getDevModeUserIds = (config) => config.devModeUserIds ?? exports.DEFAULT_DEV_MODE_USER_IDS;
exports.getDevModeUserIds = getDevModeUserIds;
// Legacy exports for backward compatibility
exports.RECOMMENDER_SERVICE_URL = exports.DEFAULT_RECOMMENDER_SERVICE_URL;
exports.DOCS_BASE_URL = exports.DEFAULT_DOCS_BASE_URL;
var ROUTES;
(function (ROUTES) {
    ROUTES["Context"] = "";
})(ROUTES || (exports.ROUTES = ROUTES = {}));
