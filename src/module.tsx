import { AppPlugin, type AppRootProps } from '@grafana/data';
import { LoadingPlaceholder } from '@grafana/ui';
import React, { Suspense, lazy } from 'react';

const LazyApp = lazy(() => import('./components/App/App'));
const LazyMemoizedDocsPanel = lazy(() =>
  import('./components/App/App').then((module) => ({ default: module.MemoizedDocsPanel }))
);

const App = (props: AppRootProps) => (
  <Suspense fallback={<LoadingPlaceholder text="" />}>
    <LazyApp {...props} />
  </Suspense>
);

const plugin = new AppPlugin<{}>().setRootPage(App);

export { plugin };

plugin.addComponent({
  targets: `grafana/extension-sidebar/v0-alpha`,
  title: 'Documentation-Panel',
  description: 'Opens Documentation App',
  component: function DocumentationSidebar() {
    return (
      <Suspense fallback={<LoadingPlaceholder text="" />}>
        <LazyMemoizedDocsPanel />
      </Suspense>
    );
  },
});

// This is needed to show the Documentation in the top navigation
// If we want to exclude it from certain pages, we can do that in the configure function
plugin.addLink({
  targets: `grafana/extension-sidebar/v0-alpha`,
  title: 'Documentation-Link',
  description: 'Opens Documentation App',
  configure: () => {
    return {
      icon: 'question-circle',
      description: 'Opens Documentation App',
      title: 'Documentation-Panel',
    };
  },
  onClick: () => {
    // do nothing
    void 0;
  },
});