import React from 'react';
import { SceneObjectBase, type SceneObjectState } from '@grafana/scenes';
import { useStyles2 } from '@grafana/ui';
import { MyLearningTab } from '../LearningPaths';
import { MyLearningErrorBoundary } from '../docs-panel/components';
import { openPreparedGuide } from '../docs-panel/utils/open-prepared-guide';
import { getHomePageStyles } from './home.styles';
import { testIds } from '../../constants/testIds';

interface HomePanelState extends SceneObjectState {}

export class HomePanel extends SceneObjectBase<HomePanelState> {
  public static Component = HomePanelRenderer;
}

export function HomePanelRenderer() {
  const styles = useStyles2(getHomePageStyles);
  return (
    <div className={styles.container} data-testid={testIds.homePage.container}>
      <MyLearningErrorBoundary>
        <MyLearningTab onOpenGuide={openPreparedGuide} />
      </MyLearningErrorBoundary>
    </div>
  );
}
