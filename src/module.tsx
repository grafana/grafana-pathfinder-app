import { AppPlugin, AppPluginMeta, type AppRootProps, PluginExtensionPoints, usePluginContext } from '@grafana/data';
import { LoadingPlaceholder } from '@grafana/ui';
import { getAppEvents } from '@grafana/runtime';
import React, { Suspense, lazy, useEffect, useMemo } from 'react';
import { reportAppInteraction, UserInteraction } from './lib/analytics';
import { initPluginTranslations } from '@grafana/i18n';
import pluginJson from './plugin.json';
import { getConfigWithDefaults, DocsPluginConfig } from './constants';
import { globalState } from './global-state';

// Initialize translations
await initPluginTranslations(pluginJson.id);

const LazyApp = lazy(() => import('./components/App/App'));
const LazyMemoizedContextPanel = lazy(() => import('./components/App/ContextPanel'));
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

// Override init() to handle auto-open when plugin loads
plugin.init = function (meta: AppPluginMeta<DocsPluginConfig>) {
  const jsonData = meta?.jsonData || {};
  const config = getConfigWithDefaults(jsonData);
  globalState.setInterceptionEnabled(config.interceptGlobalDocsLinks);

  // Set global config immediately so other code can use it
  (window as any).__pathfinderPluginConfig = config;

  // Check if auto-open is enabled
  // Feature toggle sets the default, but user config always takes precedence
  const shouldAutoOpen = config.openPanelOnLaunch;

  // Auto-open panel if enabled (once per session)
  if (shouldAutoOpen) {
    const sessionKey = 'grafana-interactive-learning-panel-auto-opened';
    const hasAutoOpened = sessionStorage.getItem(sessionKey);

    if (!hasAutoOpened) {
      sessionStorage.setItem(sessionKey, 'true');

      // Small delay to ensure Grafana is ready
      setTimeout(() => {
        try {
          const appEvents = getAppEvents();
          appEvents.publish({
            type: 'open-extension-sidebar',
            payload: {
              pluginId: pluginJson.id,
              componentTitle: 'Interactive learning',
            },
          });

          // Auto-launch tutorial if configured
          if (config.tutorialUrl) {
            setTimeout(() => {
              const isBundled = config.tutorialUrl!.startsWith('bundled:');
              const isLearningJourney = config.tutorialUrl!.includes('/learning-journeys/') || isBundled;

              const autoLaunchEvent = new CustomEvent('auto-launch-tutorial', {
                detail: {
                  url: config.tutorialUrl,
                  title: 'Auto-launched Tutorial',
                  type: isLearningJourney ? 'learning-journey' : 'docs-page',
                },
              });
              document.dispatchEvent(autoLaunchEvent);
            }, 2000); // Wait for sidebar to mount
          }
        } catch (error) {
          console.error('Failed to auto-open Interactive learning panel:', error);
        }
      }, 500);
    }
  }
};

export { plugin };

plugin.addComponent({
  targets: `grafana/extension-sidebar/v0-alpha`,
  title: 'Interactive learning',
  description: 'Opens Interactive learning',
  component: function ContextSidebar() {
    // Get plugin configuration
    const pluginContext = usePluginContext();
    const config = useMemo(() => {
      const rawJsonData = pluginContext?.meta?.jsonData || {};
      const configWithDefaults = getConfigWithDefaults(rawJsonData);

      return configWithDefaults;
    }, [pluginContext?.meta?.jsonData]);

    // Set global config for utility functions (including auto-open logic)
    useEffect(() => {
      (window as any).__pathfinderPluginConfig = config;
    }, [config]);

    // Enable/disable global link interception based on config
    useEffect(() => {
      globalState.setInterceptionEnabled(config.interceptGlobalDocsLinks);
    }, [config.interceptGlobalDocsLinks]);

    // Process queued docs links when sidebar mounts
    useEffect(() => {
      // Mark sidebar as mounted
      globalState.setSidebarMounted(true);

      // Report sidebar opened
      reportAppInteraction(UserInteraction.DocsPanelInteraction, {
        action: 'open',
        source: 'sidebar_mount',
        timestamp: Date.now(),
      });

      return () => {
        // Mark sidebar as unmounted
        globalState.setSidebarMounted(false);

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
  title: 'Open Interactive learning',
  description: 'Open Interactive learning',
  targets: [PluginExtensionPoints.CommandPalette],
  onClick: () => {
    reportAppInteraction(UserInteraction.DocsPanelInteraction, {
      action: 'open',
      source: 'command_palette',
      timestamp: Date.now(),
    });

    globalState.openSidebar('Interactive learning', {
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

    globalState.openSidebar('Interactive learning', {
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

    globalState.openSidebar('Interactive learning', {
      origin: 'command_palette_learn',
      timestamp: Date.now(),
    });
  },
});

plugin.addLink({
  targets: `grafana/extension-sidebar/v0-alpha`,
  title: 'Documentation-Link',
  description: 'Opens Interactive learning',
  configure: () => {
    return {
      icon: 'question-circle',
      description: 'Opens Interactive learning',
      title: 'Interactive learning',
    };
  },
  onClick: () => {},
});
