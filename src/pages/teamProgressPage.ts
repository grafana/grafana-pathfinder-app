import { EmbeddedScene, SceneAppPage, SceneFlexItem, SceneFlexLayout } from '@grafana/scenes';
import { prefixRoute } from '../utils/utils.routing';
import { ROUTES } from '../constants';
import { TeamProgressPanel } from './team-progress';

export const teamProgressPage = new SceneAppPage({
  title: 'Team progress',
  url: prefixRoute(ROUTES.TeamProgress),
  routePath: ROUTES.TeamProgress,
  getScene: teamProgressScene,
});

function teamProgressScene() {
  return new EmbeddedScene({
    body: new SceneFlexLayout({
      children: [
        new SceneFlexItem({
          width: '100%',
          height: '100%',
          body: new TeamProgressPanel({}),
        }),
      ],
    }),
  });
}
