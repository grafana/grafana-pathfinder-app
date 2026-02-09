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
import {
  initializeOpenFeature,
  getFeatureFlagValue,
  getExperimentConfig,
  ExperimentConfig,
  matchPathPattern,
} from './utils/openfeature';
import { PathfinderFeatureProvider } from './components/OpenFeatureProvider';
import { StorageKeys } from './lib/user-storage';
import {
  createExperimentDebugger,
  logExperimentConfig,
  shouldAutoOpenForPath,
  markParentAutoOpened,
  markGlobalAutoOpened,
  syncExperimentStateFromUserStorage,
  resetExperimentState,
} from './utils/experiment-debug';

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

// Evaluate A/B experiment config at module load time
// GOFF returns an object with { variant, pages, resetCache }:
// - variant "excluded": Not in experiment, normal Pathfinder behavior (sidebar available)
// - variant "control": In experiment, no sidebar (native Grafana help only)
// - variant "treatment": In experiment, sidebar auto-opens on target pages
// - pages: Array of page path prefixes where auto-open should trigger (treatment only)
// - resetCache: When toggled true, clears session storage to allow sidebar to auto-open again
const experimentConfig: ExperimentConfig = getExperimentConfig('pathfinder.experiment-variant');
const experimentVariant = experimentConfig.variant;

// Expose experiment debugging utilities on window.__pathfinderExperiment
createExperimentDebugger(experimentConfig);

// Check for manual pop-open reset via resetCache field in experiment config
// This allows operators to clear the "Clippy protection" via GOFF
// Uses localStorage to track if the reset has been processed (persists across sessions)
// Only resets when resetCache transitions from false → true (not on every page load while true)
const hostname = window.location.hostname;
const resetProcessedKey = `${StorageKeys.EXPERIMENT_RESET_PROCESSED_PREFIX}${hostname}`;
const resetProcessed = localStorage.getItem(resetProcessedKey);

if (experimentConfig.resetCache) {
  // resetCache is true - check if we've already processed this reset
  if (resetProcessed !== 'true') {
    // First time seeing resetCache as true - reset experiment state and mark as processed
    // This clears both sessionStorage and Grafana user storage
    resetExperimentState(hostname).catch((error) => {
      console.warn('[Pathfinder] Failed to reset experiment state:', error);
    });
    localStorage.setItem(resetProcessedKey, 'true');

    console.log('[Pathfinder] Pop-open reset triggered: cleared auto-open tracking in all storages');
  }
} else {
  // resetCache is false - reset the processed marker so next true triggers a reset
  if (resetProcessed === 'true') {
    localStorage.setItem(resetProcessedKey, 'false');
  }
}
const targetPages = experimentConfig.pages;

// Sync experiment state from Grafana user storage to sessionStorage
// This restores auto-open tracking from previous sessions/browsers
// Fire and forget - don't block module initialization
syncExperimentStateFromUserStorage(hostname, targetPages).catch((error) => {
  console.warn('[Pathfinder] Failed to sync experiment state from user storage:', error);
});

// Log experiment config for debugging (warning level so it's visible)
logExperimentConfig(experimentConfig);

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

    // Set source for analytics before opening (auto-open from URL param)
    sidebarState.setPendingOpenSource('url_param', 'auto-open');

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
  // - treatment: auto-open on target pages from GOFF config (or all pages if no target specified)
  // - excluded: use normal behavior (respect sessionStorage and config settings)
  // - control: no sidebar is registered, skip auto-open entirely
  const featureFlagEnabled = getFeatureFlagValue('pathfinder.auto-open-sidebar', false);
  const isTreatment = experimentVariant === 'treatment';
  const isExcluded = experimentVariant === 'excluded';

  // Check if current page matches any target page from GOFF config (treatment only)
  const location = locationService.getLocation();
  const currentPath = location.pathname || window.location.pathname || '';
  const isTargetPage =
    targetPages.length === 0 || targetPages.some((targetPath) => matchPathPattern(targetPath, currentPath));

  // Determine if we should auto-open:
  // - Treatment group: auto-open on target pages
  // - Excluded group: use normal auto-open behavior (respects config/flags)
  // - Control group: no sidebar, no auto-open
  const shouldAutoOpen =
    (isTreatment && isTargetPage) || (isExcluded && (featureFlagEnabled || config.openPanelOnLaunch));

  // Auto-open panel if enabled
  if (shouldAutoOpen) {
    // Include hostname to make this unique per Grafana instance
    const hostname = window.location.hostname;
    // Global session key for excluded variant (once per session globally)
    // Global session key for excluded variant (once per session globally)
    // Uses module-level hostname for consistency
    const sessionKey = `${StorageKeys.EXPERIMENT_SESSION_AUTO_OPENED_PREFIX}${hostname}`;

    const isOnboardingFlow = currentPath.includes('/a/grafana-setupguide-app/onboarding-flow');
    const hasAutoOpened = sessionStorage.getItem(sessionKey);

    // For treatment: check per-page (once per target page pattern)
    // For excluded: check global (once per session)
    const matchingPattern = isTreatment ? shouldAutoOpenForPath(hostname, targetPages, currentPath) : null;
    const shouldOpenNow = isTreatment ? matchingPattern !== null : !hasAutoOpened;

    // Auto-open immediately if not on onboarding flow
    // Skip if sidebar is already in use by another plugin (e.g., Assistant)
    // Don't mark storage when skipping - try again next session
    if (shouldOpenNow && !isOnboardingFlow) {
      if (isSidebarAlreadyInUse()) {
        console.log('[Pathfinder] Skipping auto-open: sidebar already in use by another plugin');
      } else {
        if (isTreatment && matchingPattern) {
          markParentAutoOpened(hostname, matchingPattern);
        } else if (!isTreatment) {
          markGlobalAutoOpened(hostname);
        }
        sidebarState.setPendingOpenSource(isTreatment ? 'experiment_treatment' : 'auto_open', 'auto-open');
        attemptAutoOpen(200);
      }
    }

    // If user starts on onboarding flow, listen for navigation away from it
    if ((isTreatment || !hasAutoOpened) && isOnboardingFlow) {
      const checkLocationChange = () => {
        const newLocation = locationService.getLocation();
        const newPath = newLocation.pathname || window.location.pathname || '';
        const stillOnOnboarding = newPath.includes('/a/grafana-setupguide-app/onboarding-flow');
        const alreadyOpened = sessionStorage.getItem(sessionKey);

        // For treatment: check per-page tracking
        // For excluded: check global tracking
        const newMatchingPattern = isTreatment ? shouldAutoOpenForPath(hostname, targetPages, newPath) : null;
        const shouldOpenAfterOnboarding = isTreatment ? newMatchingPattern !== null : !alreadyOpened;

        // If we've left onboarding and should open, do it now
        // Skip if sidebar is already in use - don't mark storage, try next session
        if (!stillOnOnboarding && shouldOpenAfterOnboarding) {
          if (isSidebarAlreadyInUse()) {
            console.log('[Pathfinder] Skipping auto-open after onboarding: sidebar already in use');
          } else {
            if (isTreatment && newMatchingPattern) {
              markParentAutoOpened(hostname, newMatchingPattern);
            } else if (!isTreatment) {
              markGlobalAutoOpened(hostname);
            }
            sidebarState.setPendingOpenSource(
              isTreatment ? 'experiment_treatment_after_onboarding' : 'auto_open_after_onboarding',
              'auto-open'
            );
            attemptAutoOpen(500);
          }
        }
      };

      document.addEventListener('grafana:location-changed', checkLocationChange);

      try {
        const history = locationService.getHistory();
        if (history) {
          const unlisten = history.listen(checkLocationChange);
          (window as any).__pathfinderAutoOpenUnlisten = unlisten;
        }
      } catch (error) {
        window.addEventListener('popstate', checkLocationChange);
      }
    }
  }

  // Treatment variant: If user starts on a non-target page, listen for navigation to target pages
  // This ensures auto-open triggers when they navigate to a target page (e.g., from home to Synthetic Monitoring)
  // Uses per-page tracking: auto-opens once per target page pattern, not globally
  if (isTreatment && !isTargetPage && targetPages.length > 0) {
    const hostname = window.location.hostname;

    const checkNavigationToTargetPage = () => {
      const newLocation = locationService.getLocation();
      const newPath = newLocation.pathname || window.location.pathname || '';

      // Check if new path matches a target page that hasn't auto-opened yet
      const matchingPattern = shouldAutoOpenForPath(hostname, targetPages, newPath);

      // Skip if sidebar is already in use - don't mark as opened, try next session
      if (matchingPattern) {
        if (isSidebarAlreadyInUse()) {
          console.log('[Pathfinder] Skipping auto-open on navigation: sidebar already in use');
        } else {
          markParentAutoOpened(hostname, matchingPattern);
          sidebarState.setPendingOpenSource('experiment_treatment_navigation', 'auto-open');
          attemptAutoOpen(300);
        }
      }
    };

    // Listen for Grafana location changes
    document.addEventListener('grafana:location-changed', checkNavigationToTargetPage);

    // Also listen via locationService history API
    try {
      const history = locationService.getHistory();
      if (history) {
        const unlisten = history.listen(checkNavigationToTargetPage);
        (window as any).__pathfinderTreatmentNavUnlisten = unlisten;
      }
    } catch (error) {
      window.addEventListener('popstate', checkNavigationToTargetPage);
    }
  }
};

export { plugin };

// Register sidebar for everyone EXCEPT control group
// - excluded: normal behavior (sidebar available)
// - control: no sidebar (native Grafana help only)
// - treatment: sidebar + auto-open on target pages
if (experimentVariant !== 'control') {
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
          <Suspense fallback={<LoadingPlaceholder text="" />}>
            <LazyMemoizedContextPanel />
          </Suspense>
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
 * Checks if any extension sidebar is already open/docked in Grafana
 * This prevents Pathfinder from forcefully taking over when another plugin (like Assistant) is in use
 *
 * @returns true if a sidebar is already docked/open, false otherwise
 */
const isSidebarAlreadyInUse = (): boolean => {
  try {
    return localStorage.getItem('grafana.navigation.extensionSidebarDocked') !== null;
  } catch {
    // localStorage might be unavailable in some contexts
    return false;
  }
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
