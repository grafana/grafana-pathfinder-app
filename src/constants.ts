import pluginJson from './plugin.json';

export const PLUGIN_BASE_URL = `/a/${pluginJson.id}`;

// Default configuration values
export const DEFAULT_RECOMMENDER_SERVICE_URL = 'https://grafana-recommender-93209135917.us-central1.run.app';
export const DEFAULT_DOCS_BASE_URL = 'https://grafana.com';
export const DEFAULT_DOCS_USERNAME = '';
export const DEFAULT_DOCS_PASSWORD = '';
export const DEFAULT_TUTORIAL_URL = '';
export const DEFAULT_TERMS_ACCEPTED = false;
export const TERMS_VERSION = '1.0.0';

// Configuration interface
export interface DocsPluginConfig {
  recommenderServiceUrl?: string;
  docsBaseUrl?: string;
  docsUsername?: string;
  docsPassword?: string;
  tutorialUrl?: string;
  // Terms and Conditions
  acceptedTermsAndConditions?: boolean;
  termsVersion?: string;
}

// Helper functions to get configuration values with defaults
export const getConfigWithDefaults = (config: DocsPluginConfig): Required<DocsPluginConfig> => ({
  recommenderServiceUrl: config.recommenderServiceUrl || DEFAULT_RECOMMENDER_SERVICE_URL,
  docsBaseUrl: config.docsBaseUrl || DEFAULT_DOCS_BASE_URL,
  docsUsername: config.docsUsername || DEFAULT_DOCS_USERNAME,
  docsPassword: config.docsPassword || DEFAULT_DOCS_PASSWORD,
  tutorialUrl: config.tutorialUrl || DEFAULT_TUTORIAL_URL,
  acceptedTermsAndConditions: config.acceptedTermsAndConditions ?? DEFAULT_TERMS_ACCEPTED,
  termsVersion: config.termsVersion || TERMS_VERSION,
});

export const isRecommenderEnabled = (config: DocsPluginConfig): boolean => {
  return Boolean(config.acceptedTermsAndConditions);
};

// Legacy exports for backward compatibility - now require config parameter
export const getRecommenderServiceUrl = (config: DocsPluginConfig) => getConfigWithDefaults(config).recommenderServiceUrl;
export const getDocsBaseUrl = (config: DocsPluginConfig) => getConfigWithDefaults(config).docsBaseUrl;
export const getDocsUsername = (config: DocsPluginConfig) => getConfigWithDefaults(config).docsUsername;
export const getDocsPassword = (config: DocsPluginConfig) => getConfigWithDefaults(config).docsPassword;
export const getTutorialUrl = (config: DocsPluginConfig) => getConfigWithDefaults(config).tutorialUrl;
export const getTermsAccepted = (config: DocsPluginConfig) => getConfigWithDefaults(config).acceptedTermsAndConditions;
export const getTermsVersion = (config: DocsPluginConfig) => getConfigWithDefaults(config).termsVersion;

// Legacy exports for backward compatibility
export const RECOMMENDER_SERVICE_URL = DEFAULT_RECOMMENDER_SERVICE_URL;
export const DOCS_BASE_URL = DEFAULT_DOCS_BASE_URL;
export const DOCS_USERNAME = DEFAULT_DOCS_USERNAME;
export const DOCS_PASSWORD = DEFAULT_DOCS_PASSWORD;

export enum ROUTES {
  Context = '',
}
