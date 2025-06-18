import { EmbeddedScene, SceneAppPage, SceneFlexItem, SceneFlexLayout } from '@grafana/scenes';
import { prefixRoute } from '../utils/utils.routing';
import { ROUTES } from '../constants';
import { CombinedLearningJourneyPanel } from '../components/docs-panel/docs-panel';

export const docsPage = new SceneAppPage({
  title: 'Learning Journeys',
  url: prefixRoute(ROUTES.Context),
  routePath: prefixRoute(ROUTES.Context),
  getScene: contextScene,
});

function contextScene() {
  return new EmbeddedScene({
    body: new SceneFlexLayout({
      children: [
        new SceneFlexItem({
          width: '100%',
          height: 600,
          body: new CombinedLearningJourneyPanel(),
        }),
      ],
    }),
  });
}
