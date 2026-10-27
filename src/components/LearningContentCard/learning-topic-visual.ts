import type { GrafanaTheme2, IconName } from '@grafana/data';
import { t } from '@grafana/i18n';

export function getLearningTopicMetadata(topic: string | undefined, kind: 'guide' | 'path' | 'docs' = 'guide') {
  const normalized = topic
    ?.trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  let icon: IconName = kind === 'path' ? 'book-open' : kind === 'docs' ? 'file-alt' : 'compass';
  let label: string | undefined;
  let darkColor: string | undefined;
  let lightColor: string | undefined;
  switch (normalized) {
    case undefined:
      break;
    case 'dashboard':
    case 'dashboards':
    case 'visualization':
    case 'visualizations':
      icon = 'dashboard';
      label = t('learningTopic.dashboards', 'Dashboards');
      darkColor = '#6e9fff';
      lightColor = '#1f62c0';
      break;
    case 'datasource':
    case 'datasources':
    case 'data-source':
    case 'data-sources':
    case 'connections':
      icon = 'database';
      label = t('learningTopic.dataSources', 'Data sources');
      darkColor = '#66c9ce';
      lightColor = '#087b82';
      break;
    case 'alert':
    case 'alerts':
    case 'alerting':
      icon = 'bell';
      label = t('learningTopic.alerting', 'Alerting');
      darkColor = '#ffb366';
      lightColor = '#a85806';
      break;
    case 'metric':
    case 'metrics':
      icon = 'graph-bar';
      label = t('learningTopic.metrics', 'Metrics');
      darkColor = '#b380e0';
      lightColor = '#772bc2';
      break;
    case 'logs':
    case 'loki':
      icon = 'list-ul';
      label = t('learningTopic.logs', 'Logs');
      darkColor = '#6ccf8e';
      lightColor = '#247844';
      break;
    case 'k6':
    case 'load-testing':
    case 'performance-testing':
      icon = 'bolt';
      label = t('learningTopic.performance', 'Performance testing');
      darkColor = '#fb77ab';
      lightColor = '#b52b66';
      break;
    case 'getting-started':
    case 'onboarding':
      icon = 'compass';
      label = t('learningTopic.gettingStarted', 'Getting started');
      darkColor = '#ffb366';
      lightColor = '#a85806';
      break;
  }
  return { icon, label, darkColor, lightColor };
}

export function getLearningTopicVisual(
  topic: string | undefined,
  theme: GrafanaTheme2,
  kind: 'guide' | 'path' | 'docs' = 'guide'
) {
  const { icon, label, darkColor, lightColor } = getLearningTopicMetadata(topic, kind);
  const color = (theme.isDark ? darkColor : lightColor) ?? theme.colors.info.text;
  return {
    icon,
    color,
    label,
    background: label ? `${color}20` : theme.colors.info.background,
    border: label ? `${color}38` : theme.colors.info.border,
  };
}
