import { AppPlugin, AppPluginMeta, type AppRootProps, PluginExtensionPoints } from '@grafana/data';
import React, { lazy, Suspense, useEffect } from 'react';
import { LoadingPlaceholder } from '@grafana/ui';
import { reportAppInteraction, UserInteraction } from './lib/analytics';
import { logger } from './lib/logging';
import { initPluginTranslations } from '@grafana/i18n';
import pluginJson from './plugin.json';
import { DocsPluginConfig } from './constants';
// Direct file import, not the ./hooks barrel: the barrel would pull every hook
// (and zod, via user-storage) into module.js.
import { publishPathfinderPluginConfig, refreshPathfinderPluginConfig } from './hooks/usePathfinderPluginConfig';
import { PANEL_MODE_CHANGE_EVENT } from './lib/event-names';
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
// Surgical import (not the ./lib/telemetry barrel): module.tsx is the entry
// point, and the barrel would pull the whole telemetry package into module.js.
import { reportPathfinderSurface, reportPathfinderSurfaceClosed } from './lib/telemetry/surface';

// Buffer pathfinder-suggest events that arrive before async init completes.
// Registered synchronously (before any await) so events from faster-loading
// apps are never lost. Replayed or discarded after experiment state is known.
const pendingSuggestEvents: CustomEvent[] = [];
const earlySuggestListener = ((event: CustomEvent) => {
  pendingSuggestEvents.push(event);
}) as EventListener;
document.addEventListener('pathfinder-suggest', earlySuggestListener);

// Initialize OpenFeature provider for dynamic feature flag evaluation
// This connects to the Multi-Tenant Feature Flag Service (MTFF) in Grafana Cloud
// Uses dynamic import so the SDK stays out of the entry-point bundle
try {
  const { initializeOpenFeature } = await import('./utils/openfeature');
  await initializeOpenFeature();

  // Late-bind the active-experiments provider to analytics (breaks the static import chain)
  const { getActiveExperiments } = await import('./utils/experiments/active-experiments');
  const { bindExperimentsProvider } = await import('./lib/analytics');
  bindExperimentsProvider(getActiveExperiments);
} catch (e) {
  logger.exception(e, { source: 'OpenFeature init' });
}

// Highlighted-guide experiment + config-driven auto-open (dynamic imports keep
// zod/user-storage out of module.js).
const {
  createExperimentDebugger,
  enrollInteractiveLearningBannerExperiment,
  initializeHighlightedGuideExperiment,
  setupHighlightedGuideAutoOpen,
} = await import('./utils/experiments');
const { attemptAutoOpen, getAutoOpenFeatureFlag, getCurrentPath, setupConfigAutoOpen } =
  await import('./utils/sidebar-auto-open');
const { getFeatureFlagValue, getNumberFlagValue } = await import('./utils/openfeature');

// The pathfinder.enabled kill-switch is the only gate on whether Pathfinder mounts.
const pathfinderEnabled = getFeatureFlagValue('pathfinder.enabled', true);
const hostname = window.location.hostname;

// Faro frontend telemetry, behind its own remote kill-switch — default-on, so
// a missing flag means enabled; initFaro itself enforces the Grafana Cloud-only
// gate. Init is eager (not awaited — the SDK chunk must not block boot); the
// beforeSend activity gate in lib/faro drops all telemetry until Pathfinder
// is open in one of its surfaces.
try {
  if (getFeatureFlagValue('pathfinder.frontend-telemetry', true)) {
    // Session enrichment (identity, surface, experiment cohorts) is owned by initFaro.
    const { initFaro, resolveSessionReplayOptions } = await import('./lib/faro');
    // Session replay is a second remote switch on top — also default-on, so a
    // missing flag means recording. It captures the whole page, masked, from
    // the first time Pathfinder is opened. The rate is a volume dial on top of
    // the switch, range-checked in lib/telemetry/replay. Both are read once,
    // here: a later flip reaches a tab only on its next load.
    initFaro(
      resolveSessionReplayOptions(
        getFeatureFlagValue('pathfinder.session-replay', true),
        getNumberFlagValue('pathfinder.session-replay-sampling-rate', 1)
      )
    ).catch((e) => logger.exception(e, { source: 'Faro init' }));
  }
} catch (e) {
  logger.exception(e, { source: 'Faro init' });
}

// Initialize highlighted-guide experiment (reads flag, processes resetCache).
// The popout half is set up later, after the sidebar-mount decision, so it
// short-circuits when Pathfinder is dismounted.
const highlightedGuideConfig = initializeHighlightedGuideExperiment(hostname);

createExperimentDebugger(highlightedGuideConfig);

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
  // Everything here must stay synchronous. `AppPlugin.init` is typed `void` and
  // Grafana never awaits it, so work behind an await would run after first paint
  // — after scene construction has already read the published config, and after
  // the deep-link and link-interception listeners needed to exist.
  const config = publishPathfinderPluginConfig(meta?.jsonData || {});
  linkInterceptionState.setInterceptionEnabled(config.interceptGlobalDocsLinks);

  // `meta.jsonData` can lag a recent save. Re-publish from the authoritative
  // read when it lands; subscribers pick it up via the config-updated event.
  void refreshPathfinderPluginConfig().then((refreshed) => {
    if (refreshed) {
      linkInterceptionState.setInterceptionEnabled(refreshed.interceptGlobalDocsLinks);
    }
  });

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
    if (!document.getElementById('pathfinder-controller-root')) {
      // Claim the id synchronously, before the dynamic import, so a second
      // plugin.init can't race past the guard and double-mount.
      const container = document.createElement('div');
      container.id = 'pathfinder-controller-root';
      document.body.appendChild(container);
      reportPathfinderSurface('controller');
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
    if (!document.getElementById('pathfinder-pairing-banner-root')) {
      const bannerContainer = document.createElement('div');
      bannerContainer.id = 'pathfinder-pairing-banner-root';
      document.body.appendChild(bannerContainer);
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
    attemptAutoOpen,
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
          logger.error('[Pathfinder] Failed to load kiosk mode', { error: err });
        });
    }
  }

  // Mount floating panel manager — only eagerly when floating mode is already
  // active (page refresh or ?panelMode=floating). For sidebar→floating transitions
  // at runtime, a mode-change listener lazily loads and mounts the manager.
  // This avoids unconditional chunk loads that prevent networkidle on older Grafana.
  if (pathfinderEnabled) {
    const mountFloatingPanel = () => {
      if (document.getElementById('pathfinder-floating-root')) {
        return;
      }
      import('./components/floating-panel/FloatingPanelManager')
        .then(async ({ FloatingPanelManager }) => {
          if (document.getElementById('pathfinder-floating-root')) {
            return;
          }
          const { createCompatRoot } = await import('./lib/create-root-compat');
          const container = document.createElement('div');
          container.id = 'pathfinder-floating-root';
          document.body.appendChild(container);
          const root = await createCompatRoot(container);
          root.render(React.createElement(FloatingPanelManager));
        })
        .catch((err) => {
          logger.error('[Pathfinder] Failed to load floating panel', { error: err });
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
  if (!docsParam && pathfinderEnabled) {
    const currentPath = getCurrentPath();
    setupConfigAutoOpen({
      currentPath,
      featureFlagEnabled: getAutoOpenFeatureFlag(),
      pluginConfig: config,
    });
    setupHighlightedGuideAutoOpen(highlightedGuideConfig, currentPath, hostname);
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
      // Process queued docs links when sidebar mounts
      useEffect(() => {
        sidebarState.setIsSidebarMounted(true);
        // The docked sidebar opens via Grafana's extension bus, not setMode —
        // this mount is the only reliable "sidebar is active" signal.
        reportPathfinderSurface('sidebar');

        // Enrollment is deliberately here and not at boot: reading the flag emits the
        // exposure event, so this seam is what makes it mean "first sidebar open".
        // The Faro session was stamped at initFaro, before any arm was known, so
        // re-stamp to add this cohort. Dynamic import keeps faro-adapter out of module.js.
        enrollInteractiveLearningBannerExperiment();
        void import('./lib/telemetry/session')
          .then(({ stampSessionExperiments }) => stampSessionExperiments())
          .catch((e) => logger.exception(e, { source: 'Session experiment re-stamp' }));

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
          // Only clear the shared mounted flag if the sidebar is still the
          // active surface. During a sidebar → floating/fullscreen transition
          // `setMode` has already committed the new mode and the incoming
          // surface's mount effect (a separate React root) may have set the
          // flag true before this cleanup runs; clobbering it would strand the
          // link-interception and HomePanel gates thinking no Pathfinder
          // surface is up. Mirrors FloatingPanelManager / FullScreenPanel.
          if (panelModeManager.getMode() === 'sidebar') {
            sidebarState.setIsSidebarMounted(false);
          }
          reportPathfinderSurfaceClosed('sidebar');

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
