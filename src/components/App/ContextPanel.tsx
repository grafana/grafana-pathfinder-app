import React, { useMemo, useState, useEffect } from 'react';
import { usePluginContext } from '@grafana/data';
import { Button } from '@grafana/ui';
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

  // When floating mode is active, show a prompt instead of the full sidebar
  if (mode === 'floating') {
    return (
      <div style={{ padding: 16, textAlign: 'center' }}>
        <p style={{ marginBottom: 8 }}>Guide is in floating panel mode.</p>
        <Button
          variant="secondary"
          size="sm"
          icon="gf-layout-simple"
          onClick={() => panelModeManager.setMode('sidebar')}
        >
          Switch to sidebar
        </Button>
      </div>
    );
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
