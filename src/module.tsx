import { AppPlugin, AppPluginMeta, type AppRootProps, PluginExtensionPoints, usePluginContext } from '@grafana/data';
import { locationService } from '@grafana/runtime';
import React, { lazy, Suspense, useEffect, useMemo } from 'react';
import { LoadingPlaceholder } from '@grafana/ui';
import { reportAppInteraction, UserInteraction } from './lib/analytics';

// TODO: Re-enable Faro once collector CORS is configured correctly
// import { initializeFaroMetrics } from './lib/faro';
import { initPluginTranslations } from '@grafana/i18n';
import pluginJson from './plugin.json';
import { getConfigWithDefaults, DocsPluginConfig, ROUTES } from './constants';
import { linkInterceptionState } from './global-state/link-interception';
import { sidebarState } from 'global-state/sidebar';
import { suggestionState } from './global-state/suggestion';
import { validateRedirectPath } from './security/url-validator';

// Buffer pathfinder-suggest events that arrive before async init completes.
// Registered synchronously (before any await) so events from faster-loading
// apps are never lost. Replayed or discarded after experiment state is known.
const pendingSuggestEvents: CustomEvent[] = [];
const earlySuggestListener = ((event: CustomEvent) => {
  pendingSuggestEvents.push(event);
}) as EventListener;
document.addEventListener('pathfinder-suggest', earlySuggestListener);

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
// Uses dynamic import so the SDK stays out of the entry-point bundle
try {
  const { initializeOpenFeature, getExperimentConfig } = await import('./utils/openfeature');
  await initializeOpenFeature();

  // Late-bind experiment config to analytics (breaks the static import chain)
  const { bindExperimentConfig } = await import('./lib/analytics');
  bindExperimentConfig(getExperimentConfig);
} catch (e) {
  console.error('[OpenFeature] Error initializing feature flags:', e);
}

// Initialize experiments and get state (dynamic import keeps zod/user-storage out of module.js)
const {
  initializeExperiments,
  shouldMountSidebar,
  setupMainExperimentAutoOpen,
  attemptAutoOpen,
  getAutoOpenFeatureFlag,
  getCurrentPath,
  createExperimentDebugger,
} = await import('./utils/experiments');
const experimentState = initializeExperiments();
const { pathfinderEnabled, mainConfig, mainVariant, after24hVariant } = experimentState;

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

const LazyApp = lazy(() => import('./components/App/App'));
const LazyContextPanel = lazy(() => import('./components/App/ContextPanel'));
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

  // Check for doc query parameter to auto-open specific docs page.
  // Dynamically imports findDocPage so the bundled JSON data stays out of module.js.
  //
  // EXCEPTION: When the user is on the /learning route, the MainAreaLearningPanel
  // owns the ?doc= param — skip the sidebar auto-open flow entirely.
  // Uses ROUTES.Learning so that renaming the route updates this guard automatically.
  const isLearningRoute = window.location.pathname.endsWith(`/${ROUTES.Learning}`);
  const urlParams = new URLSearchParams(window.location.search);
  const docsParam = isLearningRoute ? null : urlParams.get('doc');
  const pageParam = urlParams.get('page');
  // Optional source override for analytics — allows callers to identify the origin
  // of a ?doc= deep link (e.g. ?doc=foo&source=learning-hub)
  const sourceParam = urlParams.get('source');

  // Use the source param if provided, otherwise default to 'url_param'
  const docOpenSource = sourceParam || 'url_param';

  if (docsParam && !shouldMountSidebar(pathfinderEnabled, mainVariant, after24hVariant)) {
    const url = new URL(window.location.href);
    url.searchParams.delete('doc');
    url.searchParams.delete('page');
    url.searchParams.delete('source');
    window.history.replaceState({}, '', url.toString());

    import('./components/ControlGroupDocPopup').then(({ showControlGroupDocPopup }) => {
      showControlGroupDocPopup(docOpenSource);
    });
    return;
  }

  if (docsParam) {
    import('./utils/find-doc-page')
      .then(({ findDocPage }) => {
        const docsPage = findDocPage(docsParam);

        // Determine redirect target (only when doc param is present)
        // Only redirect when an explicit page param or bundled guide target is provided.
        // Without one, stay on the current page — the user may be on a specific dashboard
        // and redirecting would break on instances where users aren't logged in (e.g., Play).
        // SECURITY: page is only processed when doc is also present,
        // preventing the plugin page from becoming a general-purpose redirector
        const rawRedirectTarget = pageParam || docsPage?.targetPage;
        const redirectTarget = rawRedirectTarget ? validateRedirectPath(rawRedirectTarget) : null;

        // Warn if docsParam is present but no docsPage is found
        if (!docsPage) {
          console.warn(
            'Could not parse doc param:',
            docsParam,
            '- Supported formats: api:<resourceName>, bundled:<id>, interactive-learning.grafana.net/..., /docs/..., https://grafana.com/docs/...'
          );
          // Strip stale params so they don't re-fire on refresh
          const url = new URL(window.location.href);
          url.searchParams.delete('doc');
          url.searchParams.delete('page');
          url.searchParams.delete('source');
          window.history.replaceState({}, '', url.toString());

          sidebarState.setPendingOpenSource(docOpenSource, 'auto-open');
          attemptAutoOpen(200);
          return;
        }

        const needsRedirect = redirectTarget && redirectTarget !== window.location.pathname;

        sidebarState.setPendingOpenSource(docOpenSource, 'auto-open');

        if (needsRedirect) {
          locationService.replace(redirectTarget);
          attemptAutoOpen(500);
        } else {
          const url = new URL(window.location.href);
          url.searchParams.delete('doc');
          url.searchParams.delete('page');
          url.searchParams.delete('source');
          window.history.replaceState({}, '', url.toString());
          attemptAutoOpen(200);
        }

        const dispatchAutoLaunch = () => {
          setTimeout(() => {
            const autoLaunchEvent = new CustomEvent('auto-launch-tutorial', {
              detail: {
                url: docsPage.url,
                title: docsPage.title,
                type: docsPage.type,
                source: docOpenSource,
              },
            });
            document.dispatchEvent(autoLaunchEvent);
          }, 500);
        };

        window.addEventListener('pathfinder-sidebar-mounted', dispatchAutoLaunch, { once: true });

        if (sidebarState.getIsSidebarMounted()) {
          window.removeEventListener('pathfinder-sidebar-mounted', dispatchAutoLaunch);
          dispatchAutoLaunch();
        }
      })
      .catch((err) => {
        console.error('[Pathfinder] Failed to load find-doc-page chunk:', err);
        sidebarState.setPendingOpenSource(docOpenSource, 'auto-open');
        attemptAutoOpen(200);
        setTimeout(() => {
          locationService.replace('/');
        }, 300);
      });
  }

  // Mount kiosk mode overlay manager if enabled and no ?doc= param
  // (skip kiosk in tabs opened via tile deep links so the overlay doesn't reappear)
  if (config.enableKioskMode && !docsParam) {
    (window as any).__pathfinderKioskConfig = { rulesUrl: config.kioskRulesUrl };
    document.dispatchEvent(new CustomEvent('pathfinder-kiosk-ready'));

    if (!document.getElementById('pathfinder-kiosk-root')) {
      import('./components/kiosk/KioskModeManager')
        .then(async ({ KioskModeManager }) => {
          if (document.getElementById('pathfinder-kiosk-root')) {
            return;
          }
          const { createCompatRoot } = await import('./lib/create-root-compat');
          const container = document.createElement('div');
          container.id = 'pathfinder-kiosk-root';
          document.body.appendChild(container);
          const root = await createCompatRoot(container);
          root.render(
            React.createElement(KioskModeManager, {
              rulesUrl: config.kioskRulesUrl,
            })
          );
        })
        .catch((err) => {
          console.error('[Pathfinder] Failed to load kiosk mode:', err);
        });
    }
  }

  // Skip experiment auto-open when a ?doc= param is present — the doc-param
  // handler (async import above) owns sidebar opening and may redirect first.
  // Running the experiment here would evaluate against the pre-redirect path.
  if (!docsParam && pathfinderEnabled) {
    const currentPath = getCurrentPath();
    setupMainExperimentAutoOpen(experimentState, {
      currentPath,
      featureFlagEnabled: getAutoOpenFeatureFlag(),
      pluginConfig: config,
    });
  }
};

export { plugin };

// Register sidebar for everyone EXCEPT control groups from EITHER experiment
// - excluded: normal behavior (sidebar available)
// - control: no sidebar (native Grafana help only)
// - treatment: sidebar + auto-open (on target pages for main experiment, for 24h+ users for after-24h experiment)
if (shouldMountSidebar(pathfinderEnabled, mainVariant, after24hVariant)) {
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
        <Suspense fallback={<LoadingPlaceholder text="" />}>
          <LazyContextPanel />
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

  // Swap in the real suggest handler and replay any buffered events
  const realSuggestHandler = ((event: CustomEvent) => {
    handlePathfinderSuggest(event, after24hVariant);
  }) as EventListener;
  document.removeEventListener('pathfinder-suggest', earlySuggestListener);
  document.addEventListener('pathfinder-suggest', realSuggestHandler);

  for (const buffered of pendingSuggestEvents) {
    if (buffered.detail) {
      buffered.detail._buffered = true;
    }
    handlePathfinderSuggest(buffered, after24hVariant);
  }
  pendingSuggestEvents.length = 0;
} else {
  // Control group: discard buffered events and remove early listener
  document.removeEventListener('pathfinder-suggest', earlySuggestListener);
  pendingSuggestEvents.length = 0;
}

// ============================================================================
// PATHFINDER-SUGGEST EVENT HANDLER
// ============================================================================

/**
 * Handles external app suggestion events to open the sidebar with featured content.
 * Sets detail.status ('accepted' | 'rejected') and detail.reason so the caller
 * can read the result synchronously after dispatchEvent returns.
 *
 * The "already opened" flag is deferred until the sidebar actually mounts
 * (via the pathfinder-sidebar-mounted event) so the flag is never burned
 * if the sidebar fails to open for any reason.
 */
function handlePathfinderSuggest(event: CustomEvent, experimentVariant: string): void {
  const detail = event.detail;
  if (!detail) {
    console.warn('[Pathfinder] pathfinder-suggest event missing detail');
    return;
  }
  if (!Array.isArray(detail.suggestions)) {
    console.warn('[Pathfinder] pathfinder-suggest event missing suggestions array');
    detail.status = 'rejected';
    detail.reason = 'invalid_payload';
    return;
  }

  const valid = detail.suggestions.filter(
    (s: unknown) =>
      s &&
      typeof s === 'object' &&
      typeof (s as Record<string, unknown>).title === 'string' &&
      typeof (s as Record<string, unknown>).url === 'string'
  );

  if (valid.length === 0) {
    console.warn('[Pathfinder] pathfinder-suggest event had no valid suggestions (need title + url)');
    detail.status = 'rejected';
    detail.reason = 'no_valid_suggestions';
    return;
  }

  // Check if another plugin is occupying the sidebar
  try {
    const dockedValue = localStorage.getItem('grafana.navigation.extensionSidebarDocked');
    if (dockedValue) {
      let dockedPluginId: string | undefined;
      try {
        dockedPluginId = JSON.parse(dockedValue)?.pluginId;
      } catch {
        // Older Grafana versions may store a plain string
      }

      if (dockedPluginId && dockedPluginId !== pluginJson.id) {
        console.warn('[Pathfinder] pathfinder-suggest rejected: sidebar occupied by', dockedPluginId);
        detail.status = 'rejected';
        detail.reason = 'sidebar_in_use';
        return;
      }
    }
  } catch {
    // localStorage unavailable -- proceed optimistically
  }

  const buffered = detail._buffered === true;

  suggestionState.setSuggestions(valid);

  const suggestedTitles = valid.map((s: Record<string, unknown>) => s.title).join(', ');
  const suggestedUrls = valid.map((s: Record<string, unknown>) => s.url).join(', ');

  // If Pathfinder is already docked, just update the featured zone without re-opening
  if (sidebarState.getIsSidebarMounted()) {
    reportAppInteraction(UserInteraction.DocsPanelInteraction, {
      action: 'suggest',
      source: 'external_app',
      suggestion_count: valid.length,
      suggested_titles: suggestedTitles,
      suggested_urls: suggestedUrls,
      sidebar_already_open: true,
      buffered,
    });
    detail.status = 'accepted';
    return;
  }

  // For 24h experiment treatment: only auto-open once, but always store suggestions.
  // Uses localStorage as cache, with Grafana user storage as cross-device source of truth.
  if (experimentVariant === 'treatment') {
    const hostname = window.location.hostname;
    const autoOpenedKey = `grafana-interactive-learning-panel-auto-opened-${hostname}`;
    const alreadyOpened = localStorage.getItem(autoOpenedKey) === 'true';

    if (alreadyOpened) {
      reportAppInteraction(UserInteraction.DocsPanelInteraction, {
        action: 'suggest',
        source: 'external_app',
        suggestion_count: valid.length,
        suggested_titles: suggestedTitles,
        suggested_urls: suggestedUrls,
        sidebar_already_opened_by_experiment: true,
        buffered,
      });
      detail.status = 'accepted';
      detail.reason = 'suggestions_stored_no_reopen';
      return;
    }

    // Defer flag write until sidebar actually mounts — if it never opens
    // the flag stays unset and the next page load can retry.
    window.addEventListener(
      'pathfinder-sidebar-mounted',
      () => {
        localStorage.setItem(autoOpenedKey, 'true');
        import('./lib/user-storage').then(({ experimentAutoOpenStorage }) => {
          experimentAutoOpenStorage.markGlobalAutoOpened().catch(() => {});
        });
      },
      { once: true }
    );
  }

  reportAppInteraction(UserInteraction.DocsPanelInteraction, {
    action: 'suggest',
    source: 'external_app',
    suggestion_count: valid.length,
    suggested_titles: suggestedTitles,
    suggested_urls: suggestedUrls,
    sidebar_already_open: false,
    buffered,
  });
  sidebarState.setPendingOpenSource('external_suggestion', 'auto-open');
  sidebarState.openSidebar('Interactive learning');
  detail.status = 'accepted';
}
