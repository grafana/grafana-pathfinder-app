import { reportAppInteraction, UserInteraction } from './analytics';
import { catalogTopic } from './catalog-discovery';
import type { CatalogPackage } from '../types/package-catalog.types';

type CatalogInteraction =
  | { action: 'tab_click' }
  | { action: 'search'; topic: string }
  | { action: 'topic'; topic: string; control: 'shortcut' | 'filter'; publicTopics?: ReadonlySet<string> }
  | { action: 'view'; view: 'explore' | 'all'; previousView: 'explore' | 'all' }
  | {
      action: 'source';
      source: 'all' | 'grafana' | 'organization';
      previousSource: 'all' | 'grafana' | 'organization';
    };

const SEARCH_TOPICS = {
  dashboards: ['dashboard', 'dashboards', 'visualization', 'visualizations'],
  'data-sources': [
    'data source',
    'data sources',
    'datasource',
    'datasources',
    'connections',
    'pdc',
    'private data source connect',
  ],
  metrics: ['metric', 'metrics', 'prometheus', 'promql', 'mimir', 'graphite'],
  logs: ['log', 'logs', 'loki', 'logql'],
  traces: ['trace', 'traces', 'tracing', 'distributed tracing', 'tempo', 'traceql'],
  profiles: ['profile', 'profiles', 'profiling', 'continuous profiling', 'pyroscope'],
  alerting: ['alert', 'alerts', 'alerting', 'alertmanager'],
  k6: ['k6', 'load testing', 'performance testing', 'stress testing', 'spike testing', 'soak testing'],
  'application-observability': ['application observability', 'app observability', 'apm', 'beyla'],
  'frontend-observability': ['frontend observability', 'faro', 'rum', 'real user monitoring'],
  'synthetic-monitoring': ['synthetic monitoring', 'synthetics', 'synthetic checks', 'uptime monitoring'],
  kubernetes: ['kubernetes', 'k8s', 'kubernetes monitoring'],
  'infrastructure-monitoring': ['infrastructure monitoring', 'host monitoring', 'linux', 'windows', 'macos'],
  'cloud-provider-observability': ['cloud provider observability', 'aws', 'azure', 'gcp', 'cloudwatch'],
  'database-observability': [
    'database observability',
    'database monitoring',
    'mysql',
    'postgresql',
    'postgres',
    'mongodb',
    'redis',
  ],
  irm: ['irm', 'incident response', 'incident management', 'incident response management', 'oncall', 'on call'],
  slo: ['slo', 'slos', 'sli', 'slis', 'service level objectives', 'service level objective', 'error budget'],
  alloy: ['alloy', 'grafana alloy'],
  opentelemetry: ['opentelemetry', 'open telemetry', 'otel', 'otel collector', 'opentelemetry collector'],
  'fleet-management': ['fleet management', 'collector fleet'],
  'adaptive-metrics': ['adaptive metrics'],
  'adaptive-logs': ['adaptive logs'],
  'adaptive-traces': ['adaptive traces'],
  'adaptive-telemetry': ['adaptive telemetry'],
  assistant: ['assistant', 'grafana assistant'],
  investigations: ['investigations', 'sift', 'root cause analysis', 'rca'],
  'knowledge-graph': ['knowledge graph'],
  'agent-observability': ['agent observability', 'ai observability', 'llm observability'],
  'cost-management': ['cost management', 'billing', 'usage', 'cost optimization', 'cardinality'],
  'observability-as-code': ['observability as code', 'terraform', 'git sync', 'foundation sdk'],
  administration: ['administration', 'rbac', 'access policies', 'service accounts', 'sso', 'authentication'],
  workflows: ['workflows', 'grafana workflows'],
  'getting-started': ['getting started', 'onboarding'],
} as const;

const TOPICS = new Set<string>([
  'all',
  'uncategorized',
  'authoring',
  'querying',
  'reference',
  'testing',
  ...Object.keys(SEARCH_TOPICS),
]);

const SEARCH_ALIASES = new Map<string, string>(
  Object.entries(SEARCH_TOPICS).flatMap(([topic, aliases]) => aliases.map((alias) => [alias, topic] as const))
);

export function catalogSearchTopic(query: string): string {
  const keyword = query
    .trim()
    .toLowerCase()
    .replace(/[-_\s]+/g, ' ');
  return SEARCH_ALIASES.get(keyword) ?? 'other';
}

/**
 * Topics derived from official Grafana packages. Their categories are public, so
 * they can be reported as-is; organization categories are customer-authored and
 * stay bucketed as 'other' unless they're on the fixed list.
 */
export function publicCatalogTopics(
  items: ReadonlyArray<Pick<CatalogPackage, 'id' | 'title' | 'category' | 'source'>>
): ReadonlySet<string> {
  return new Set(items.filter((item) => item.source === 'grafana').map(catalogTopic));
}

function reportableTopic(topic: string, publicTopics: ReadonlySet<string> | undefined): string {
  return TOPICS.has(topic) || publicTopics?.has(topic) ? topic : 'other';
}

export function reportCatalogInteraction(interaction: CatalogInteraction): void {
  reportAppInteraction(UserInteraction.CatalogInteraction, {
    interaction_location: 'package_browser',
    action: interaction.action,
    ...(interaction.action === 'search' && {
      search_topic: Object.hasOwn(SEARCH_TOPICS, interaction.topic) ? interaction.topic : 'other',
    }),
    ...(interaction.action === 'topic' && {
      topic: reportableTopic(interaction.topic, interaction.publicTopics),
      control: interaction.control,
    }),
    ...(interaction.action === 'view' && { view: interaction.view, previous_view: interaction.previousView }),
    ...(interaction.action === 'source' && {
      content_source: interaction.source,
      previous_content_source: interaction.previousSource,
    }),
  });
}
