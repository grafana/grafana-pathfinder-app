import pluginJson from './plugin.json';

export const PLUGIN_BASE_URL = `/a/${pluginJson.id}`;

export enum ROUTES {
  Documentation = '',
}

export const QUICK_LINKS = [
  {
    title: '📚 Grafana Scenes Documentation',
    url: 'https://grafana.com/developers/scenes',
  },
  {
    title: '🔧 Plugin Development Tools',
    url: 'https://grafana.com/developers/plugin-tools',
  },
  {
    title: '📖 Plugin Development Guide',
    url: 'https://grafana.com/docs/grafana/latest/developers/plugins/',
  },
] as const;