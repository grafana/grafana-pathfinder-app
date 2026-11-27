import { PageLayoutType } from '@grafana/data';
import { EmbeddedScene, SceneAppPage, SceneFlexItem, SceneFlexLayout } from '@grafana/scenes';
import { prefixRoute } from '../utils/utils.routing';
import { ROUTES } from '../constants';
import { FullScreenPanel } from '../components/full-screen';

export const fullScreenPage = new SceneAppPage({
  title: 'Learning path',
  url: prefixRoute(ROUTES.FullScreen),
  // routePath must be relative (not prefixed) — Grafana 12's RRv6 routing strips the plugin base URL
  routePath: ROUTES.FullScreen,
  layout: PageLayoutType.Custom,
  hideFromBreadcrumbs: false,
  getScene: fullScreenScene,
});

function fullScreenScene() {
  return new EmbeddedScene({
    body: new SceneFlexLayout({
      direction: 'column',
      children: [
        new SceneFlexItem({
          width: '100%',
          height: '100%',
          body: new FullScreenPanel({}),
        }),
      ],
    }),
  });
}
