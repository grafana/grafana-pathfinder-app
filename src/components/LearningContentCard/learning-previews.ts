import linux from '../../img/learning-previews/linux-node-overview.png';
import alloyLogs from '../../img/learning-previews/logs-drilldown.png';
import logsDashboard from '../../img/learning-previews/visualization-logs.png';
import logs from '../../img/learning-previews/drilldown-logs.png';
import metrics from '../../img/learning-previews/drilldown-metrics.png';
import traces from '../../img/learning-previews/drilldown-traces.png';
import profiles from '../../img/learning-previews/drilldown-profiles.png';
import metricsDashboard from '../../img/learning-previews/visualization-metrics.png';
import alerting from '../../img/learning-previews/infrastructure-alerting.png';

export interface LearningPreview {
  src: string;
  alt: string;
  source: string;
}

const previews: Record<string, LearningPreview> = {
  'linux-server-integration': {
    src: linux,
    alt: 'Linux node overview dashboard',
    source: 'https://grafana.com/docs/learning-paths/linux-server-integration/understand-dashboards/',
  },
  'send-logs-alloy-loki': {
    src: alloyLogs,
    alt: 'Logs Drilldown showing collected log files',
    source: 'https://grafana.com/docs/learning-paths/send-logs-alloy-loki/view-logs/',
  },
  'visualization-logs': {
    src: logsDashboard,
    alt: 'Logs dashboard visualizing HTTP status codes over time',
    source: 'https://grafana.com/docs/learning-paths/visualization-logs/',
  },
  'drilldown-logs': {
    src: logs,
    alt: 'Logs Drilldown with log volume charts and log entries',
    source: 'https://grafana.com/docs/learning-paths/drilldown-logs/',
  },
  'drilldown-metrics': {
    src: metrics,
    alt: 'Metrics Drilldown displaying related metric visualizations',
    source: 'https://grafana.com/docs/learning-paths/drilldown-metrics/',
  },
  'drilldown-traces': {
    src: traces,
    alt: 'Traces Drilldown displaying request durations and traces',
    source: 'https://grafana.com/docs/learning-paths/drilldown-traces/',
  },
  'drilldown-profiles': {
    src: profiles,
    alt: 'Flame graph showing time spent in application functions',
    source: 'https://grafana.com/docs/pyroscope/latest/introduction/flamegraphs/',
  },
  'visualization-metrics': {
    src: metricsDashboard,
    alt: 'Grafana time series visualization of a metric',
    source: 'https://grafana.com/docs/learning-paths/visualization-metrics/',
  },
  'infrastructure-alerting': {
    src: alerting,
    alt: 'Grafana alert rule query and condition configuration',
    source: 'https://grafana.com/docs/learning-paths/infrastructure-alerting/',
  },
};

export function getLearningPreview(id: string): LearningPreview | undefined {
  const key = id.replace(/-lj$/, '');
  return Object.hasOwn(previews, key) ? previews[key] : undefined;
}
