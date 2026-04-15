import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { usePluginContext } from '@grafana/data';
import { CombinedLearningJourneyPanel } from '../docs-panel/docs-panel';
import { PathfinderFeatureProvider } from '../OpenFeatureProvider';
import { usePendingGuideLaunch } from '../../hooks';
import { panelModeManager, type PanelMode } from '../../global-state/panel-mode';
import { sidebarState } from '../../global-state/sidebar';
import { getConfigWithDefaults } from '../../constants';
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

    return () => {
      sidebarState.setIsSidebarMounted(false);
    };
  }, []);

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
  const { tabs, activeTabId } = panel.useState();
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const content = activeTab?.content ?? null;
  const title = activeTab?.title || 'Interactive learning';
  const hasActiveGuide = activeTab != null && activeTab.id !== 'recommendations';

  const handleSwitchToSidebar = useCallback(() => {
    sidebarState.openSidebar('Interactive learning');
  }, []);

  const handleClose = useCallback(() => {
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
      onSwitchToSidebar={handleSwitchToSidebar}
      onClose={handleClose}
    >
      <FloatingPanelContent content={content} onGuideComplete={handleGuideComplete} />
    </FloatingPanel>
  );
}
