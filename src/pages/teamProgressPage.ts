import {
  EmbeddedScene,
  SceneAppPage,
  SceneControlsSpacer,
  SceneFlexItem,
  SceneFlexLayout,
  SceneTimePicker,
  SceneTimeRange,
} from '@grafana/scenes';
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
    $timeRange: new SceneTimeRange({ from: 'now-30d', to: 'now' }),
    controls: [new SceneControlsSpacer(), new SceneTimePicker({ isOnCanvas: true })],
    body: new SceneFlexLayout({
      children: [
        new SceneFlexItem({
          width: '100%',
          height: '100%',
          body: new TeamProgressPanel(),
        }),
      ],
    }),
  });
}
