import React, { lazy, Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { CombinedLearningJourneyPanel } from '../docs-panel/docs-panel';
import { PathfinderFeatureProvider } from '../OpenFeatureProvider';
import { usePendingGuideLaunch } from '../../hooks';
import { panelModeManager, type PanelMode } from '../../global-state/panel-mode';
import { sidebarState } from '../../global-state/sidebar';
import { getConfigWithDefaults } from '../../constants';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
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

    // If a guide was handed off from the sidebar (pop-out), open it now
    const pendingGuide = panelModeManager.consumePendingGuide();
    if (pendingGuide) {
      guideOpenInFlightRef.current = true;
      panel.openDocsPage(pendingGuide.url, pendingGuide.title);
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
    const handleAutoLaunch = (e: CustomEvent<{ url: string; title: string; type?: string }>) => {
      guideOpenInFlightRef.current = true;
      const { url, title } = e.detail;
      panel.openDocsPage(url, title);
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

  // Track interactive step progress from window globals set by the
  // interactive engine. Poll on a short interval since these globals
  // update outside React's state system.
  const [stepProgress, setStepProgress] = useState<string | undefined>();
  useEffect(() => {
    if (!hasActiveGuide) {
      setStepProgress(undefined);
      return;
    }
    const update = () => {
      const stepIndex = (window as any).__DocsPluginCurrentStepIndex as number | undefined;
      const totalSteps = (window as any).__DocsPluginTotalSteps as number | undefined;
      if (stepIndex !== undefined && totalSteps !== undefined && totalSteps > 0) {
        setStepProgress(`${stepIndex + 1}/${totalSteps}`);
      } else {
        setStepProgress(undefined);
      }
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [hasActiveGuide]);

  // After restoration completes, if there's no guide to show and none
  // is being loaded, fall back to sidebar mode. The editor tab counts as
  // valid floating content, so don't fall back when it's active.
  useEffect(() => {
    if (restorationDone && !hasActiveGuide && !isEditorTab && !guideOpenInFlightRef.current) {
      panelModeManager.setMode('sidebar');
    }
  }, [restorationDone, hasActiveGuide, isEditorTab]);
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

  return (
    <FloatingPanel
      title={title}
      hasActiveGuide={hasActiveGuide}
      guideUrl={guideUrl}
      stepProgress={stepProgress}
      onSwitchToSidebar={handleSwitchToSidebar}
      onClose={handleClose}
    >
      {isEditorTab ? (
        <Suspense fallback={<SkeletonLoader type="documentation" />}>
          <BlockEditor />
        </Suspense>
      ) : (
        <FloatingPanelContent content={content} />
      )}
    </FloatingPanel>
  );
}
