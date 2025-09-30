import { AppPlugin, type AppRootProps, BusEventWithPayload, NavModelItem } from '@grafana/data';
import { LoadingPlaceholder } from '@grafana/ui';
import { getAppEvents } from '@grafana/runtime';
import React, { Suspense, lazy } from 'react';
import { reportAppInteraction, UserInteraction } from './lib/analytics';
import { initPluginTranslations } from '@grafana/i18n';
import pluginJson from './plugin.json';

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
const LazyMemoizedContextPanel = lazy(() => import('./components/App/ContextPanel'));
const LazyAppConfig = lazy(() => import('./components/AppConfig/AppConfig'));
const LazyTermsAndConditions = lazy(() => import('./components/AppConfig/TermsAndConditions'));

const App = (props: AppRootProps) => (
  <Suspense fallback={<LoadingPlaceholder text="" />}>
    <LazyApp {...props} />
  </Suspense>
);

export const plugin = new AppPlugin<{}>()
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

// Expose the main component for the sidebar
plugin.addComponent({
  targets: `grafana/extension-sidebar/v0-alpha`,
  title: 'Grafana Pathfinder',
  description: 'Opens Grafana Pathfinder',
  component: function ContextSidebar(props: { helpNode?: NavModelItem }) {
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
        <LazyMemoizedContextPanel helpNode={props.helpNode} />
      </Suspense>
    );
  },
});

plugin.addLink<{ helpNode?: NavModelItem }>({
  title: 'Grafana Pathfinder',
  description: 'Open Grafana Pathfinder documentation assistant',
  targets: ['grafana/app/topbar/help/v1'],
  onClick: (_, {openSidebar, context}) => {
    reportAppInteraction(UserInteraction.DocsPanelInteraction, {
      action: 'open',
      source: 'help_button',
      timestamp: Date.now(),
    });

    openSidebar('Grafana Pathfinder', {
      helpNode: context?.helpNode,
    });
  },
});

plugin.exposeComponent({
  id: 'grafana-grafanadocsplugin-app/pathfinder-help/v1',
  title: 'Grafana Pathfinder',
  description: 'Grafana Pathfinder documentation assistant',
  component: function PathfinderHelpSidebar(props: { helpNode?: NavModelItem }) {
    React.useEffect(() => {
      reportAppInteraction(UserInteraction.DocsPanelInteraction, {
        action: 'open',
        source: 'help_button_sidebar',
        timestamp: Date.now(),
      });

      return () => {
        reportAppInteraction(UserInteraction.DocsPanelInteraction, {
          action: 'close',
          source: 'help_button_sidebar_unmount',
          timestamp: Date.now(),
        });
      };
    }, []);

    return (
      <Suspense fallback={<LoadingPlaceholder text="" />}>
        <LazyMemoizedContextPanel helpNode={props.helpNode} />
      </Suspense>
    );
  },
});

plugin.addLink({
  title: 'Open Grafana Pathfinder',
  description: 'Open Grafana Pathfinder',
  targets: ['grafana/commandpalette/action'],
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
  targets: ['grafana/commandpalette/action'],
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
  targets: ['grafana/commandpalette/action'],
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