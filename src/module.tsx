import {
  AppPlugin,
  AppPluginMeta,
  type AppRootProps,
  PluginExtensionPoints,
  BusEventWithPayload,
  usePluginContext,
} from '@grafana/data';
import { LoadingPlaceholder } from '@grafana/ui';
import { getAppEvents } from '@grafana/runtime';
import React, { Suspense, lazy, useEffect, useMemo } from 'react';
import { reportAppInteraction, UserInteraction } from './lib/analytics';
import { initPluginTranslations } from '@grafana/i18n';
import pluginJson from './plugin.json';
import { getConfigWithDefaults, ALLOWED_GITHUB_REPOS, DocsPluginConfig } from './constants';
import {
  isAllowedContentUrl,
  isAllowedGitHubRawUrl,
  isGitHubUrl,
  isGitHubRawUrl,
  isLocalhostUrl,
} from './utils/url-validator';
import { isDevModeEnabledGlobal } from './utils/dev-mode';

// Persistent queue for docs links clicked before sidebar opens
interface QueuedDocsLink {
  url: string;
  title: string;
  timestamp: number;
}

// Global queue accessible from anywhere
export const pendingDocsQueue: QueuedDocsLink[] = [];

// Initialize translations
await initPluginTranslations(pluginJson.id);

// SECURITY: Dev mode is initialized lazily when user visits config with ?dev=true
// This avoids unnecessary API calls for anonymous users who can't use dev mode anyway

// Global link interceptor state
let isInterceptorInitialized = false;
let isInterceptionEnabled = false;
let isSidebarMounted = false;

// Pure JavaScript global click handler (runs outside React lifecycle)
function initializeGlobalLinkInterceptor() {
  if (isInterceptorInitialized) {
    return;
  }

  const handleGlobalClick = (event: MouseEvent) => {
    // Only intercept if feature is enabled
    if (!isInterceptionEnabled) {
      return;
    }

    // Only intercept left-click without modifiers
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return;
    }

    const target = event.target as HTMLElement;
    const anchor = target.closest('a[href]') as HTMLAnchorElement;

    if (!anchor) {
      return;
    }

    const href = anchor.getAttribute('href');
    if (!href) {
      return;
    }

    // Skip if link is inside Pathfinder content
    if (anchor.closest('[data-pathfinder-content]')) {
      return;
    }

    // Resolve full URL
    let fullUrl: string;
    try {
      if (href.startsWith('http://') || href.startsWith('https://')) {
        fullUrl = href;
      } else if (href.startsWith('#')) {
        return;
      } else {
        // Absolute path (starts with /) or relative path - resolve against current location
        // This ensures self-hosted instances resolve to their own domain, not grafana.com
        fullUrl = new URL(href, window.location.href).href;
      }
    } catch (error) {
      return;
    }

    // SECURITY (F6): Check if it's a supported docs URL using secure validation
    // Must match the same validation as content-fetcher, docs-panel, link-handler, and global-link-interceptor
    // In production: Grafana docs URLs and approved GitHub repos
    // In dev mode: Also allows any GitHub URLs and localhost URLs for testing
    const isValidUrl =
      isAllowedContentUrl(fullUrl) ||
      isAllowedGitHubRawUrl(fullUrl, ALLOWED_GITHUB_REPOS) ||
      isGitHubUrl(fullUrl) ||
      (isDevModeEnabledGlobal() && (isLocalhostUrl(fullUrl) || isGitHubRawUrl(fullUrl)));

    if (!isValidUrl) {
      return;
    }

    // Prevent default and intercept
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    // Extract title from URL
    const extractTitle = (url: string): string => {
      try {
        const urlObj = new URL(url);
        const pathSegments = urlObj.pathname.split('/').filter(Boolean);
        if (pathSegments.length > 0) {
          const lastSegment = pathSegments[pathSegments.length - 1];
          return lastSegment
            .split('-')
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
        }
        return 'Documentation';
      } catch {
        return 'Documentation';
      }
    };

    const title = extractTitle(fullUrl);

    // If sidebar is already mounted, dispatch immediately
    if (isSidebarMounted) {
      const autoOpenEvent = new CustomEvent('pathfinder-auto-open-docs', {
        detail: {
          url: fullUrl,
          title,
          origin: 'global_link_interceptor_immediate',
        },
      });
      document.dispatchEvent(autoOpenEvent);
    } else {
      // Sidebar not mounted - add to queue and open sidebar
      pendingDocsQueue.push({
        url: fullUrl,
        title,
        timestamp: Date.now(),
      });

      // Open sidebar
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
        console.error('Failed to open sidebar:', error);
      }
    }
  };

  // Add global listener at document level
  document.addEventListener('click', handleGlobalClick, { capture: true });
  isInterceptorInitialized = true;
}

// Function to enable/disable interception
export function setGlobalLinkInterceptionEnabled(enabled: boolean) {
  isInterceptionEnabled = enabled;

  // Initialize interceptor on first enable
  if (enabled && !isInterceptorInitialized) {
    initializeGlobalLinkInterceptor();
  }
}

// Function to track sidebar mount state
export function setSidebarMounted(mounted: boolean) {
  isSidebarMounted = mounted;
}

// Initialize the interceptor immediately at module load
// It starts disabled and will be enabled when config is loaded
initializeGlobalLinkInterceptor();

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
      setGlobalLinkInterceptionEnabled(config.interceptGlobalDocsLinks);
    }, [config.interceptGlobalDocsLinks]);

    // Process queued docs links when sidebar mounts
    useEffect(() => {
      // Mark sidebar as mounted
      setSidebarMounted(true);

      // Report sidebar opened
      reportAppInteraction(UserInteraction.DocsPanelInteraction, {
        action: 'open',
        source: 'sidebar_mount',
        timestamp: Date.now(),
      });

      // Process any queued docs links after a short delay to ensure panel is ready
      setTimeout(() => {
        if (pendingDocsQueue.length > 0) {
          // Process all queued links
          while (pendingDocsQueue.length > 0) {
            const queuedLink = pendingDocsQueue.shift();
            if (queuedLink) {
              const autoOpenEvent = new CustomEvent('pathfinder-auto-open-docs', {
                detail: {
                  url: queuedLink.url,
                  title: queuedLink.title,
                  origin: 'queued_link',
                },
              });
              document.dispatchEvent(autoOpenEvent);
            }
          }
        }
      }, 200);

      return () => {
        // Mark sidebar as unmounted
        setSidebarMounted(false);

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

    openExtensionSidebar(pluginJson.id, 'Interactive learning', {
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

    openExtensionSidebar(pluginJson.id, 'Interactive learning', {
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

    openExtensionSidebar(pluginJson.id, 'Interactive learning', {
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
