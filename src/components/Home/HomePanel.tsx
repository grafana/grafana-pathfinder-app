import React from 'react';
import { SceneObjectBase, type SceneObjectState } from '@grafana/scenes';
import { LinkButton, useStyles2 } from '@grafana/ui';
import { config } from '@grafana/runtime';
import { prefixRoute } from '../../utils/utils.routing';
import { MyLearningTab } from '../LearningPaths';
import { MyLearningErrorBoundary } from '../docs-panel/components';
import { openPreparedGuide } from '../docs-panel/utils/open-prepared-guide';
import { getHomePageStyles } from './home.styles';
import { testIds } from '../../constants/testIds';
import { getFeatureFlagValue } from '../../utils/openfeature';

interface HomePanelState extends SceneObjectState {}

export class HomePanel extends SceneObjectBase<HomePanelState> {
  public static Component = HomePanelRenderer;
}

export function HomePanelRenderer() {
  const styles = useStyles2(getHomePageStyles);
  return (
    <div className={styles.container} data-testid={testIds.homePage.container}>
      {config.bootData?.user?.orgRole === 'Admin' && getFeatureFlagValue('pathfinder.learning-insights', false) && (
        <nav aria-label="Learning administration">
          <LinkButton href={prefixRoute('learning-insights')} variant="secondary" icon="chart-line">
            Learning insights
          </LinkButton>
        </nav>
      )}
      <MyLearningErrorBoundary>
        <MyLearningTab homepage onOpenGuide={openPreparedGuide} />
      </MyLearningErrorBoundary>
    </div>
  );
}
