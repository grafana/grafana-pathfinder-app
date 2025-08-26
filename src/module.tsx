import { AppPlugin, type AppRootProps } from '@grafana/data';
import { LoadingPlaceholder } from '@grafana/ui';
import React, { Suspense, lazy } from 'react';
import { reportAppInteraction, UserInteraction } from './lib/analytics';
import { initPluginTranslations } from '@grafana/i18n';
import pluginJson from './plugin.json';

// Initialize translations
await initPluginTranslations(pluginJson.id);

const LazyApp = lazy(() => import('./components/App/App'));
const LazyMemoizedContextPanel = lazy(() =>
  import('./components/App/App').then((module) => ({ default: module.MemoizedContextPanel }))
);
const LazyAppConfig = lazy(() => import('./components/AppConfig/AppConfig'));
const LazyTermsAndConditions = lazy(() => import('./components/AppConfig/TermsAndConditions'));

const App = (props: AppRootProps) => (
  <Suspense fallback={<LoadingPlaceholder text="" />}>
    <LazyApp {...props} />
  </Suspense>
);

const plugin = new AppPlugin<{}>()
  .setRootPage(App)
  .addConfigPage({
    title: 'Configuration',
    body: LazyAppConfig,
    id: 'configuration',
  })
  .addConfigPage({
    title: 'Recommendations',
    body: LazyTermsAndConditions,
    id: 'recommendations-config',
  });

export { plugin };

plugin.addComponent({
  targets: `grafana/extension-sidebar/v0-alpha`,
  title: 'Grafana Pathfinder',
  description: 'Opens Documentation App',
  component: function ContextSidebar() {
    // Track when the sidebar component is mounted and unmounted
    React.useEffect(() => {
      // Component mounted - sidebar actually opened
      reportAppInteraction(UserInteraction.DocsPanelInteraction, {
        action: 'open',
        source: 'sidebar_mount',
        timestamp: Date.now(),
      });

      // Return cleanup function that runs when component unmounts (sidebar closed)
      return () => {
        reportAppInteraction(UserInteraction.DocsPanelInteraction, {
          action: 'close',
          source: 'sidebar_unmount',
          timestamp: Date.now(),
        });
      };
    }, []);

    return (
      <Suspense fallback={<LoadingPlaceholder text="" />}>
        <LazyMemoizedContextPanel />
      </Suspense>
    );
  },
});

// This is needed to show the Context Panel in the top navigation
// If we want to exclude it from certain pages, we can do that in the configure function
plugin.addLink({
  targets: `grafana/extension-sidebar/v0-alpha`,
  title: 'Documentation-Link',
  description: 'Opens Documentation App',
  configure: () => {
    return {
      icon: 'question-circle',
      description: 'Opens Documentation App',
      title: 'Grafana Pathfinder',
    };
  },
  onClick: () => {
    // No analytics tracking here since we can't reliably determine if we're opening or closing
    // Component lifecycle tracking above provides accurate open/close events
  },
});
