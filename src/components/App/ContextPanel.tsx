import React, { useState, useEffect } from 'react';
import { usePathfinderPluginConfig } from '../../hooks';
import type { ResolvedPathfinderConfig } from '../../constants';
import { LoadingPlaceholder } from '@grafana/ui';
import { CombinedLearningJourneyPanel } from 'components/docs-panel/docs-panel';
import { PathfinderFeatureProvider } from '../OpenFeatureProvider';
import { panelModeManager, type PanelMode } from '../../global-state/panel-mode';
import { PANEL_MODE_CHANGE_EVENT } from '../../lib/event-names';

export default function MemoizedContextPanel() {
  const [mode, setMode] = useState<PanelMode>(() => panelModeManager.getMode());

  // Re-render when panel mode changes (e.g. floating panel falls back to sidebar)
  useEffect(() => {
    const handleModeChange = (e: CustomEvent<{ mode: PanelMode }>) => {
      setMode(e.detail.mode);
    };
    document.addEventListener(PANEL_MODE_CHANGE_EVENT, handleModeChange as EventListener);
    return () => {
      document.removeEventListener(PANEL_MODE_CHANGE_EVENT, handleModeChange as EventListener);
    };
  }, []);

  // If the sidebar mounts while floating mode is active (user clicked
  // the help icon, or Grafana restored docked state), switch to sidebar
  // mode. The user opened the sidebar so they want it — don't fight it.
  useEffect(() => {
    if (mode === 'floating') {
      panelModeManager.setMode('sidebar');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- switching to sidebar happens only on mount
  }, []); // Only on mount

  if (mode === 'floating') {
    // Render nothing while the mode switch propagates
    return null;
  }

  return <SidebarContent />;
}

function SidebarContent() {
  const { config, isResolved, hasError } = usePathfinderPluginConfig();
  if (!isResolved && !hasError) {
    return <LoadingPlaceholder text="Loading Pathfinder settings" />;
  }
  return <ResolvedSidebarContent config={config} />;
}

function ResolvedSidebarContent({ config }: { config: ResolvedPathfinderConfig }) {
  const [panel] = useState(() => new CombinedLearningJourneyPanel(config));

  return (
    <PathfinderFeatureProvider>
      <panel.Component model={panel} />
    </PathfinderFeatureProvider>
  );
}
