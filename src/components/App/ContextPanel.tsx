import React, { useMemo } from 'react';
import { usePluginContext } from '@grafana/data';
import { CombinedLearningJourneyPanel } from 'components/docs-panel/docs-panel';
import { getConfigWithDefaults } from '../../constants';
import { PathfinderFeatureProvider } from '../OpenFeatureProvider';
import { usePendingGuideLaunch } from '../../hooks';

export default function MemoizedContextPanel() {
  const pluginContext = usePluginContext();

  usePendingGuideLaunch();

  const panel = useMemo(() => {
    const config = getConfigWithDefaults(pluginContext?.meta?.jsonData || {});
    return new CombinedLearningJourneyPanel(config);
  }, [pluginContext?.meta?.jsonData]);

  return (
    <PathfinderFeatureProvider>
      <panel.Component model={panel} />
    </PathfinderFeatureProvider>
  );
}
