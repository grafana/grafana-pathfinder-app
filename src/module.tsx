import { AppPlugin, AppPluginMeta, type AppRootProps, PluginExtensionPoints, usePluginContext } from '@grafana/data';
import { locationService } from '@grafana/runtime';
import React, { lazy, useEffect, useMemo } from 'react';
import { reportAppInteraction, UserInteraction } from './lib/analytics';
import AppComponent from './components/App/App';

// TODO: Re-enable Faro once collector CORS is configured correctly
// import { initializeFaroMetrics } from './lib/faro';
import { initPluginTranslations } from '@grafana/i18n';
import pluginJson from './plugin.json';
import { getConfigWithDefaults, DocsPluginConfig, PLUGIN_BASE_URL } from './constants';
import { linkInterceptionState } from './global-state/link-interception';
import { sidebarState } from 'global-state/sidebar';
import { isGrafanaDocsUrl, isInteractiveLearningUrl, validateRedirectPath } from './security';
import { initializeOpenFeature } from './utils/openfeature';
import { PathfinderFeatureProvider } from './components/OpenFeatureProvider';
import {
  initializeExperiments,
  shouldMountSidebar,
  setupMainExperimentAutoOpen,
  attemptAutoOpen,
  getAutoOpenFeatureFlag,
  getCurrentPath,
  createExperimentDebugger,
} from './utils/experiments';
import MemoizedContextPanel from './components/App/ContextPanel';

// TODO: Re-enable Faro once collector CORS is configured correctly
// Initialize Faro metrics (before translations to capture early errors)
// Wrapped in try-catch to prevent plugin load failure if Faro has issues
// try {
//   await initializeFaroMetrics();
// } catch (e) {
//   console.error('[Faro] Error initializing frontend metrics:', e);
// }

// Initialize OpenFeature provider for dynamic feature flag evaluation
// This connects to the Multi-Tenant Feature Flag Service (MTFF) in Grafana Cloud
// Uses top-level await to ensure flags are ready before evaluation
try {
  await initializeOpenFeature();
} catch (e) {
  console.error('[OpenFeature] Error initializing feature flags:', e);
}

// Initialize experiments and get state
const experimentState = initializeExperiments();
const { mainConfig, mainVariant, after24hVariant } = experimentState;

// Expose experiment debugging utilities on window.__pathfinderExperiment
createExperimentDebugger(mainConfig);

// Check if Pathfinder was already docked (browser restore scenario)
try {
  const dockedValue = localStorage.getItem('grafana.navigation.extensionSidebarDocked');
  if (dockedValue) {
    let isPathfinderDocked = false;
    try {
      const parsedValue = JSON.parse(dockedValue);
      isPathfinderDocked =
        parsedValue.pluginId === pluginJson.id || parsedValue.componentTitle === 'Interactive learning';
    } catch {
      // Fallback for older Grafana versions that might store a simple string
      isPathfinderDocked = dockedValue === pluginJson.id || dockedValue === 'Interactive learning';
    }
    if (isPathfinderDocked) {
      sidebarState.setPendingOpenSource('browser_restore', 'restore');
    }
  }
} catch {
  // localStorage might be unavailable
}

// Initialize translations
await initPluginTranslations(pluginJson.id);

const LazyAppConfig = lazy(() => import('./components/AppConfig/AppConfig'));
const LazyTermsAndConditions = lazy(() => import('./components/AppConfig/TermsAndConditions'));
const LazyInteractiveFeatures = lazy(() => import('./components/AppConfig/InteractiveFeatures'));

const App = (props: AppRootProps) => <AppComponent {...props} />;

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
  const pageParam = urlParams.get('page');
  const docsPage = docsParam ? findDocPage(docsParam) : null;

  // Determine redirect target (only when doc param is present)
  // Priority: explicit page param > bundled guide target > /
  // SECURITY: page is only processed when doc is also present,
  // preventing the plugin page from becoming a general-purpose redirector
  const redirectTarget = docsParam ? validateRedirectPath(pageParam || docsPage?.targetPage || PLUGIN_BASE_URL) : null;

  // Warn if docsParam is present but no docsPage is found
  // This can happen for malformed params or unsupported URL formats
  if (docsParam && !docsPage) {
    console.warn(
      'Could not parse doc param:',
      docsParam,
      '- Supported formats: bundled:<id>, interactive-learning.grafana.net/..., /docs/..., https://grafana.com/docs/...'
    );
    // Redirect to home and open sidebar to Recommendations
    // This gives the user a useful landing instead of a dead plugin page
    sidebarState.setPendingOpenSource('url_param', 'auto-open');
    attemptAutoOpen(200);
    // Navigate away from the dead plugin page
    setTimeout(() => {
      locationService.replace('/');
    }, 300);
  }

  if (docsPage) {
    const needsRedirect = redirectTarget && redirectTarget !== window.location.pathname;

    // Set source for analytics before opening (auto-open from URL param)
    sidebarState.setPendingOpenSource('url_param', 'auto-open');

    if (needsRedirect) {
      // Redirect FIRST so the center console renders the target page
      // before the sidebar opens and the guide content fetch begins.
      // Using replace() avoids a back-button loop.
      locationService.replace(redirectTarget);
      // Longer delay: let the new page render before opening sidebar
      attemptAutoOpen(500);
    } else {
      // No redirect needed -- strip doc/page params and open sidebar normally
      const url = new URL(window.location.href);
      url.searchParams.delete('doc');
      url.searchParams.delete('page');
      window.history.replaceState({}, '', url.toString());
      attemptAutoOpen(200);
    }

    // Dispatch auto-launch-tutorial so docs-panel opens the guide.
    // Wrapped in a helper so it can fire from the mount listener OR immediately.
    const dispatchAutoLaunch = () => {
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
    };

    // Launch the guide once the sidebar is mounted on the (possibly new) page.
    // Window event listeners survive client-side route changes, so this works
    // regardless of whether a redirect occurred above.
    window.addEventListener('pathfinder-sidebar-mounted', dispatchAutoLaunch, { once: true });

    // Race-condition guard: if the sidebar was already docked from a previous
    // session, its component mounts before init() runs, so the mount event
    // fires before the listener above is registered.  Detect this by checking
    // the global sidebar state and dispatch immediately.
    if (sidebarState.getIsSidebarMounted()) {
      // Remove the listener we just added — we don't need it.
      window.removeEventListener('pathfinder-sidebar-mounted', dispatchAutoLaunch);
      dispatchAutoLaunch();
    }
  }

  // Get current path for auto-open logic
  const currentPath = getCurrentPath();

  // Setup main experiment auto-open logic
  setupMainExperimentAutoOpen(experimentState, {
    currentPath,
    featureFlagEnabled: getAutoOpenFeatureFlag(),
    pluginConfig: config,
  });
};

export { plugin };

// Register sidebar for everyone EXCEPT control groups from EITHER experiment
// - excluded: normal behavior (sidebar available)
// - control: no sidebar (native Grafana help only)
// - treatment: sidebar + auto-open (on target pages for main experiment, for 24h+ users for after-24h experiment)
if (shouldMountSidebar(mainVariant, after24hVariant)) {
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
        // consumePendingOpenSource() returns { source, action } set before opening
        const { source, action } = sidebarState.consumePendingOpenSource();

        reportAppInteraction(UserInteraction.DocsPanelInteraction, {
          action,
          source,
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
          });
        };
      }, []);

      return (
        <PathfinderFeatureProvider>
          <MemoizedContextPanel />
        </PathfinderFeatureProvider>
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
}

interface DocPage {
  type: 'docs-page' | 'learning-journey';
  url: string;
  title: string;
  /** Optional target page path for deep link redirect (e.g., /explore) */
  targetPage?: string;
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
          targetPage: Array.isArray(interactive.url) ? interactive.url[0] : undefined,
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
  // Also supports /tutorials/, /docs/learning-journeys/ (legacy), and /docs/learning-paths/ paths
  const isPathOnly =
    param.startsWith('/docs/') ||
    param.startsWith('/tutorials/') ||
    param.startsWith('/docs/learning-journeys/') ||
    param.startsWith('/docs/learning-paths/');
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
