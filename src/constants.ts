import pluginJson from './plugin.json';

export const PLUGIN_BASE_URL = `/a/${pluginJson.id}`;

// Recommender service configuration
export const RECOMMENDER_SERVICE_URL = 'http://localhost:8080';

// Docs service configuration - replace hardcoded grafana.com URLs
export const DOCS_BASE_URL = 'https://grafana.com';
export const DOCS_USERNAME = '';
export const DOCS_PASSWORD = '';

export enum ROUTES {
  Context = '',
}