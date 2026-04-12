import { EmbeddedScene, SceneAppPage, SceneFlexItem, SceneFlexLayout } from '@grafana/scenes';
import { prefixRoute } from '../utils/utils.routing';
import { ROUTES } from '../constants';
import { MainAreaLearningPanel } from '../components/main-area-learning/main-area-learning-panel';
import { mainAreaLearningState } from '../global-state/main-area-learning-state';

export const learningPage = new SceneAppPage({
  title: '',
  url: prefixRoute(ROUTES.Learning),
  // routePath must be relative (not prefixed) — Grafana 12's RRv6 routing strips the plugin base URL
  routePath: ROUTES.Learning,
  // Scenes strips unknown query params unless explicitly preserved.
  // These params drive content loading and chrome control in MainAreaLearningPanel.
  preserveUrlKeys: ['doc', 'fullscreen', 'nav', 'sidebar', 'source'],
  getScene: learningScene,
});

mainAreaLearningState.onTitleChange((title) => {
  learningPage.setState({ title });
});

function learningScene() {
  return new EmbeddedScene({
    body: new SceneFlexLayout({
      children: [
        new SceneFlexItem({
          width: '100%',
          height: '100%',
          body: new MainAreaLearningPanel({}),
        }),
      ],
    }),
  });
}
