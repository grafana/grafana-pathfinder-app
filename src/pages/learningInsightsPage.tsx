import React, { lazy, Suspense } from 'react';
import { EmbeddedScene, SceneAppPage, SceneFlexItem, SceneFlexLayout, SceneObjectBase } from '@grafana/scenes';
import { Alert, LoadingPlaceholder } from '@grafana/ui';
import { config } from '@grafana/runtime';
import { prefixRoute } from '../utils/utils.routing';
import { getFeatureFlagValue } from '../utils/openfeature';

const LearningInsightsPage = lazy(() => import('./LearningInsights'));

class LearningInsightsPanel extends SceneObjectBase {
  static Component = LearningInsightsRenderer;
}

export function LearningInsightsRenderer() {
  if (config.bootData?.user?.orgRole !== 'Admin') {
    return <Alert severity="warning" title="Learning insights is for administrators of the current organization" />;
  }
  if (!getFeatureFlagValue('pathfinder.learning-insights', false)) {
    return <Alert severity="info" title="Learning insights is not enabled for this stack" />;
  }
  return (
    <Suspense fallback={<LoadingPlaceholder text="Loading learning insights…" />}>
      <LearningInsightsPage />
    </Suspense>
  );
}

export const learningInsightsPage = new SceneAppPage({
  title: 'Learning insights',
  url: prefixRoute('learning-insights'),
  routePath: 'learning-insights',
  getScene: () =>
    new EmbeddedScene({
      body: new SceneFlexLayout({
        direction: 'column',
        children: [new SceneFlexItem({ width: '100%', height: '100%', body: new LearningInsightsPanel({}) })],
      }),
    }),
});
