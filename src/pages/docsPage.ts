import { EmbeddedScene, SceneAppPage, SceneFlexItem, SceneFlexLayout } from '@grafana/scenes';
import { prefixRoute } from '../utils/utils.routing';
import { ROUTES } from '../constants';
import { DocsPanel } from '../components/docs-panel/docs-panel';

export const docsPage = new SceneAppPage({
  title: 'Documentation',
  url: prefixRoute(ROUTES.Documentation),
  routePath: prefixRoute(ROUTES.Documentation),
  getScene: docsScene,
});

function docsScene() {
  return new EmbeddedScene({
    body: new SceneFlexLayout({
      children: [
        new SceneFlexItem({
          width: '100%',
          height: 600,
          body: new DocsPanel(),
        }),
      ],
    }),
  });
}