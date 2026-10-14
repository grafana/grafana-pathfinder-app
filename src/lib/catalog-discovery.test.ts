import { catalogStarters, catalogTopic, catalogTopicCounts, catalogTopicShortcuts } from './catalog-discovery';
import type { CatalogPackage } from '../types/package-catalog.types';

function item(id: string, patch: Partial<CatalogPackage> = {}): CatalogPackage {
  return { key: `bundled:${id}`, id, title: id, format: 'guide', source: 'grafana', url: `bundled:${id}`, ...patch };
}

it('groups category aliases without inventing a topic for missing metadata', () => {
  const items = [
    item('a', { category: 'visualizations' }),
    item('b', { category: 'Dashboards' }),
    item('c'),
    item('d', { category: 'data_sources' }),
  ];
  expect(catalogTopic(items[2]!)).toBe('uncategorized');
  expect(catalogTopicCounts(items)).toEqual([
    { id: 'dashboards', count: 2 },
    { id: 'data-sources', count: 1 },
    { id: 'uncategorized', count: 1 },
  ]);
  expect(catalogTopicShortcuts(items)).toEqual([
    { id: 'dashboards', count: 2 },
    { id: 'data-sources', count: 1 },
  ]);
});

it.each(['getting-started', 'cloud-getting-started'])(
  'uses curated %s starters even without categories and preserves source identity',
  (id) => {
    const starter = item(id, {
      format: 'path',
      memberIds: ['dashboard'],
      curatedPath: { id, title: id, description: 'Basics', guides: ['dashboard'], badgeId: 'basics' },
    });
    const privateCollision = item('dashboard', { key: 'app-platform:dashboard', source: 'organization' });
    const official = item('dashboard');
    expect(catalogStarters([privateCollision, starter, official])).toEqual([starter, official]);
  }
);

it('does not suggest unknown content when no curated introductions are available', () => {
  expect(catalogStarters([item('arbitrary-guide')])).toEqual([]);
});

it.each([
  ['k6-script-authoring-assistant-lj', 'Author k6 scripts with Grafana Assistant', 'take-action', 'k6'],
  ['send-logs-alloy-loki-lj', 'Send logs to Grafana Cloud using Alloy', 'data-availability', 'logs'],
  [
    'prom-remote-write-lj',
    'Send metrics to Grafana Cloud using Prometheus remote write',
    'data-availability',
    'metrics',
  ],
  ['alerting-query-language-lj', 'Create an alert rule with query language', 'take-action', 'alerting'],
  ['git-sync-dashboards-lj', 'Work with dashboards using Git Sync', 'query-and-visualize', 'dashboards'],
  [
    'postgresql-data-source-lj',
    'Connect to a PostgreSQL data source in Grafana Cloud',
    'data-availability',
    'data-sources',
  ],
  ['find-k6-limits-end-journey', 'Destination reached!', undefined, 'k6'],
] as const)('finds a supported topic in existing title/id for %s', (id, title, category, expected) => {
  expect(catalogTopic(item(id, { title, category }))).toBe(expected);
});

it('preserves specific authored topics and onboarding rather than inferring a different topic', () => {
  expect(catalogTopic(item('k6-dashboard', { title: 'k6 dashboard', category: 'dashboards' }))).toBe('dashboards');
  expect(catalogTopic(item('get-started-see-alerting', { title: 'Use alerts', category: 'onboarding' }))).toBe(
    'getting-started'
  );
  expect(catalogTopic(item('kubernetes-metrics', { title: 'Metrics in Kubernetes', category: 'kubernetes' }))).toBe(
    'kubernetes'
  );
});

it.each([
  'Catalog overview',
  'Log in to Grafana',
  'Dashboarding concepts',
  'Performance overview',
  'Alertness overview',
  'Telemetry overview',
])('does not infer a topic from unrelated text: %s', (title) =>
  expect(
    catalogTopic(
      item('unknown', { title, category: 'general', description: 'Build a dashboard with logs and metrics' })
    )
  ).toBe('uncategorized')
);

it('keeps broad ingestion categories without clear topic terms in Other topics', () => {
  expect(
    catalogTopic(
      item('linux-server-integration-lj', {
        title: 'Monitor a Linux server in Grafana Cloud',
        category: 'data-availability',
      })
    )
  ).toBe('uncategorized');
});
