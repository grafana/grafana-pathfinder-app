import pluginJson from './plugin.json';

export const PLUGIN_BASE_URL = `/a/${pluginJson.id}`;

// Recommender service configuration
export const RECOMMENDER_SERVICE_URL = 'http://localhost:8080';

// Docs service configuration - replace hardcoded grafana.com URLs
export const DOCS_BASE_URL = 'https://deploy-preview-website-26161-zb444pucvq-vp.a.run.app';
export const DOCS_USERNAME = ''; // Leave empty to skip authentication
export const DOCS_PASSWORD = ''; // Leave empty to skip authentication

export enum ROUTES {
  Context = '',
}