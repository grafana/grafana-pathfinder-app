import { AppPlugin, AppPluginMeta, type AppRootProps, PluginExtensionPoints, usePluginContext } from '@grafana/data';
import { LoadingPlaceholder } from '@grafana/ui';
import { getAppEvents, locationService } from '@grafana/runtime';
import React, { Suspense, lazy, useEffect, useMemo } from 'react';
import { reportAppInteraction, UserInteraction } from './lib/analytics';
// TODO: Re-enable Faro once collector CORS is configured correctly
// import { initializeFaroMetrics } from './lib/faro';
import { initPluginTranslations } from '@grafana/i18n';
import pluginJson from './plugin.json';
import { getConfigWithDefaults, DocsPluginConfig } from './constants';
import { linkInterceptionState } from './global-state/link-interception';
import { sidebarState } from 'global-state/sidebar';
import { isGrafanaDocsUrl, isInteractiveLearningUrl } from './security';

// TODO: Re-enable Faro once collector CORS is configured correctly
// Initialize Faro metrics (before translations to capture early errors)
// Wrapped in try-catch to prevent plugin load failure if Faro has issues
// try {
//   await initializeFaroMetrics();
// } catch (e) {
//   console.error('[Faro] Error initializing frontend metrics:', e);
// }

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
    title: 'Interactive features',
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

  // Check for doc query parameter to auto-open specific docs page
  const urlParams = new URLSearchParams(window.location.search);
  const docsParam = urlParams.get('doc');
  const docsPage = docsParam ? findDocPage(docsParam) : null;

  // Warn if docsParam is present but no docsPage is found
  // This can happen for malformed params or unsupported URL formats
  if (docsParam && !docsPage) {
    console.warn(
      'Could not parse doc param:',
      docsParam,
      '- Supported formats: bundled:<id>, interactive-learning.grafana.net/..., /docs/..., https://grafana.com/docs/...'
    );
  }

  if (docsPage) {
    // listen for completion
    window.addEventListener(
      'auto-launch-complete',
      (e) => {
        // remove doc param from URL to prevent re-triggering on refresh
        const url = new URL(window.location.href);
        url.searchParams.delete('doc');
        window.history.replaceState({}, '', url.toString());
      },
      { once: true }
    );

    // Set source for analytics before opening
    sidebarState.setPendingOpenSource('url_param');

    // open the sidebar
    attemptAutoOpen(200);

    // open the docs page once the sidebar is mounted
    window.addEventListener(
      'pathfinder-sidebar-mounted',
      () => {
        setTimeout(() => {
          const autoLaunchEvent = new CustomEvent('auto-launch-tutorial', {
            detail: {
              url: docsPage.url,
              title: docsPage.title,
              type: docsPage.type,
            },
          });
          document.dispatchEvent(autoLaunchEvent);
        }, 500);
      },
      { once: true }
    );
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
      sidebarState.setPendingOpenSource('auto_open');
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
          sidebarState.setPendingOpenSource('auto_open_after_onboarding');
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

      // Track sidebar open via component mount
      // consumePendingOpenSource() returns the source set before opening, or 'sidebar_toggle' as default
      const openSource = sidebarState.consumePendingOpenSource();
      reportAppInteraction(UserInteraction.DocsPanelInteraction, {
        action: 'open',
        source: openSource,
        timestamp: Date.now(),
      });

      // Fire custom event when sidebar component mounts
      const mountEvent = new CustomEvent('pathfinder-sidebar-mounted', {
        detail: {
          timestamp: Date.now(),
        },
      });
      window.dispatchEvent(mountEvent);

      return () => {
        sidebarState.setIsSidebarMounted(false);

        // Track sidebar close via component unmount
        reportAppInteraction(UserInteraction.DocsPanelInteraction, {
          action: 'close',
          source: 'sidebar_toggle',
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
    sidebarState.setPendingOpenSource('command_palette');
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
    sidebarState.setPendingOpenSource('command_palette_help');
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
    sidebarState.setPendingOpenSource('command_palette_learn');
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

interface DocPage {
  type: 'docs-page' | 'learning-journey';
  url: string;
  title: string;
}

/**
 * Finds a docs page or learning-journey rule matching the param (url)
 */
const findDocPage = function (param: string): DocPage | null {
  if (!param || param.trim() === '') {
    return null;
  }

  // Case 1: Bundled interactive
  if (param.startsWith('bundled:')) {
    try {
      const indexData = require('./bundled-interactives/index.json');
      const interactiveId = param.replace('bundled:', '');
      const interactive = indexData?.interactives?.find((item: any) => item.id === interactiveId);

      if (interactive) {
        return {
          type: 'docs-page', // Bundled interactives are essentially learning journeys
          url: param,
          title: interactive.title || interactive.id,
        };
      }
    } catch (e) {
      console.warn('Failed to load bundled interactives index', e);
    }
  }

  // Case 2: Interactive Learning URL
  if (param.includes('interactive-learning.grafana')) {
    // Ensure protocol
    let url = param;
    if (!url.startsWith('http')) {
      url = 'https://' + url;
    }

    // SECURITY: Use validated interactive learning URL check
    if (!isInteractiveLearningUrl(url)) {
      console.warn('Security: Rejected non-interactive-learning URL:', url);
      return null;
    }

    // Basic title extraction from last path segment
    const parts = url.split('/');
    const title = parts[parts.length - 1] || 'Interactive tutorial';

    return {
      type: 'docs-page',
      url: url,
      title: title,
    };
  }

  // Case 3: Check Static Links for curated content (Grafana.com docs)
  // Dynamically load all JSON files from static-links directory
  try {
    const staticLinksContext = (require as any).context('./bundled-interactives/static-links', false, /\.json$/);
    const allFilePaths = staticLinksContext.keys();

    for (const filePath of allFilePaths) {
      const staticData = staticLinksContext(filePath);
      if (staticData && staticData.rules && Array.isArray(staticData.rules)) {
        // Find doc-page or learning-journey that matches the URL exactly
        const rule = staticData.rules.find(
          (r: { type: string; url: string; title: string }) =>
            (r.type === 'docs-page' || r.type === 'learning-journey') && r.url === `https://grafana.com${param}`
        );
        if (rule) {
          return rule;
        }
      }
    }
  } catch (error) {
    console.error('Failed to load static links:', error);
  }

  // Case 4: Any Grafana docs URL (fallback for non-curated content)
  // Supports paths like /docs/grafana/latest/... or full URLs like https://grafana.com/docs/...
  // Also supports /tutorials/ and /learning-journeys/ paths
  const isPathOnly =
    param.startsWith('/docs/') || param.startsWith('/tutorials/') || param.includes('/learning-journeys/');
  const isFullGrafanaUrl = param.startsWith('https://grafana.com/') || param.startsWith('https://docs.grafana.com/');

  if (isPathOnly || isFullGrafanaUrl) {
    // Construct full URL for validation
    const fullUrl = param.startsWith('https://') ? param : `https://grafana.com${param}`;

    // SECURITY: Validate using isGrafanaDocsUrl which checks:
    // 1. Hostname is in ALLOWED_GRAFANA_DOCS_HOSTNAMES (prevents subdomain hijacking)
    // 2. Protocol is https (prevents protocol injection)
    // 3. Path contains valid docs paths (prevents arbitrary URL injection)
    if (!isGrafanaDocsUrl(fullUrl)) {
      console.warn('Security: Rejected non-Grafana docs URL:', fullUrl);
      return null;
    }

    // Extract a human-readable title from the URL path
    // e.g., /docs/loki/latest/configure/storage/ -> "Storage - Loki"
    const pathSegments = param
      .replace(/^https:\/\/[^/]+/, '')
      .split('/')
      .filter(Boolean);
    const titleSegments = pathSegments.slice(1); // Remove 'docs'/'tutorials' prefix

    // Find the product name (usually second segment after 'docs')
    const product = titleSegments[0] || 'Grafana';

    // Get the last meaningful segment as the page title
    // Filter out version segments like 'latest', 'next', 'v10.0', etc.
    const meaningfulSegments = titleSegments.filter(
      (seg) => !['latest', 'next'].includes(seg) && !/^v?\d+(\.\d+)*$/.test(seg)
    );
    const pageTitle = meaningfulSegments[meaningfulSegments.length - 1] || 'Documentation';

    // Format title: capitalize and replace hyphens with spaces
    const formatTitle = (str: string): string => str.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

    const title = `${formatTitle(pageTitle)} - ${formatTitle(product)} Docs`;

    return {
      type: 'docs-page',
      url: fullUrl,
      title: title,
    };
  }

  return null;
};

/**
 * Attempts to auto-open the sidebar with configured tutorial
 * This is extracted as a function so it can be called both on init and after navigation
 */
const attemptAutoOpen = (delay = 200) => {
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
