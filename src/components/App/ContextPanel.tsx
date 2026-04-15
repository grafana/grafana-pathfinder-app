import React, { useMemo } from 'react';
import { usePluginContext } from '@grafana/data';
import { Button } from '@grafana/ui';
import { CombinedLearningJourneyPanel } from 'components/docs-panel/docs-panel';
import { getConfigWithDefaults } from '../../constants';
import { PathfinderFeatureProvider } from '../OpenFeatureProvider';
import { usePendingGuideLaunch } from '../../hooks';
import { panelModeManager } from '../../global-state/panel-mode';

export default function MemoizedContextPanel() {
  const pluginContext = usePluginContext();

  // When floating mode is active, show a prompt instead of the full sidebar
  if (panelModeManager.getMode() === 'floating') {
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
