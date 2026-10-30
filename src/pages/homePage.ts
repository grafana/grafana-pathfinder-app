import { EmbeddedScene, SceneAppPage, SceneFlexItem, SceneFlexLayout } from '@grafana/scenes';
import { createElement } from 'react';
import { config } from '@grafana/runtime';
import { t } from '@grafana/i18n';
import { useStyles2 } from '@grafana/ui';
import { getHomePageStyles } from '../components/Home/home.styles';

import { prefixRoute } from '../utils/utils.routing';
import { ROUTES } from '../constants';
import { HomePanel } from '../components/Home';
import { getFirstName } from '../components/SidebarHub/user-first-name';

export const homePage = new SceneAppPage({
  title: 'My Learning',
  renderTitle: () => createElement(HomePageHeading),
  url: prefixRoute(ROUTES.Home),
  // routePath must be relative (not prefixed) — Grafana 12's RRv6 routing strips the plugin base URL
  routePath: '/',
  getScene: homeScene,
});

function HomePageHeading() {
  const styles = useStyles2(getHomePageStyles);
  const name = getFirstName(config.bootData?.user);
  return createElement(
    'div',
    { className: styles.heading },
    createElement(
      'div',
      { className: styles.headingText },
      createElement(
        'h1',
        { className: styles.title },
        name ? t('myLearning.welcomeName', 'Welcome, {{- name}}', { name }) : t('myLearning.welcome', 'Welcome')
      ),
      createElement(
        'p',
        { className: styles.subtitle },
        t('myLearning.subtitle', 'Track your progress, earn badges, and master Grafana')
      )
    )
  );
}

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
