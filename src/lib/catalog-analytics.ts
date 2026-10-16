import { reportAppInteraction, UserInteraction } from './analytics';

type CatalogInteraction =
  | { action: 'tab_click' | 'search' }
  | { action: 'topic'; topic: string; control: 'shortcut' | 'filter' }
  | { action: 'view'; view: 'explore' | 'all'; previousView: 'explore' | 'all' }
  | {
      action: 'source';
      source: 'all' | 'grafana' | 'organization';
      previousSource: 'all' | 'grafana' | 'organization';
    };

const TOPICS = new Set([
  'all',
  'dashboards',
  'data-sources',
  'alerting',
  'metrics',
  'logs',
  'k6',
  'getting-started',
  'uncategorized',
]);

export function reportCatalogInteraction(interaction: CatalogInteraction): void {
  reportAppInteraction(UserInteraction.CatalogInteraction, {
    interaction_location: 'package_browser',
    action: interaction.action,
    ...(interaction.action === 'topic' && {
      topic: TOPICS.has(interaction.topic) ? interaction.topic : 'other',
      control: interaction.control,
    }),
    ...(interaction.action === 'view' && { view: interaction.view, previous_view: interaction.previousView }),
    ...(interaction.action === 'source' && { source: interaction.source, previous_source: interaction.previousSource }),
  });
}
