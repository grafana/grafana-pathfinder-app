import pluginJson from './plugin.json';

export const PLUGIN_BASE_URL = `/a/${pluginJson.id}`;

// Recommender service configuration
export const RECOMMENDER_SERVICE_URL = 'http://localhost:8080';

export enum ROUTES {
  Context = '',
}