import React, { lazy, Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ThemeContext } from '@grafana/data';
import { config, locationService } from '@grafana/runtime';
import { CombinedLearningJourneyPanel } from '../docs-panel/docs-panel';
import { consumePendingGuideOnMount } from '../docs-panel/pendingGuideRouter';
import { useContentReset, useAutoOpenListener } from '../docs-panel/hooks';
import { useKeyboardShortcuts } from '../docs-panel/keyboard-shortcuts.hook';
import { hasOnlyNonContentTabs, isNonContentTab } from '../docs-panel/utils';
import { PathfinderFeatureProvider } from '../OpenFeatureProvider';
import { useGuideProgressState, useAutoLaunchTutorial, useStepProgressFromEvents } from '../../hooks';
import { panelModeManager, type PanelMode } from '../../global-state/panel-mode';
import { sidebarState } from '../../global-state/sidebar';
import { getConfigWithDefaults, PLUGIN_BASE_URL, ROUTES } from '../../constants';
import { reportAppInteraction, UserInteraction, AnalyticsContentType } from '../../lib/analytics';
import { PANEL_MODE_CHANGE_EVENT, REQUEST_FLOATING_GUIDE_EVENT } from '../../lib/event-names';
import { buildFullScreenRouteUrl } from '../../utils/pathfinder-search-params';
import { FloatingPanel } from './FloatingPanel';
import { FloatingPanelContent } from './FloatingPanelContent';
import { SkeletonLoader } from '../SkeletonLoader';

// Lazy-loaded so the editor only ships when the user actually pops it out.
const BlockEditor = lazy(() =>
  import('../block-editor').then((module) => ({
    default: module.BlockEditor,
  }))
);

const EDITOR_FLOATING_TITLE = 'Guide editor';

/**
 * Root manager for the floating panel.
 *
 * Mounted into document.body via createCompatRoot (like KioskModeManager).
 * Listens for panel mode changes and renders/hides the floating panel.
 * Creates its own CombinedLearningJourneyPanel model instance.
 */
export function FloatingPanelManager() {
  const [mode, setMode] = useState<PanelMode>(() => panelModeManager.getMode());
  const theme = useGrafanaTheme();

  // Listen for mode changes
  useEffect(() => {
    const handleModeChange = (e: CustomEvent<{ mode: PanelMode }>) => {
      setMode(e.detail.mode);
    };

    document.addEventListener(PANEL_MODE_CHANGE_EVENT, handleModeChange as EventListener);
    return () => {
      document.removeEventListener(PANEL_MODE_CHANGE_EVENT, handleModeChange as EventListener);
    };
  }, []);

  // Re-sync from the singleton on a floating launch. A quiet transient-Back exit
  // (#1448) clears the session without emitting PANEL_MODE_CHANGE_EVENT, so our
  // cached mode can be stale-'fullscreen' while getMode() has reverted to a
  // persisted 'floating'. Without this, the next floating launch's
  // REQUEST_FLOATING_GUIDE_EVENT fires into a void — FloatingPanelInner (its only
  // listener) is unmounted — and the guide is stranded. Re-deriving here remounts
  // the inner, which then consumes the pending guide on mount (a no-op when the
  // cached mode already matches).
  useEffect(() => {
    const resync = () => setMode(panelModeManager.getMode());
    document.addEventListener(REQUEST_FLOATING_GUIDE_EVENT, resync);
    return () => {
      document.removeEventListener(REQUEST_FLOATING_GUIDE_EVENT, resync);
    };
  }, []);

  if (mode !== 'floating') {
    return null;
  }

  return (
    <ThemeContext.Provider value={theme}>
      <PathfinderFeatureProvider>
        <FloatingPanelInner />
      </PathfinderFeatureProvider>
    </ThemeContext.Provider>
  );
}

function useGrafanaTheme() {
  const [theme, setTheme] = useState(() => config.theme2);

  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === 'class') {
          if (config.theme2 !== theme) {
            setTheme(config.theme2);
          }
          break;
        }
      }
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [theme]);

  return theme;
}

/**
 * Inner component that creates the model and renders the floating panel.
 * Only mounted when mode is 'floating'.
 */
function FloatingPanelInner() {
  // Note: usePluginContext() and useUserStorage() are NOT available here.
  // This component is rendered in a standalone React root (createCompatRoot)
  // outside Grafana's plugin context provider tree. Read config from the
  // global set by module.tsx instead.

  const panel = useMemo(() => {
    const globalConfig = (window as any).__pathfinderPluginConfig;
    const config = getConfigWithDefaults(globalConfig || {});
    return new CombinedLearningJourneyPanel(config);
  }, []); // Config is read from window global, stable for the session

  // Track whether a guide open is in-flight (pending guide consumed or auto-launch received).
  // Prevents the fallback from firing before the guide has loaded.
  const guideOpenInFlightRef = useRef(false);

  // Fire panel-mounted event so auto-launch and MCP flows work
  useEffect(() => {
    // Catch the synchronous `pathfinder-auto-launch-pending` signal — it fires
    // within the same microtask as pathfinder-panel-mounted, preventing the
    // fallback-to-sidebar effect from racing the 500ms delayed auto-launch emit.
    const handlePending = () => {
      guideOpenInFlightRef.current = true;
    };
    document.addEventListener('pathfinder-auto-launch-pending', handlePending, { once: true });

    document.dispatchEvent(new CustomEvent('pathfinder-panel-mounted', { detail: { timestamp: Date.now() } }));
    sidebarState.setIsSidebarMounted(true);

    // Handoff from HomePanel's occupied-sidebar launch path (and any other
    // setPendingGuide caller targeting the floating surface): consume the
    // pending guide and mark the open in-flight BEFORE the restoration and
    // empty-state-fallback effects below can run. Mirrors FullScreenPanel.
    consumePendingGuideOnMount(panel, 'floating_panel_dock', () => {
      guideOpenInFlightRef.current = true;
    });

    return () => {
      document.removeEventListener('pathfinder-auto-launch-pending', handlePending);
      // Only clear if we're still the active owner — during dock-back the
      // sidebar's ContextSidebar mounts in a separate React root and may
      // have already set the flag to true before this cleanup runs.
      if (panelModeManager.getMode() !== 'sidebar') {
        sidebarState.setIsSidebarMounted(false);
      }
    };
  }, [panel]);

  // A launch targeting an already-mounted floating panel changes no mode, so
  // the mount effect above never re-runs — HomePanel signals with this event
  // instead. Consume-once semantics make double delivery with the mount path
  // safe: whichever consumer runs first gets the guide, the other a null.
  useEffect(() => {
    const handleRequestGuide = () => {
      consumePendingGuideOnMount(panel, 'floating_panel_dock', () => {
        guideOpenInFlightRef.current = true;
      });
    };
    document.addEventListener(REQUEST_FLOATING_GUIDE_EVENT, handleRequestGuide);
    return () => {
      document.removeEventListener(REQUEST_FLOATING_GUIDE_EVENT, handleRequestGuide);
    };
  }, [panel]);

  // Restore tabs from storage on mount (same as CombinedPanelRendererInner).
  // This handles the page-refresh case where mode is persisted but guide state
  // lives in tabStorage.
  const { tabs, activeTabId } = panel.useState();
  const [restorationDone, setRestorationDone] = useState(false);

  useEffect(() => {
    // Read live model state instead of closure'd `tabs`: the pending-guide
    // consumption in the mount effect above mutates `panel.state.tabs`
    // synchronously in the same commit, before this render's snapshot
    // updates — restoring on top of the just-opened guide would await
    // tabStorage and clobber it. Mirrors FullScreenPanel's gate.
    // Only restore when no content tabs are open (editor chrome alone is OK).
    const liveTabs = panel.state.tabs;
    const restore = hasOnlyNonContentTabs(liveTabs) ? panel.restoreTabsAsync() : Promise.resolve();
    restore.then(() => setRestorationDone(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Flip the in-flight flag synchronously so the empty-state fallback doesn't
  // fire on top of an incoming guide.
  const markGuideOpenInFlight = useCallback(() => {
    guideOpenInFlightRef.current = true;
  }, []);
  useAutoLaunchTutorial(panel, { onIncoming: markGuideOpenInFlight });
  // Receive intercepted docs links while the floating panel owns the surface
  // (#1450). Mode-gated to 'floating' so a dock-back can't double-open.
  useAutoOpenListener(panel, 'floating');

  // Get active tab content
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const isEditorTab = activeTab?.type === 'editor';
  const content = activeTab?.content ?? null;
  const title = isEditorTab ? EDITOR_FLOATING_TITLE : activeTab?.title || 'Interactive learning';
  // hasActiveGuide drives the dock pill pulse and step-progress polling. Chrome
  // tabs (recommendations, Dev Tools, editor) are not guides.
  const hasActiveGuide = activeTab != null && !isNonContentTab(activeTab);

  // Track interactive step progress via the `pathfinder-step-progress`
  // event — shared subscription with FullScreenPanel via the hook.
  const stepProgress = useStepProgressFromEvents(hasActiveGuide);

  // After restoration completes, if there's no guide to show and none
  // is being loaded, fall back to sidebar mode. The editor tab counts as
  // valid floating content, so don't fall back when it's active.
  useEffect(() => {
    if (restorationDone && !hasActiveGuide && !isEditorTab && !guideOpenInFlightRef.current) {
      panelModeManager.setMode('sidebar');
    }
  }, [restorationDone, hasActiveGuide, isEditorTab]);

  const { hasInteractiveProgress, progressKey } = useGuideProgressState(activeTab);

  const handleResetGuide = useContentReset({ model: panel });

  useKeyboardShortcuts({
    tabs,
    activeTabId,
    activeTab: activeTab ?? null,
    isRecommendationsTab: activeTab?.type === 'recommendations',
    model: panel,
  });
  // Prefer `currentUrl` (the milestone the user is reading) so when the user
  // goes from floating → fullscreen via `handleSwitchToFullScreen`, or copies
  // a shareable link, the milestone position carries through. `baseUrl` is
  // the cover URL; for non-journey tabs the two fields are equal.
  const guideUrl = isEditorTab ? undefined : activeTab?.currentUrl || activeTab?.baseUrl;

  // The pill is a deliberate sidebar ADOPTION → persist; the programmatic dock
  // request (guide `popout`, generic toggle) is not → conditional `setMode`, so
  // an automatic launch never overwrites the stored preference. Rationale in
  // docs/design/PANEL-MODE-PERSISTENCE.md (decisions 2 and 3); mechanics in
  // global-state/panel-mode.ts.
  const dockToSidebar = useCallback(
    (persist: boolean) => {
      reportAppInteraction(UserInteraction.FloatingPanelDock, {
        guide_url: guideUrl || '',
        guide_title: title,
      });
      if (persist) {
        panelModeManager.setModePersisted('sidebar');
      } else {
        panelModeManager.setMode('sidebar');
      }
      sidebarState.setPendingOpenSource('floating_panel_dock', 'open');
      sidebarState.openSidebar('Interactive learning');
    },
    [guideUrl, title]
  );

  const handleSwitchToSidebar = useCallback(() => {
    dockToSidebar(true);
  }, [dockToSidebar]);

  // Symmetric counterpart to `pathfinder-request-pop-out` (see docs-panel.tsx).
  // Dispatched by the popout interactive action so that guides can programmatically
  // dock the floating panel back into the sidebar.
  useEffect(() => {
    const handleDockRequest = () => {
      dockToSidebar(false);
    };
    document.addEventListener('pathfinder-request-dock', handleDockRequest);
    return () => {
      document.removeEventListener('pathfinder-request-dock', handleDockRequest);
    };
  }, [dockToSidebar]);

  const handleClose = useCallback(() => {
    panelModeManager.setMode('sidebar');
  }, []);

  const handleSwitchToFullScreen = useCallback(() => {
    // Editor: no guide URL — set a pending editor handoff so the receiving
    // panel switches its active tab to the editor even when fullscreen is
    // already mounted (e.g. journey was in fullscreen and the user wants
    // the editor to replace it).
    if (isEditorTab) {
      reportAppInteraction(UserInteraction.FullScreenEnter, {
        guide_url: '',
        guide_title: title,
        source: 'floating_panel',
        content_type: AnalyticsContentType.Editor,
      });
      // Remember where the user was so explicit Exit can land back there.
      panelModeManager.capturePriorPath(window.location.pathname + window.location.search);
      panelModeManager.setPendingGuide({ title, type: 'editor' });
      panelModeManager.setModePersisted('fullscreen');
      locationService.push(`${PLUGIN_BASE_URL}/${ROUTES.FullScreen}`);
      return;
    }
    if (!guideUrl) {
      return;
    }
    reportAppInteraction(UserInteraction.FullScreenEnter, {
      guide_url: guideUrl,
      guide_title: title,
      source: 'floating_panel',
    });
    // Preserve the journey type through the handoff so the milestone
    // toolbar renders on the full screen page.
    const tabType = activeTab?.type === 'learning-journey' ? 'learning-journey' : 'docs';
    panelModeManager.setPendingGuide({
      url: guideUrl,
      title,
      type: tabType,
      // Forward synthetic packageInfo (e.g. PR-tester journeys backed by
      // raw GitHub URLs) so the full-screen page rebuilds the milestone
      // toolbar on the other side of the handoff.
      packageInfo: activeTab?.packageInfo,
    });
    // Remember where the user was so explicit Exit can land back there.
    panelModeManager.capturePriorPath(window.location.pathname + window.location.search);
    panelModeManager.setModePersisted('fullscreen');
    // Include type in the URL so refresh/share rehydrates as a journey
    // even if findDocPage's URL-based classification can't tell.
    locationService.push(
      buildFullScreenRouteUrl({
        pluginBaseUrl: PLUGIN_BASE_URL,
        fullScreenRoute: ROUTES.FullScreen,
        doc: guideUrl,
        guideType: tabType,
      })
    );
  }, [isEditorTab, guideUrl, title, activeTab?.type, activeTab?.packageInfo]);

  // Symmetric counterpart to the sidebar's `pathfinder-request-full-screen`
  // listener — lets surface-aware components (notably the BlockEditor toolbar)
  // ask floating to hand off to fullscreen without knowing about the panel
  // internals.
  useEffect(() => {
    const handleFullScreenRequest = () => {
      handleSwitchToFullScreen();
    };
    document.addEventListener('pathfinder-request-full-screen', handleFullScreenRequest);
    return () => {
      document.removeEventListener('pathfinder-request-full-screen', handleFullScreenRequest);
    };
  }, [handleSwitchToFullScreen]);

  // The editor tab is also a valid full-screen target even though it isn't
  // a guide. Show the button for guides AND the editor.
  const canSwitchToFullScreen = hasActiveGuide || isEditorTab;
  // Threaded through to the share-link builder so a copied floating link
  // includes `type=learning-journey` for journey tabs (the receiving panel
  // misclassifies package URLs as 'interactive' otherwise).
  const guideType: 'learning-journey' | 'docs' | undefined = hasActiveGuide
    ? activeTab?.type === 'learning-journey'
      ? 'learning-journey'
      : 'docs'
    : undefined;

  return (
    <FloatingPanel
      title={title}
      hasActiveGuide={hasActiveGuide}
      guideUrl={guideUrl}
      guideType={guideType}
      stepProgress={stepProgress}
      onSwitchToSidebar={handleSwitchToSidebar}
      onSwitchToFullScreen={canSwitchToFullScreen ? handleSwitchToFullScreen : undefined}
      onClose={handleClose}
    >
      {isEditorTab ? (
        <Suspense fallback={<SkeletonLoader type="documentation" />}>
          <BlockEditor />
        </Suspense>
      ) : (
        <FloatingPanelContent
          content={content}
          pendingAlignment={activeTab?.pendingAlignment}
          onAlignmentConfirm={activeTab ? () => void panel.confirmAlignment(activeTab.id) : undefined}
          onAlignmentCancel={activeTab ? () => panel.dismissAlignment(activeTab.id) : undefined}
          activeTab={activeTab ?? null}
          model={panel}
          hasInteractiveProgress={hasInteractiveProgress}
          progressKey={progressKey}
          onResetGuide={handleResetGuide}
        />
      )}
    </FloatingPanel>
  );
}
