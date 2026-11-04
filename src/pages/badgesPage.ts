import { PageLayoutType } from '@grafana/data';
import { EmbeddedScene, SceneAppPage, SceneFlexItem, SceneFlexLayout } from '@grafana/scenes';
import { prefixRoute } from '../utils/utils.routing';
import { ROUTES } from '../constants';
import { BadgesPanel } from '../components/LearningPaths/BadgesPanel';

export const badgesPage = new SceneAppPage({
  title: 'Badges',
  url: prefixRoute(ROUTES.Badges),
  routePath: ROUTES.Badges,
  layout: PageLayoutType.Custom,
  getScene: () =>
    new EmbeddedScene({
      body: new SceneFlexLayout({
        direction: 'column',
        children: [new SceneFlexItem({ width: '100%', height: '100%', body: new BadgesPanel({}) })],
      }),
    }),
});
