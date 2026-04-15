import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { usePluginContext } from '@grafana/data';
import { CombinedLearningJourneyPanel } from '../docs-panel/docs-panel';
import { PathfinderFeatureProvider } from '../OpenFeatureProvider';
import { usePendingGuideLaunch } from '../../hooks';
import { panelModeManager, type PanelMode } from '../../global-state/panel-mode';
import { sidebarState } from '../../global-state/sidebar';
import { getConfigWithDefaults } from '../../constants';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { FloatingPanel } from './FloatingPanel';
import { FloatingPanelContent } from './FloatingPanelContent';

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
  const pluginContext = usePluginContext();

  // Note: we do NOT call useUserStorage() here. That hook requires Grafana's
  // plugin context (usePluginUserStorage), which isn't available in this
  // standalone React root. Tab restoration works via localStorage fallback.

  // Poll for MCP guide launches (same as ContextPanel does for sidebar)
  usePendingGuideLaunch();

  const panel = useMemo(() => {
    const config = getConfigWithDefaults(pluginContext?.meta?.jsonData || {});
    return new CombinedLearningJourneyPanel(config);
  }, [pluginContext?.meta?.jsonData]);

  // Fire panel-mounted event so auto-launch and MCP flows work
  useEffect(() => {
    document.dispatchEvent(new CustomEvent('pathfinder-panel-mounted', { detail: { timestamp: Date.now() } }));
    sidebarState.setIsSidebarMounted(true);

    // If a guide was handed off from the sidebar (pop-out), open it now
    const pendingGuide = panelModeManager.consumePendingGuide();
    if (pendingGuide) {
      panel.openDocsPage(pendingGuide.url, pendingGuide.title);
    }

    return () => {
      sidebarState.setIsSidebarMounted(false);
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
  const content = activeTab?.content ?? null;
  const title = activeTab?.title || 'Interactive learning';
  const hasActiveGuide = activeTab != null && activeTab.id !== 'recommendations';

  // After restoration completes, if there's no guide to show, fall back
  // to sidebar mode. An empty floating panel is never useful.
  // This runs reactively (not in the async callback) so it sees the
  // latest React state after Scenes model updates have propagated.
  useEffect(() => {
    if (restorationDone && !hasActiveGuide) {
      panelModeManager.setMode('sidebar');
    }
  }, [restorationDone, hasActiveGuide]);
  const guideUrl = activeTab?.baseUrl || activeTab?.currentUrl;

  const handleSwitchToSidebar = useCallback(() => {
    reportAppInteraction(UserInteraction.FloatingPanelDock, {
      guide_url: guideUrl || '',
      guide_title: title,
    });
    // Restore the sidebar's original tab state (snapshotted before pop-out)
    // so the floating panel's tabStorage writes don't wipe the user's tabs
    panelModeManager.restoreSidebarTabSnapshot();
    // Reset the static guard so the sidebar's new model can restore tabs
    CombinedLearningJourneyPanel.resetTabRestorationGuard();
    panelModeManager.setMode('sidebar');
    sidebarState.setPendingOpenSource('floating_panel_dock', 'open');
    sidebarState.openSidebar('Interactive learning');
  }, [guideUrl, title]);

  const handleClose = useCallback(() => {
    panelModeManager.restoreSidebarTabSnapshot();
    CombinedLearningJourneyPanel.resetTabRestorationGuard();
    panelModeManager.setMode('sidebar');
  }, []);

  const handleGuideComplete = useCallback(() => {
    // Guide completion is handled by ContentRenderer's internal tracking
    // and persisted via interactiveStepStorage. Nothing extra needed here.
  }, []);

  return (
    <FloatingPanel
      title={title}
      hasActiveGuide={hasActiveGuide}
      guideUrl={guideUrl}
      onSwitchToSidebar={handleSwitchToSidebar}
      onClose={handleClose}
    >
      <FloatingPanelContent content={content} onGuideComplete={handleGuideComplete} />
    </FloatingPanel>
  );
}
