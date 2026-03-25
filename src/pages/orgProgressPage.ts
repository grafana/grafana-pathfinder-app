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
import { OrgProgressPanel } from './org-progress';

export const orgProgressPage = new SceneAppPage({
  title: 'Org progress',
  url: prefixRoute(ROUTES.OrgProgress),
  routePath: ROUTES.OrgProgress,
  getScene: orgProgressScene,
});

function orgProgressScene() {
  return new EmbeddedScene({
    $timeRange: new SceneTimeRange({ from: 'now-30d', to: 'now' }),
    controls: [new SceneControlsSpacer(), new SceneTimePicker({ isOnCanvas: true })],
    body: new SceneFlexLayout({
      children: [
        new SceneFlexItem({
          width: '100%',
          height: '100%',
          body: new OrgProgressPanel(),
        }),
      ],
    }),
  });
}
