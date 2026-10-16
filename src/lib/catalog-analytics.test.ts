import { reportCatalogInteraction } from './catalog-analytics';
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

it.each(['all', 'dashboards', 'data-sources', 'alerting', 'metrics', 'logs', 'k6', 'getting-started', 'uncategorized'])(
  'reports allowlisted topic %s',
  (topic) => {
    reportCatalogInteraction({ action: 'topic', topic, control: 'filter' });
    expect(reportAppInteraction).toHaveBeenLastCalledWith(UserInteraction.CatalogInteraction, {
      interaction_location: 'package_browser',
      action: 'topic',
      topic,
      control: 'filter',
    });
  }
);
