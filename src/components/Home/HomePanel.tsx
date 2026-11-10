import React, { useRef } from 'react';
import { SceneObjectBase, type SceneObjectState } from '@grafana/scenes';
import { LinkButton, useStyles2 } from '@grafana/ui';
import { config } from '@grafana/runtime';
import { t } from '@grafana/i18n';
import { prefixRoute } from '../../utils/utils.routing';
import { ROUTES } from '../../constants';
import { useLearningPageScroll } from '../../hooks';
import { MyLearningTab } from '../LearningPaths';
import { MyLearningErrorBoundary } from '../docs-panel/components';
import { openPreparedGuide } from '../docs-panel/utils/open-prepared-guide';
import { getHomePageStyles } from './home.styles';
import { testIds } from '../../constants/testIds';
import { getFeatureFlagValue, useBooleanFlag } from '../../utils/openfeature';
import { getFirstName } from '../SidebarHub/user-first-name';

interface HomePanelState extends SceneObjectState {}

export class HomePanel extends SceneObjectBase<HomePanelState> {
  public static Component = HomePanelRenderer;
}

function HomePageHeader({ children }: { children: React.ReactNode }) {
  const styles = useStyles2(getHomePageStyles);
  const name = getFirstName(config.bootData?.user);
  return (
    <header className={styles.heading}>
      <div className={styles.headingText}>
        <h1 className={styles.title}>
          {name ? t('myLearning.welcomeName', 'Welcome, {{- name}}', { name }) : t('myLearning.welcome', 'Welcome')}
        </h1>
        {children}
      </div>
      <HomePageActions />
    </header>
  );
}

export function HomePageActions() {
  const styles = useStyles2(getHomePageStyles);
  const browseEnabled = useBooleanFlag('pathfinder.package-browser', true);
  return (
    <nav aria-label={t('myLearning.pageActions', 'Learning pages')} className={styles.pageActions}>
      {config.bootData?.user?.orgRole === 'Admin' && getFeatureFlagValue('pathfinder.learning-insights', false) && (
        <LinkButton
          href={prefixRoute('learning-insights')}
          variant="secondary"
          fill="outline"
          icon="chart-line"
          size="md"
        >
          {t('myLearning.learningInsights', 'Learning insights')}
        </LinkButton>
      )}
      {browseEnabled && (
        <LinkButton
          href={`${prefixRoute(ROUTES.Browse)}?view=all`}
          variant="secondary"
          fill="outline"
          icon="compass"
          size="md"
        >
          {t('myLearning.exploreLearning', 'Explore learning')}
        </LinkButton>
      )}
    </nav>
  );
}

export function HomePanelRenderer() {
  const styles = useStyles2(getHomePageStyles);
  const container = useRef<HTMLDivElement>(null);
  useLearningPageScroll(container);
  return (
    <div ref={container} className={styles.container} data-testid={testIds.homePage.container}>
      <MyLearningErrorBoundary>
        <MyLearningTab homepage header={HomePageHeader} onOpenGuide={openPreparedGuide} />
      </MyLearningErrorBoundary>
    </div>
  );
}
