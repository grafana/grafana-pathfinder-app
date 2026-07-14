import { AppPlugin, AppPluginMeta, type AppRootProps, PluginExtensionPoints, usePluginContext } from '@grafana/data';
import { getAppEvents } from '@grafana/runtime';
import React, { lazy, Suspense, useEffect, useMemo } from 'react';
import { LoadingPlaceholder } from '@grafana/ui';
import { reportAppInteraction, UserInteraction } from './lib/analytics';
import { logger } from './lib/logging';
import { initPluginTranslations } from '@grafana/i18n';
import pluginJson from './plugin.json';
import { getConfigWithDefaults, DocsPluginConfig } from './constants';
import { linkInterceptionState } from './global-state/link-interception';
import { sidebarState } from 'global-state/sidebar';
import { panelModeManager } from './global-state/panel-mode';
import { suggestionState } from './global-state/suggestion';
import { handlePathfinderDeepLink, installDeepLinkNavListener } from './utils/pathfinder-deep-link-handler';
import { parseControllerPairingHash, parsePathfinderDeepLink } from './utils/pathfinder-search-params';
import {
  clearExtensionSidebarDocked,
  isExtensionSidebarOwnedByPathfinder,
  parseExtensionSidebarDocked,
} from './lib/storage/extension-sidebar';
import { PANEL_MODE_CHANGE_EVENT } from './lib/event-names';

// Buffer pathfinder-suggest events that arrive before async init completes.
// Registered synchronously (before any await) so events from faster-loading
// apps are never lost. Replayed or discarded after experiment state is known.
const pendingSuggestEvents: CustomEvent[] = [];
const earlySuggestListener = ((event: CustomEvent) => {
  pendingSuggestEvents.push(event);
}) as EventListener;
document.addEventListener('pathfinder-suggest', earlySuggestListener);

// Every top-level await below stays inside a try block: a rejected top-level
// await fails module evaluation and Grafana reports "Could not load plugin",
// killing Pathfinder for the whole session (enforced by
// src/validation/module-bootstrap.test.ts). Each block degrades independently
// so an unrelated chunk failure can't take down flag evaluation.
let openfeature: typeof import('./utils/openfeature') | null = null;
let bootstrapError: { error: unknown; source: string } | null = null;

// OpenFeature provider for dynamic feature flag evaluation via the
// Multi-Tenant Feature Flag Service (MTFF) in Grafana Cloud.
try {
  openfeature = await import('./utils/openfeature');
  await openfeature.initializeOpenFeature();

  // Late-bind the active-experiments provider to analytics (breaks the static import chain)
  const { bindExperimentsProvider } = await import('./lib/analytics');
  bindExperimentsProvider(openfeature.getActiveExperiments);
} catch (e) {
  bootstrapError = { error: e, source: 'OpenFeature init' };
  logger.exception(e, { source: 'OpenFeature init' });
}

// Highlighted-guide experiment + config-driven auto-open (dynamic imports keep
// zod/user-storage out of module.js). On chunk-load failure the experiment and
// auto-open are skipped for the session.
let bootstrap: {
  experiments: typeof import('./utils/experiments');
  sidebarAutoOpen: typeof import('./utils/sidebar-auto-open');
} | null = null;
try {
  const [experiments, sidebarAutoOpen] = await Promise.all([
    import('./utils/experiments'),
    import('./utils/sidebar-auto-open'),
  ]);
  bootstrap = { experiments, sidebarAutoOpen };
} catch (e) {
  bootstrapError = { error: e, source: 'Bootstrap chunk load' };
  logger.exception(e, { source: 'Bootstrap chunk load' });
}

const flagValue = (flag: string, defaultValue: boolean): boolean =>
  openfeature ? openfeature.getFeatureFlagValue(flag, defaultValue) : defaultValue;

// Deep links must still open the sidebar when the sidebar-auto-open chunk
// failed to load; mirrors attemptAutoOpen using only static imports.
const fallbackAttemptAutoOpen = (delay = 200): void => {
  setTimeout(() => {
    try {
      getAppEvents().publish({
        type: 'open-extension-sidebar',
        payload: { pluginId: pluginJson.id, componentTitle: 'Interactive learning' },
      });
    } catch (error) {
      logger.error('Failed to auto-open Interactive learning panel', { error });
    }
  }, delay);
};

// The pathfinder.enabled kill-switch gates whether Pathfinder mounts. Best-effort:
// it fails open to its default when the flag chunk itself cannot load.
const pathfinderEnabled = flagValue('pathfinder.enabled', true);
const hostname = window.location.hostname;

// Faro frontend telemetry, behind its own remote kill-switch — default-on, so
// a missing flag means enabled; initFaro itself enforces the Grafana Cloud-only
// gate. Init is eager (not awaited — the SDK chunk must not block boot); the
// beforeSend activity gate in lib/faro drops all telemetry until Pathfinder
// is open in one of its surfaces.
try {
  if (flagValue('pathfinder.frontend-telemetry', true)) {
    const { initFaro } = await import('./lib/faro');
    initFaro()
      .then(() => {
        // Replay the boot failure into Faro — at catch time pushFaroError was
        // a no-op because Faro wasn't initialized yet.
        if (bootstrapError) {
          logger.exception(bootstrapError.error, { source: bootstrapError.source });
        }
      })
      .catch((e) => logger.exception(e, { source: 'Faro init' }));
  }
} catch (e) {
  logger.exception(e, { source: 'Faro init' });
}

// Initialize highlighted-guide experiment (reads flag, processes resetCache).
// The popout half is set up later, after the sidebar-mount decision, so it
// short-circuits when Pathfinder is dismounted.
const highlightedGuideConfig = bootstrap ? bootstrap.experiments.initializeHighlightedGuideExperiment(hostname) : null;

if (bootstrap && highlightedGuideConfig) {
  bootstrap.experiments.createExperimentDebugger(highlightedGuideConfig);
}

// Check if Pathfinder was already docked (browser restore scenario).
// If floating mode is active, clear the docked state so Grafana doesn't
// auto-open the sidebar on page load — the floating panel handles display.
if (isExtensionSidebarOwnedByPathfinder(pluginJson.id, 'Interactive learning')) {
  const persistedMode = panelModeManager.getMode();
  if (persistedMode === 'floating' || persistedMode === 'fullscreen') {
    // Don't restore sidebar — another presentation surface owns the panel
    clearExtensionSidebarDocked();
  } else {
    sidebarState.setPendingOpenSource('browser_restore', 'restore');
  }
}

// Guarded: a rejected top-level await fails plugin load; t() falls back to
// default messages when init is skipped.
try {
  await initPluginTranslations(pluginJson.id);
} catch (e) {
  logger.exception(e, { source: 'i18n init' });
}

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

// Claims the container id synchronously, before any dynamic import, so a
// second plugin.init (or a repeated mode-change event) can't race past the
// guard and double-mount.
function claimContainer(id: string): HTMLElement | null {
  if (document.getElementById(id)) {
    return null;
  }
  const container = document.createElement('div');
  container.id = id;
  document.body.appendChild(container);
  return container;
}

plugin.init = function (meta: AppPluginMeta<DocsPluginConfig>) {
  const jsonData = meta?.jsonData || {};
  const config = getConfigWithDefaults(jsonData);
  linkInterceptionState.setInterceptionEnabled(config.interceptGlobalDocsLinks);

  (window as any).__pathfinderPluginConfig = config;

  // Snapshotted before handlePathfinderDeepLink strips it from the URL.
  const { doc: docsParam, controller: controllerParam } = parsePathfinderDeepLink(window.location.search);
  const controllerPairing = parseControllerPairingHash(window.location.hash);
  if (controllerPairing && window.location.hash) {
    const cleanUrl = new URL(window.location.href);
    cleanUrl.hash = '';
    window.history.replaceState(window.history.state, document.title, cleanUrl.toString());
  }

  // Interactive controller (?doc=<guide>&controller=1): the same overlay, but
  // step actions stay visible so this tab can drive the originating Grafana tab.
  // Gated on the enableTwoTabController admin setting and pathfinder.enabled — the
  // controller drives the user's authenticated Grafana, so it must not mount when
  // the plugin is disabled or the instance hasn't opted in.
  if (config.enableTwoTabController && docsParam && controllerParam && controllerPairing && pathfinderEnabled) {
    const container = claimContainer('pathfinder-controller-root');
    if (container) {
      import('./components/guide-reader/GuideReaderOverlay')
        .then(async ({ GuideReaderOverlay }) => {
          const { createCompatRoot } = await import('./lib/create-root-compat');
          const root = await createCompatRoot(container);
          root.render(
            React.createElement(GuideReaderOverlay, { doc: docsParam, mode: 'controller', controllerPairing })
          );
        })
        .catch((err) => {
          logger.error('[Pathfinder] Failed to load interactive controller', { error: err });
          container.remove();
        });
    }
    return;
  }

  // Live tab only (the controller tab returned early above): load the cross-tab
  // executor so a controller tab can drive this Grafana DOM. Mount the pairing
  // banner first so its challenge listener is live before the transport starts.
  if (config.enableTwoTabController && pathfinderEnabled) {
    const bannerContainer = claimContainer('pathfinder-pairing-banner-root');
    if (bannerContainer) {
      Promise.all([import('./integrations/cross-tab/PairingRequestBanner'), import('./lib/create-root-compat')])
        .then(async ([{ PairingRequestBanner }, { createCompatRoot }]) => {
          const root = await createCompatRoot(bannerContainer);
          root.render(React.createElement(PairingRequestBanner));
        })
        .catch((err) => {
          logger.error('[Pathfinder] Failed to load pairing banner', { error: err });
          bannerContainer.remove();
        });
    }
    import('./integrations/cross-tab/live-tab-executor')
      .then(({ installLiveTabExecutor }) => installLiveTabExecutor())
      .catch((err) => logger.error('[Pathfinder] Failed to load cross-tab executor', { error: err }));
  }

  const sidebarMountable = pathfinderEnabled;
  const deepLinkDeps = {
    shouldMountSidebar: sidebarMountable,
    attemptAutoOpen: bootstrap?.sidebarAutoOpen.attemptAutoOpen ?? fallbackAttemptAutoOpen,
    loadControlGroupDocPopup: () => import('./components/ControlGroupDocPopup'),
  };

  handlePathfinderDeepLink(deepLinkDeps);
  // Re-runs on SPA navigations; plugin.init fires only once per session.
  installDeepLinkNavListener(deepLinkDeps);

  // Control group + ?doc=: ControlGroupDocPopup already handled it.
  // Don't widen to panelMode/kiosk — those must reach the mount blocks below.
  if (docsParam && !sidebarMountable) {
    return;
  }

  // Mount kiosk mode overlay manager if enabled and no ?doc= param
  // (skip kiosk in tabs opened via tile deep links so the overlay doesn't reappear)
  if (config.enableKioskMode && !docsParam) {
    (window as any).__pathfinderKioskConfig = { rulesUrl: config.kioskRulesUrl };
    document.dispatchEvent(new CustomEvent('pathfinder-kiosk-ready'));

    const kioskContainer = claimContainer('pathfinder-kiosk-root');
    if (kioskContainer) {
      import('./components/kiosk/KioskModeManager')
        .then(async ({ KioskModeManager }) => {
          const { createCompatRoot } = await import('./lib/create-root-compat');
          const root = await createCompatRoot(kioskContainer);
          root.render(
            React.createElement(KioskModeManager, {
              rulesUrl: config.kioskRulesUrl,
            })
          );
        })
        .catch((err) => {
          logger.error('[Pathfinder] Failed to load kiosk mode', { error: err });
          kioskContainer.remove();
        });
    }
  }

  // Mount floating panel manager — only eagerly when floating mode is already
  // active (page refresh or ?panelMode=floating). For sidebar→floating transitions
  // at runtime, a mode-change listener lazily loads and mounts the manager.
  // This avoids unconditional chunk loads that prevent networkidle on older Grafana.
  if (pathfinderEnabled) {
    const mountFloatingPanel = () => {
      const container = claimContainer('pathfinder-floating-root');
      if (!container) {
        return;
      }
      import('./components/floating-panel/FloatingPanelManager')
        .then(async ({ FloatingPanelManager }) => {
          const { createCompatRoot } = await import('./lib/create-root-compat');
          const root = await createCompatRoot(container);
          root.render(React.createElement(FloatingPanelManager));
        })
        .catch((err) => {
          logger.error('[Pathfinder] Failed to load floating panel', { error: err });
          container.remove();
        });
    };

    if (panelModeManager.getMode() === 'floating') {
      mountFloatingPanel();
    }

    document.addEventListener(PANEL_MODE_CHANGE_EVENT, ((e: CustomEvent<{ mode: string }>) => {
      if (e.detail.mode === 'floating') {
        mountFloatingPanel();
      }
    }) as EventListener);
  }

  // Skip auto-open when a ?doc= param is present — the doc-param handler (async
  // import above) owns sidebar opening and may redirect first. Running auto-open
  // here would evaluate against the pre-redirect path.
  if (!docsParam && pathfinderEnabled && bootstrap) {
    const currentPath = bootstrap.sidebarAutoOpen.getCurrentPath();
    bootstrap.sidebarAutoOpen.setupConfigAutoOpen({
      currentPath,
      featureFlagEnabled: bootstrap.sidebarAutoOpen.getAutoOpenFeatureFlag(),
      pluginConfig: config,
    });
    if (highlightedGuideConfig) {
      bootstrap.experiments.setupHighlightedGuideAutoOpen(highlightedGuideConfig, currentPath, hostname);
    }
  }
};

export { plugin };

// Register the sidebar unless the pathfinder.enabled kill-switch is off.
if (pathfinderEnabled) {
  plugin.addComponent({
    targets: `grafana/extension-sidebar/v0-alpha`,
    title: 'Interactive learning',
    description: 'Opens Interactive learning',
    component: function ContextSidebar() {
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

      useEffect(() => {
        sidebarState.setIsSidebarMounted(true);

        const { source, action } = sidebarState.consumePendingOpenSource();

        reportAppInteraction(UserInteraction.DocsPanelInteraction, {
          action,
          source,
        });

        const mountEvent = new CustomEvent('pathfinder-sidebar-mounted', {
          detail: {
            timestamp: Date.now(),
          },
        });
        window.dispatchEvent(mountEvent);

        return () => {
          sidebarState.setIsSidebarMounted(false);

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
    handlePathfinderSuggest(event);
  }) as EventListener;
  document.removeEventListener('pathfinder-suggest', earlySuggestListener);
  document.addEventListener('pathfinder-suggest', realSuggestHandler);

  for (const buffered of pendingSuggestEvents) {
    if (buffered.detail) {
      buffered.detail._buffered = true;
    }
    handlePathfinderSuggest(buffered);
  }
  pendingSuggestEvents.length = 0;
} else {
  // Control group: discard buffered events and remove early listener
  document.removeEventListener('pathfinder-suggest', earlySuggestListener);
  pendingSuggestEvents.length = 0;
}

/**
 * Handles external app suggestion events to open the sidebar with featured content.
 * Sets detail.status ('accepted' | 'rejected') and detail.reason so the caller
 * can read the result synchronously after dispatchEvent returns.
 *
 * The "already opened" flag is deferred until the sidebar actually mounts
 * (via the pathfinder-sidebar-mounted event) so the flag is never burned
 * if the sidebar fails to open for any reason.
 */
function handlePathfinderSuggest(event: CustomEvent): void {
  const detail = event.detail;
  if (!detail) {
    logger.warn('[Pathfinder] pathfinder-suggest event missing detail');
    return;
  }
  if (!Array.isArray(detail.suggestions)) {
    logger.warn('[Pathfinder] pathfinder-suggest event missing suggestions array');
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
    logger.warn('[Pathfinder] pathfinder-suggest event had no valid suggestions (need title + url)');
    detail.status = 'rejected';
    detail.reason = 'no_valid_suggestions';
    return;
  }

  // Check if another plugin is occupying the sidebar
  const docked = parseExtensionSidebarDocked();
  if (docked?.pluginId && docked.pluginId !== pluginJson.id) {
    logger.warn('[Pathfinder] pathfinder-suggest rejected: sidebar occupied by', { pluginId: docked.pluginId });
    detail.status = 'rejected';
    detail.reason = 'sidebar_in_use';
    return;
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
