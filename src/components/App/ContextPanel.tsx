import React, { useMemo } from 'react';
import { usePluginContext } from '@grafana/data';
import { CombinedLearningJourneyPanel } from 'components/docs-panel/docs-panel';
import { getConfigWithDefaults } from '../../constants';

export default function MemoizedContextPanel() {
  const pluginContext = usePluginContext();

  const panel = useMemo(() => {
    const config = getConfigWithDefaults(pluginContext?.meta?.jsonData || {});
    return new CombinedLearningJourneyPanel(config);
  }, [pluginContext?.meta?.jsonData]);

  return <panel.Component model={panel} />;
}
