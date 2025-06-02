import pluginJson from './plugin.json';

export const PLUGIN_BASE_URL = `/a/${pluginJson.id}`;

// Recommender service configuration
export const RECOMMENDER_SERVICE_URL = 'http://localhost:8080';

export enum ROUTES {
  Context = '',
}

export const QUICK_LINKS = [
  {
    title: '📊 Grafana Dashboard Guide',
    url: 'https://grafana.com/docs/grafana/latest/dashboards/',
  },
  {
    title: '🔍 Explore Data Sources',
    url: 'https://grafana.com/docs/grafana/latest/explore/',
  },
  {
    title: '🚨 Alerting Setup',
    url: 'https://grafana.com/docs/grafana/latest/alerting/',
  },
  {
    title: '🔧 Administration Guide',
    url: 'https://grafana.com/docs/grafana/latest/administration/',
  },
] as const;