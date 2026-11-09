import { catalogSearchTopic, publicCatalogTopics, reportCatalogInteraction } from './catalog-analytics';
import { reportAppInteraction, UserInteraction } from './analytics';

jest.mock('./analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: { CatalogInteraction: 'catalog_interaction' },
}));

it.each(['customer-secret', 'alice@example.com', 'dashboards-private'])('redacts custom topic %s', (topic) => {
  reportCatalogInteraction({ action: 'topic', topic, control: 'filter' });
  expect(reportAppInteraction).toHaveBeenLastCalledWith(UserInteraction.CatalogInteraction, {
    interaction_location: 'package_browser',
    action: 'topic',
    topic: 'other',
    control: 'filter',
  });
});

it.each([
  'all',
  'dashboards',
  'data-sources',
  'alerting',
  'metrics',
  'logs',
  'k6',
  'getting-started',
  'uncategorized',
  'traces',
  'kubernetes',
  'authoring',
  'querying',
  'reference',
  'testing',
])('reports allowlisted topic %s', (topic) => {
  reportCatalogInteraction({ action: 'topic', topic, control: 'filter' });
  expect(reportAppInteraction).toHaveBeenLastCalledWith(UserInteraction.CatalogInteraction, {
    interaction_location: 'package_browser',
    action: 'topic',
    topic: topic.replace(/-/g, '_'),
    control: 'filter',
  });
});

const catalogItems = [
  { id: 'play-intro', title: 'Play intro', category: 'play-demos', source: 'grafana' },
  { id: 'cost-guide', title: 'Usage', category: 'Cost and usage', source: 'grafana' },
  { id: 'internal', title: 'Internal runbook', category: 'customer-secret', source: 'organization' },
] as const;

it.each(['play-demos', 'cost-and-usage'])('reports public catalog topic %s', (topic) => {
  reportCatalogInteraction({
    action: 'topic',
    topic,
    control: 'filter',
    publicTopics: publicCatalogTopics(catalogItems),
  });
  expect(reportAppInteraction).toHaveBeenLastCalledWith(UserInteraction.CatalogInteraction, {
    interaction_location: 'package_browser',
    action: 'topic',
    topic,
    control: 'filter',
  });
});

it('keeps organization-only topics bucketed', () => {
  expect(publicCatalogTopics(catalogItems).has('customer-secret')).toBe(false);
  reportCatalogInteraction({
    action: 'topic',
    topic: 'customer-secret',
    control: 'filter',
    publicTopics: publicCatalogTopics(catalogItems),
  });
  expect(reportAppInteraction).toHaveBeenLastCalledWith(UserInteraction.CatalogInteraction, {
    interaction_location: 'package_browser',
    action: 'topic',
    topic: 'other',
    control: 'filter',
  });
});

it.each([
  ['dashboard', 'dashboards'],
  [' DATA_SOURCES ', 'data-sources'],
  ['PromQL', 'metrics'],
  ['LogQL', 'logs'],
  ['Tempo', 'traces'],
  ['continuous profiling', 'profiles'],
  ['alertmanager', 'alerting'],
  ['load testing', 'k6'],
  ['Beyla', 'application-observability'],
  ['RUM', 'frontend-observability'],
  ['synthetic-monitoring', 'synthetic-monitoring'],
  ['K8s', 'kubernetes'],
  ['host monitoring', 'infrastructure-monitoring'],
  ['AWS', 'cloud-provider-observability'],
  ['PostgreSQL', 'database-observability'],
  ['on-call', 'irm'],
  ['error budget', 'slo'],
  ['Grafana Alloy', 'alloy'],
  ['OTel', 'opentelemetry'],
  ['fleet management', 'fleet-management'],
  ['adaptive metrics', 'adaptive-metrics'],
  ['adaptive logs', 'adaptive-logs'],
  ['adaptive traces', 'adaptive-traces'],
  ['adaptive telemetry', 'adaptive-telemetry'],
  ['Grafana Assistant', 'assistant'],
  ['root cause analysis', 'investigations'],
  ['knowledge graph', 'knowledge-graph'],
  ['agent observability', 'agent-observability'],
  ['billing', 'cost-management'],
  ['terraform', 'observability-as-code'],
  ['RBAC', 'administration'],
  ['workflows', 'workflows'],
  ['onboarding', 'getting-started'],
])('reports only a fixed search topic for %s', (query, topic) => {
  expect(catalogSearchTopic(query)).toBe(topic);
  reportCatalogInteraction({ action: 'search', topic: catalogSearchTopic(query) });
  expect(reportAppInteraction).toHaveBeenLastCalledWith(UserInteraction.CatalogInteraction, {
    interaction_location: 'package_browser',
    action: 'search',
    search_topic: topic.replace(/-/g, '_'),
  });
});

it.each([
  'alice@example.com',
  'dashboard@customer.com',
  'customer-dashboard',
  'dashboard for Alice',
  'https://customer.example/metrics',
  'eyJhbGciOiJIUzI1NiJ9',
  'tempo secret123',
  'dashboard\u200b',
  '123456789',
  '__proto__',
  'constructor',
  'toString',
  '',
])('does not extract or forward arbitrary search text: %s', (query) => {
  expect(catalogSearchTopic(query)).toBe('other');
  reportCatalogInteraction({ action: 'search', topic: query });
  expect(reportAppInteraction).toHaveBeenLastCalledWith(UserInteraction.CatalogInteraction, {
    interaction_location: 'package_browser',
    action: 'search',
    search_topic: 'other',
  });
});
