import {
  AppPlugin,
  type AppRootProps,
  PluginExtensionPoints,
  BusEventWithPayload,
  usePluginContext,
} from '@grafana/data';
import { LoadingPlaceholder } from '@grafana/ui';
import { getAppEvents } from '@grafana/runtime';
import React, { Suspense, lazy, useCallback, useMemo } from 'react';
import { reportAppInteraction, UserInteraction } from './lib/analytics';
import { initPluginTranslations } from '@grafana/i18n';
import pluginJson from './plugin.json';
import { useGlobalLinkInterceptor } from './utils/global-link-interceptor.hook';
import { getConfigWithDefaults } from './constants';

// Initialize translations
await initPluginTranslations(pluginJson.id);

interface OpenExtensionSidebarPayload {
  props?: Record<string, unknown>;
  pluginId: string;
  componentTitle: string;
}

class OpenExtensionSidebarEvent extends BusEventWithPayload<OpenExtensionSidebarPayload> {
  static type = 'open-extension-sidebar';
}

function openExtensionSidebar(pluginId: string, componentTitle: string, props?: Record<string, unknown>) {
  const event = new OpenExtensionSidebarEvent({
    pluginId,
    componentTitle,
    props,
  });
  getAppEvents().publish(event);
}

const LazyApp = lazy(() => import('./components/App/App'));
const LazyMemoizedContextPanel = lazy(() =>
  import('./components/App/App').then((module) => ({ default: module.MemoizedContextPanel }))
);
const LazyAppConfig = lazy(() => import('./components/AppConfig/AppConfig'));
const LazyTermsAndConditions = lazy(() => import('./components/AppConfig/TermsAndConditions'));
const LazyInteractiveFeatures = lazy(() => import('./components/AppConfig/InteractiveFeatures'));

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
  })
  .addConfigPage({
    title: 'Interactive Features',
    body: LazyInteractiveFeatures,
    id: 'interactive-features',
  });

export { plugin };

plugin.addComponent({
  targets: `grafana/extension-sidebar/v0-alpha`,
  title: 'Grafana Pathfinder',
  description: 'Opens Grafana Pathfinder',
  component: function ContextSidebar() {
    // Get plugin configuration
    const pluginContext = usePluginContext();
    const config = useMemo(() => {
      return getConfigWithDefaults(pluginContext?.meta?.jsonData || {});
    }, [pluginContext?.meta?.jsonData]);

    // Callback to open docs link in Pathfinder sidebar
    const handleOpenDocsLink = useCallback((url: string, title: string) => {
      try {
        // First, dispatch custom event to tell context panel to open this URL
        const autoOpenEvent = new CustomEvent('pathfinder-auto-open-docs', {
          detail: {
            url,
            title,
            origin: 'global_link_interceptor',
          },
        });
        document.dispatchEvent(autoOpenEvent);

        // Then, open the extension sidebar (if not already open)
        const appEvents = getAppEvents();
        appEvents.publish({
          type: 'open-extension-sidebar',
          payload: {
            pluginId: pluginJson.id,
            componentTitle: 'Grafana Pathfinder',
          },
        });
      } catch (error) {
        console.error('Failed to open docs link in Pathfinder:', error);
      }
    }, []);

    // Enable global link interception if configured
    useGlobalLinkInterceptor({
      onOpenDocsLink: handleOpenDocsLink,
      enabled: config.interceptGlobalDocsLinks,
    });

    React.useEffect(() => {
      reportAppInteraction(UserInteraction.DocsPanelInteraction, {
        action: 'open',
        source: 'sidebar_mount',
        timestamp: Date.now(),
      });

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

plugin.addLink({
  title: 'Open Grafana Pathfinder',
  description: 'Open Grafana Pathfinder',
  targets: [PluginExtensionPoints.CommandPalette],
  onClick: () => {
    reportAppInteraction(UserInteraction.DocsPanelInteraction, {
      action: 'open',
      source: 'command_palette',
      timestamp: Date.now(),
    });

    openExtensionSidebar(pluginJson.id, 'Grafana Pathfinder', {
      origin: 'command_palette',
      timestamp: Date.now(),
    });
  },
});

plugin.addLink({
  title: 'Need help?',
  description: 'Get help with Grafana',
  targets: [PluginExtensionPoints.CommandPalette],
  onClick: () => {
    reportAppInteraction(UserInteraction.DocsPanelInteraction, {
      action: 'open',
      source: 'command_palette_help',
      timestamp: Date.now(),
    });

    openExtensionSidebar(pluginJson.id, 'Grafana Pathfinder', {
      origin: 'command_palette_help',
      timestamp: Date.now(),
    });
  },
});

plugin.addLink({
  title: 'Learn Grafana',
  description: 'Learn how to use Grafana',
  targets: [PluginExtensionPoints.CommandPalette],
  onClick: () => {
    reportAppInteraction(UserInteraction.DocsPanelInteraction, {
      action: 'open',
      source: 'command_palette_learn',
      timestamp: Date.now(),
    });

    openExtensionSidebar(pluginJson.id, 'Grafana Pathfinder', {
      origin: 'command_palette_learn',
      timestamp: Date.now(),
    });
  },
});

plugin.addLink({
  targets: `grafana/extension-sidebar/v0-alpha`,
  title: 'Documentation-Link',
  description: 'Opens Grafana Pathfinder',
  configure: () => {
    return {
      icon: 'question-circle',
      description: 'Opens Grafana Pathfinder',
      title: 'Grafana Pathfinder',
    };
  },
  onClick: () => {},
});
