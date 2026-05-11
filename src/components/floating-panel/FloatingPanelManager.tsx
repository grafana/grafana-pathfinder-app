import React, { lazy, Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { locationService } from '@grafana/runtime';
import { CombinedLearningJourneyPanel } from '../docs-panel/docs-panel';
import { PathfinderFeatureProvider } from '../OpenFeatureProvider';
import { usePendingGuideLaunch, useAlignmentReevaluation } from '../../hooks';
import { panelModeManager, type PanelMode } from '../../global-state/panel-mode';
import { sidebarState } from '../../global-state/sidebar';
import { getConfigWithDefaults, PLUGIN_BASE_URL, ROUTES } from '../../constants';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { coerceLaunchSource } from '../../recovery';
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
    <PathfinderFeatureProvider>
      <FloatingPanelInner />
    </PathfinderFeatureProvider>
  );
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

  // Poll for MCP guide launches (same as ContextPanel does for sidebar)
  usePendingGuideLaunch();

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
      // Editor handoff: no URL — switch the active tab to the editor (or
      // create it if needed). Mirrors the FullScreenPanel handler.
      if (pendingGuide.type === 'editor') {
        panel.openEditorTab();
      } else if (pendingGuide.url) {
        // packageInfo (e.g. from the PR tester) carries the manifest +
        // pre-resolved milestones, so openDocsPage creates a journey tab with
        // the milestone toolbar even when the URL is a raw GitHub URL that
        // openLearningJourney's package-URL detection wouldn't recognise.
        if (pendingGuide.packageInfo) {
          panel.openDocsPage(pendingGuide.url, pendingGuide.title, {
            source: 'floating_panel_dock',
            packageInfo: pendingGuide.packageInfo,
          });
        } else if (pendingGuide.type === 'learning-journey') {
          // Preserve the journey tab type so docking back to sidebar restores
          // it as a journey (with milestone navigation) rather than a flat docs tab.
          panel.openLearningJourney(pendingGuide.url, pendingGuide.title, { source: 'floating_panel_dock' });
        } else {
          panel.openDocsPage(pendingGuide.url, pendingGuide.title, { source: 'floating_panel_dock' });
        }
      }
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
    const hasOnlyDefaultTabs = tabs.length === 1 && tabs[0]?.id === 'recommendations';
    if (hasOnlyDefaultTabs) {
      panel.restoreTabsAsync().then(() => {
        setRestorationDone(true);
      });
    } else {
      setRestorationDone(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Listen for auto-launch-tutorial events (same as docs-panel)
  useEffect(() => {
    const handleAutoLaunch = (e: CustomEvent<{ url: string; title: string; type?: string; source?: string }>) => {
      guideOpenInFlightRef.current = true;
      const { url, title, type, source } = e.detail;
      // Match the sidebar's routing in `handleAutoLaunchTutorial`: learning
      // journeys must go through `openLearningJourney` to get milestone
      // navigation and progress tracking. Interactive guides from `?doc=`
      // fall through to `openDocsPage`, which auto-detects interactive content.
      const openAsLearningJourney = type === 'learning-journey' || source === 'learning-hub';
      // Coerce the untrusted event.detail.source to a typed LaunchSource at
      // the boundary so a typo or unknown literal falls through to the safe
      // "needs check" default rather than entering the model untyped.
      const typedSource = coerceLaunchSource(source) ?? undefined;
      if (openAsLearningJourney) {
        panel.openLearningJourney(url, title, { source: typedSource });
      } else {
        panel.openDocsPage(url, title, { source: typedSource });
      }
    };

    document.addEventListener('auto-launch-tutorial', handleAutoLaunch as EventListener);
    return () => {
      document.removeEventListener('auto-launch-tutorial', handleAutoLaunch as EventListener);
    };
  }, [panel]);

  // Get active tab content
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const isEditorTab = activeTab?.type === 'editor';
  const content = activeTab?.content ?? null;
  const title = isEditorTab ? EDITOR_FLOATING_TITLE : activeTab?.title || 'Interactive learning';
  // hasActiveGuide drives the dock pill pulse and step-progress polling. The editor
  // tab is its own kind of "active content" but isn't a guide, so leave it false.
  const hasActiveGuide = activeTab != null && activeTab.id !== 'recommendations' && !isEditorTab;

  // Track interactive step progress via the `pathfinder-step-progress`
  // event published by interactive-section. The previous polling on
  // `__DocsPluginCurrentStepIndex` only updated while a step was
  // *executing*, so the chip went stale immediately after each step
  // finished. Now we listen for completion changes too and show
  // "completed / total" instead of a moving cursor.
  const [stepProgress, setStepProgress] = useState<string | undefined>();
  useEffect(() => {
    if (!hasActiveGuide) {
      setStepProgress(undefined);
      return;
    }
    const handle = (e: Event) => {
      const detail = (e as CustomEvent<{ totalSteps?: number; completedCount?: number }>).detail;
      const total = detail?.totalSteps ?? 0;
      const done = detail?.completedCount ?? 0;
      if (total > 0) {
        setStepProgress(`${done}/${total}`);
      } else {
        setStepProgress(undefined);
      }
    };
    window.addEventListener('pathfinder-step-progress', handle);
    return () => {
      window.removeEventListener('pathfinder-step-progress', handle);
    };
  }, [hasActiveGuide]);

  // After restoration completes, if there's no guide to show and none
  // is being loaded, fall back to sidebar mode. The editor tab counts as
  // valid floating content, so don't fall back when it's active.
  useEffect(() => {
    if (restorationDone && !hasActiveGuide && !isEditorTab && !guideOpenInFlightRef.current) {
      panelModeManager.setMode('sidebar');
    }
  }, [restorationDone, hasActiveGuide, isEditorTab]);

  useAlignmentReevaluation(panel, activeTabId, activeTab);
  const guideUrl = isEditorTab ? undefined : activeTab?.baseUrl || activeTab?.currentUrl;

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
    locationService.push(`${PLUGIN_BASE_URL}/${ROUTES.FullScreen}?doc=${encodeURIComponent(guideUrl)}&type=${tabType}`);
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

  return (
    <FloatingPanel
      title={title}
      hasActiveGuide={hasActiveGuide}
      guideUrl={guideUrl}
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
        />
      )}
    </FloatingPanel>
  );
}
