import { PageLayoutType } from '@grafana/data';
import { EmbeddedScene, SceneAppPage, SceneFlexItem, SceneFlexLayout } from '@grafana/scenes';
import { prefixRoute } from '../utils/utils.routing';
import { ROUTES } from '../constants';
import { BrowsePanel } from '../components/PackageBrowser/BrowsePanel';
import { homePage } from './homePage';

export const browsePage = new SceneAppPage({
  title: 'Explore learning',
  url: prefixRoute(ROUTES.Browse),
  routePath: ROUTES.Browse,
  layout: PageLayoutType.Custom,
  getParentPage: () => homePage,
  getScene: () =>
    new EmbeddedScene({
      body: new SceneFlexLayout({
        direction: 'column',
        children: [new SceneFlexItem({ width: '100%', height: '100%', body: new BrowsePanel({}) })],
      }),
    }),
});
