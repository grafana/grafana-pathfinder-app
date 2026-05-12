import { PageLayoutType } from '@grafana/data';
import { EmbeddedScene, SceneAppPage, SceneFlexItem, SceneFlexLayout } from '@grafana/scenes';
import { prefixRoute } from '../utils/utils.routing';
import { ROUTES } from '../constants';
import { FullScreenPanel } from '../components/full-screen';

export const fullScreenPage = new SceneAppPage({
  // Title is required by SceneAppPage but suppressed at render time —
  // PageLayoutType.Custom skips the standard page chrome (h1, breadcrumbs)
  // so the FullScreenLayout's own header reads as the page title and we
  // don't get the redundant "Full screen" h1 stacked above it.
  title: 'Full screen',
  url: prefixRoute(ROUTES.FullScreen),
  // routePath must be relative (not prefixed) — Grafana 12's RRv6 routing strips the plugin base URL
  routePath: ROUTES.FullScreen,
  layout: PageLayoutType.Custom,
  hideFromBreadcrumbs: true,
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
