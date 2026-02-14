import { EmbeddedScene, SceneAppPage, SceneFlexItem, SceneFlexLayout } from '@grafana/scenes';
import { prefixRoute } from '../utils/utils.routing';
import { ROUTES } from '../constants';
import { HomePanel } from '../components/Home';

export const homePage = new SceneAppPage({
  title: 'Home',
  url: prefixRoute(ROUTES.Home),
  // routePath must be relative (not prefixed) — Grafana 12's RRv6 routing strips the plugin base URL
  routePath: '/',
  getScene: homeScene,
});

function homeScene() {
  return new EmbeddedScene({
    body: new SceneFlexLayout({
      children: [
        new SceneFlexItem({
          width: '100%',
          height: '100%',
          body: new HomePanel({}),
        }),
      ],
    }),
  });
}
