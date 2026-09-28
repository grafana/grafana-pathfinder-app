import { EmbeddedScene, SceneAppPage, SceneFlexItem, SceneFlexLayout } from '@grafana/scenes';
import { prefixRoute } from '../utils/utils.routing';
import { ROUTES, getConfigWithDefaults } from '../constants';
import { CombinedLearningJourneyPanel } from '../components/docs-panel/docs-panel';

export const docsPage = new SceneAppPage({
  title: 'Documentation',
  url: prefixRoute(ROUTES.Context),
  // routePath must be relative (not prefixed) — Grafana 12's RRv6 routing strips the plugin base URL
  routePath: ROUTES.Context,
  getScene: contextScene,
});

function contextScene() {
  // Scene construction is outside Grafana's plugin context provider, so read the
  // config `plugin.init` publishes. An empty config here reads as "dev mode off"
  // and makes the model prune authorized Dev Tools tabs during restore.
  const config = getConfigWithDefaults(window.__pathfinderPluginConfig || {});

  return new EmbeddedScene({
    body: new SceneFlexLayout({
      children: [
        new SceneFlexItem({
          width: '100%',
          height: 600,
          body: new CombinedLearningJourneyPanel(config),
        }),
      ],
    }),
  });
}
