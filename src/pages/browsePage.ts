import { PageLayoutType } from '@grafana/data';
import { EmbeddedScene, SceneAppPage, SceneFlexItem, SceneFlexLayout } from '@grafana/scenes';
import { prefixRoute } from '../utils/utils.routing';
import { ROUTES } from '../constants';
import { BrowsePanel } from '../components/PackageBrowser/BrowsePanel';

export const browsePage = new SceneAppPage({
  title: 'Browse guides',
  url: prefixRoute(ROUTES.Browse),
  routePath: ROUTES.Browse,
  layout: PageLayoutType.Custom,
  getScene: () =>
    new EmbeddedScene({
      body: new SceneFlexLayout({
        direction: 'column',
        children: [new SceneFlexItem({ width: '100%', height: '100%', body: new BrowsePanel({}) })],
      }),
    }),
});
