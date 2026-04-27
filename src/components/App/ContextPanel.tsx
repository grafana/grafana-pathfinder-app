import React, { useMemo, useState, useEffect } from 'react';
import { usePluginContext } from '@grafana/data';
import { CombinedLearningJourneyPanel } from 'components/docs-panel/docs-panel';
import { getConfigWithDefaults } from '../../constants';
import { PathfinderFeatureProvider } from '../OpenFeatureProvider';
import { usePendingGuideLaunch } from '../../hooks';
import { panelModeManager, type PanelMode } from '../../global-state/panel-mode';

export default function MemoizedContextPanel() {
  const pluginContext = usePluginContext();
  const [mode, setMode] = useState<PanelMode>(() => panelModeManager.getMode());

  // Re-render when panel mode changes (e.g. floating panel falls back to sidebar)
  useEffect(() => {
    const handleModeChange = (e: CustomEvent<{ mode: PanelMode }>) => {
      setMode(e.detail.mode);
    };
    document.addEventListener('pathfinder-panel-mode-change', handleModeChange as EventListener);
    return () => {
      document.removeEventListener('pathfinder-panel-mode-change', handleModeChange as EventListener);
    };
  }, []);

  // If the sidebar mounts while floating mode is active (user clicked
  // the help icon, or Grafana restored docked state), switch to sidebar
  // mode. The user opened the sidebar so they want it — don't fight it.
  useEffect(() => {
    if (mode === 'floating') {
      panelModeManager.restoreSidebarTabSnapshot();
      panelModeManager.setMode('sidebar');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only on mount

  if (mode === 'floating') {
    // Render nothing while the mode switch propagates
    return null;
  }

  return <SidebarContent pluginJsonData={pluginContext?.meta?.jsonData} />;
}

function SidebarContent({ pluginJsonData }: { pluginJsonData: Record<string, unknown> | undefined }) {
  usePendingGuideLaunch();

  const panel = useMemo(() => {
    const config = getConfigWithDefaults(pluginJsonData || {});
    return new CombinedLearningJourneyPanel(config);
  }, [pluginJsonData]);

  return (
    <PathfinderFeatureProvider>
      <panel.Component model={panel} />
    </PathfinderFeatureProvider>
  );
}
