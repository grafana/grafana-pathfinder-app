import { AppPlugin, AppPluginMeta, type AppRootProps, PluginExtensionPoints, usePluginContext } from '@grafana/data';
import { LoadingPlaceholder } from '@grafana/ui';
import { getAppEvents, locationService } from '@grafana/runtime';
import React, { Suspense, lazy, useEffect, useMemo } from 'react';
import { reportAppInteraction, UserInteraction } from './lib/analytics';
import { initPluginTranslations } from '@grafana/i18n';
import pluginJson from './plugin.json';
import { getConfigWithDefaults, DocsPluginConfig } from './constants';
import { linkInterceptionState } from './global-state/link-interception';
import { sidebarState } from 'global-state/sidebar';

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
  linkInterceptionState.setInterceptionEnabled(config.interceptGlobalDocsLinks);

  // Set global config immediately so other code can use it
  (window as any).__pathfinderPluginConfig = config;

  // Check for journey query parameter to auto-open specific learning journey
  const urlParams = new URLSearchParams(window.location.search);
  const journeyParam = urlParams.get('journey');
  let journey = journeyParam ? findLearningJourney(journeyParam) : null;

  if (journey) {
    // listen for completion
    window.addEventListener('auto-launch-complete', (e) => {
      // remove journey param from URL to prevent re-triggering on refresh
      const url = new URL(window.location.href);
      url.searchParams.delete('journey');
      window.history.replaceState({}, '', url.toString());
      console.log('Journey param removed from URL');
    });

    // open the sidebar
    attemptAutoOpen(200);

    // open the journey once the sidebar is mounted
    window.addEventListener('pathfinder-sidebar-mounted', () => {
      setTimeout(() => {
        const autoLaunchEvent = new CustomEvent('auto-launch-tutorial', {
          detail: {
            url: journey.url,
            title: journey.title,
            type: 'learning-journey',
          },
        });
        document.dispatchEvent(autoLaunchEvent);
      }, 500);
    });
  }

  // Check if auto-open is enabled
  // Feature toggle sets the default, but user config always takes precedence
  const shouldAutoOpen = config.openPanelOnLaunch;

  // Auto-open panel if enabled (once per session per instance)
  if (shouldAutoOpen) {
    // Include hostname to make this unique per Grafana instance
    // This ensures each Cloud instance (e.g., company1.grafana.net, company2.grafana.net)
    // tracks its own auto-open state independently
    const hostname = window.location.hostname;
    const sessionKey = `grafana-interactive-learning-panel-auto-opened-${hostname}`;

    // Check initial location
    const location = locationService.getLocation();
    const currentPath = location.pathname || window.location.pathname || '';
    const isOnboardingFlow = currentPath.includes('/a/grafana-setupguide-app/onboarding-flow');
    const hasAutoOpened = sessionStorage.getItem(sessionKey);

    // Auto-open immediately if not on onboarding flow
    if (!hasAutoOpened && !isOnboardingFlow) {
      sessionStorage.setItem(sessionKey, 'true');
      attemptAutoOpen(200);
    }

    // If user starts on onboarding flow, listen for navigation away from it
    // This ensures the sidebar opens when they navigate to normal Grafana
    if (!hasAutoOpened && isOnboardingFlow) {
      const checkLocationChange = () => {
        const newLocation = locationService.getLocation();
        const newPath = newLocation.pathname || window.location.pathname || '';
        const stillOnOnboarding = newPath.includes('/a/grafana-setupguide-app/onboarding-flow');
        const alreadyOpened = sessionStorage.getItem(sessionKey);

        // If we've left onboarding and haven't auto-opened yet, do it now
        if (!stillOnOnboarding && !alreadyOpened) {
          sessionStorage.setItem(sessionKey, 'true');
          attemptAutoOpen(500); // Slightly longer delay after navigation
        }
      };

      // Listen for Grafana location changes (works across SPA navigation)
      document.addEventListener('grafana:location-changed', checkLocationChange);

      // Also listen via locationService history API (more reliable for some navigation types)
      try {
        const history = locationService.getHistory();
        if (history) {
          const unlisten = history.listen(checkLocationChange);
          // Store unlisten function for potential cleanup (though plugin.init typically doesn't get cleaned up)
          (window as any).__pathfinderAutoOpenUnlisten = unlisten;
        }
      } catch (error) {
        // Fallback to popstate if history API not available
        window.addEventListener('popstate', checkLocationChange);
      }
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

    // Process queued docs links when sidebar mounts
    useEffect(() => {
      sidebarState.setIsSidebarMounted(true);

      // Fire custom event when sidebar component mounts
      const mountEvent = new CustomEvent('pathfinder-sidebar-mounted', {
        detail: {
          timestamp: Date.now(),
        },
      });
      window.dispatchEvent(mountEvent);

      return () => {
        sidebarState.setIsSidebarMounted(false);
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

    sidebarState.openSidebar('Interactive learning', {
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

    sidebarState.openSidebar('Interactive learning', {
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

    sidebarState.openSidebar('Interactive learning', {
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

const findLearningJourney = function (param: string) {
  // Don't search if param is empty
  if (!param || param.trim() === '') {
    return null;
  }

  // Dynamically load all JSON files from static-links directory
  const staticLinksContext = (require as any).context('./bundled-interactives/static-links', false, /\.json$/);
  const allFilePaths = staticLinksContext.keys();

  let foundJourney: any = null;

  // Search through all static-links files
  for (const filePath of allFilePaths) {
    const staticData = staticLinksContext(filePath);

    if (staticData && staticData.rules && Array.isArray(staticData.rules)) {
      // Find learning journeys that match the URL
      const journey = staticData.rules.find(
        (rule: any) => rule.type === 'learning-journey' && (rule.url === param || rule.url.includes(param))
      );

      if (journey) {
        foundJourney = journey;
        break;
      }
    }
  }

  return foundJourney;
};

/**
 * Attempts to auto-open the sidebar with configured tutorial
 * This is extracted as a function so it can be called both on init and after navigation
 */
const attemptAutoOpen = (delay = 500) => {
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
    } catch (error) {
      console.error('Failed to auto-open Interactive learning panel:', error);
    }
  }, delay);
};
