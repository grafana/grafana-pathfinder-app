import type { CatalogPackage } from '../types/package-catalog.types';

const TOPIC_ALIASES: Record<string, string> = {
  dashboard: 'dashboards',
  visualization: 'dashboards',
  visualizations: 'dashboards',
  'data-source': 'data-sources',
  datasource: 'data-sources',
  datasources: 'data-sources',
  connections: 'data-sources',
  alerts: 'alerting',
  alert: 'alerting',
  onboarding: 'getting-started',
  'load-testing': 'k6',
  'performance-testing': 'k6',
};

const SHORTCUT_TOPICS = ['dashboards', 'data-sources', 'alerting', 'metrics', 'logs', 'k6'];
const GENERIC_CATEGORIES = new Set([
  'general',
  'take-action',
  'query-and-visualize',
  'learning-path',
  'data-availability',
]);

const TOPIC_RULES: Array<[string, RegExp]> = [
  ['k6', /\bk6\b|\b(?:load|performance|spike|soak|stress) test(?:s|ing)?\b/],
  ['alerting', /\b(?:alert|alerts|alerting|alertmanager)\b/],
  ['data-sources', /\bdata sources?\b|\bdatasources?\b/],
  ['dashboards', /\bdashboards?\b/],
  ['logs', /\b(?:logs|loki)\b/],
  ['metrics', /\b(?:metrics?|prometheus|promql)\b/],
  ['dashboards', /\bvisualizations?\b/],
];

function topicFromTitleAndId(item: Pick<CatalogPackage, 'id' | 'title'>): string | undefined {
  const text = `${item.title} ${item.id}`.toLowerCase().replace(/[-_]+/g, ' ');
  return TOPIC_RULES.find(([, pattern]) => pattern.test(text))?.[0];
}

export function catalogTopic(item: Pick<CatalogPackage, 'id' | 'title' | 'category'>): string {
  const category = item.category
    ?.trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  if (category && !GENERIC_CATEGORIES.has(category)) {
    return TOPIC_ALIASES[category] ?? category;
  }
  return topicFromTitleAndId(item) ?? 'uncategorized';
}

export function catalogTopicCounts(items: CatalogPackage[]): Array<{ id: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const topic = catalogTopic(item);
    counts.set(topic, (counts.get(topic) ?? 0) + 1);
  }
  return [...counts].map(([id, count]) => ({ id, count })).sort((a, b) => a.id.localeCompare(b.id));
}

export function catalogTopicShortcuts(items: CatalogPackage[]): Array<{ id: string; count: number }> {
  const counts = catalogTopicCounts(items);
  return SHORTCUT_TOPICS.flatMap((id) => counts.filter((topic) => topic.id === id));
}

export function catalogStarters(items: CatalogPackage[]): CatalogPackage[] {
  const primary = items.find(
    (item) => item.source === 'grafana' && item.curatedPath && /^(cloud-)?getting-started$/.test(item.id)
  );
  if (!primary) {
    return items.filter((item) => item.source === 'grafana' && item.curatedPath).slice(0, 2);
  }
  const lastMember = primary.memberIds?.at(-1);
  const guide = items.find((item) => item.source === 'grafana' && item.id === lastMember && item.format === 'guide');
  return guide ? [primary, guide] : [primary];
}
