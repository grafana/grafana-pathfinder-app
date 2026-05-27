import React, { lazy, Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ThemeContext } from '@grafana/data';
import { config, locationService } from '@grafana/runtime';
import { CombinedLearningJourneyPanel } from '../docs-panel/docs-panel';
import { useContentReset } from '../docs-panel/hooks';
import { useKeyboardShortcuts } from '../docs-panel/keyboard-shortcuts.hook';
import { openPendingGuide } from '../docs-panel/pendingGuideRouter';
import { PERMANENT_TAB_IDS } from '../docs-panel/utils';
import { PathfinderFeatureProvider } from '../OpenFeatureProvider';
import { useGuideProgressState, useAutoLaunchTutorial, useStepProgressFromEvents } from '../../hooks';
import { panelModeManager, type PanelMode } from '../../global-state/panel-mode';
import { sidebarState } from '../../global-state/sidebar';
import { getConfigWithDefaults, PLUGIN_BASE_URL, ROUTES } from '../../constants';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
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

    document.addEventListener('pathfinder-panel-mode-change', handleModeChange as EventListener);
    return () => {
      document.removeEventListener('pathfinder-panel-mode-change', handleModeChange as EventListener);
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
    // Catch the synchronous signal from module.tsx's dispatchAutoLaunch —
    // this fires within the same microtask as pathfinder-panel-mounted,
    // preventing the fallback-to-sidebar effect from racing the 500ms
    // delayed auto-launch-tutorial event.
    const handlePending = () => {
      guideOpenInFlightRef.current = true;
    };
    document.addEventListener('pathfinder-auto-launch-pending', handlePending, { once: true });

    document.dispatchEvent(new CustomEvent('pathfinder-panel-mounted', { detail: { timestamp: Date.now() } }));
    sidebarState.setIsSidebarMounted(true);

    // If a guide was handed off from the sidebar (pop-out), open it now.
    // Tag the source as `floating_panel_dock` (aligned-by-construction) so
    // the implied-0th-step evaluator doesn't second-guess a guide the user
    // is already viewing.
    const pendingGuide = panelModeManager.consumePendingGuide();
    if (pendingGuide) {
      guideOpenInFlightRef.current = true;
      openPendingGuide(panel, pendingGuide, 'floating_panel_dock');
    }

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

  // Restore tabs from storage on mount (same as CombinedPanelRendererInner).
  // This handles the page-refresh case where mode is persisted but guide state
  // lives in tabStorage.
  const { tabs, activeTabId } = panel.useState();
  const [restorationDone, setRestorationDone] = useState(false);

  useEffect(() => {
    // Permanent system tabs (`recommendations`, `devtools`, `editor`) don't
    // count as user content — restoring on top of them is safe. Mirrors the
    // sidebar's gate at `docs-panel.tsx` so all three surfaces agree on
    // when "the panel is empty".
    const hasOnlyDefaultTabs = tabs.every((t) => PERMANENT_TAB_IDS.has(t.id));
    if (hasOnlyDefaultTabs) {
      panel.restoreTabsAsync().then(() => {
        setRestorationDone(true);
      });
    } else {
      setRestorationDone(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Listen for auto-launch-tutorial events (shared across all panel surfaces).
  // The hook owns the routing; we just flip the in-flight flag synchronously
  // so the empty-state fallback doesn't fire on top of an incoming guide.
  useAutoLaunchTutorial(panel, {
    onIncoming: () => {
      guideOpenInFlightRef.current = true;
    },
  });

  // Get active tab content
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const isEditorTab = activeTab?.type === 'editor';
  const content = activeTab?.content ?? null;
  const title = isEditorTab ? EDITOR_FLOATING_TITLE : activeTab?.title || 'Interactive learning';
  // hasActiveGuide drives the dock pill pulse and step-progress polling. The editor
  // tab is its own kind of "active content" but isn't a guide, so leave it false.
  const hasActiveGuide = activeTab != null && activeTab.id !== 'recommendations' && !isEditorTab;

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
    isRecommendationsTab: activeTabId === 'recommendations',
    model: panel,
  });
  // Prefer `currentUrl` (the milestone the user is reading) so when the user
  // goes from floating → fullscreen via `handleSwitchToFullScreen`, or copies
  // a shareable link, the milestone position carries through. `baseUrl` is
  // the cover URL; for non-journey tabs the two fields are equal.
  const guideUrl = isEditorTab ? undefined : activeTab?.currentUrl || activeTab?.baseUrl;

  const handleSwitchToSidebar = useCallback(() => {
    reportAppInteraction(UserInteraction.FloatingPanelDock, {
      guide_url: guideUrl || '',
      guide_title: title,
    });
    // Restore the sidebar's original tab state (snapshotted before pop-out)
    // so the floating panel's tabStorage writes don't wipe the user's tabs
    panelModeManager.restoreSidebarTabSnapshot();
    panelModeManager.setMode('sidebar');
    sidebarState.setPendingOpenSource('floating_panel_dock', 'open');
    sidebarState.openSidebar('Interactive learning');
  }, [guideUrl, title]);

  // Symmetric counterpart to `pathfinder-request-pop-out` (see docs-panel.tsx).
  // Dispatched by the popout interactive action so that guides can programmatically
  // dock the floating panel back into the sidebar.
  useEffect(() => {
    const handleDockRequest = () => {
      handleSwitchToSidebar();
    };
    document.addEventListener('pathfinder-request-dock', handleDockRequest);
    return () => {
      document.removeEventListener('pathfinder-request-dock', handleDockRequest);
    };
  }, [handleSwitchToSidebar]);

  const handleClose = useCallback(() => {
    panelModeManager.restoreSidebarTabSnapshot();
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
        content_type: 'editor',
      });
      // Remember where the user was so explicit Exit can land back there.
      panelModeManager.capturePriorPath(window.location.pathname + window.location.search);
      panelModeManager.setPendingGuide({ title, type: 'editor' });
      panelModeManager.setMode('fullscreen');
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
    panelModeManager.setMode('fullscreen');
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
