import React, { useMemo } from 'react';
import { usePluginContext } from '@grafana/data';
import { CombinedLearningJourneyPanel } from 'components/docs-panel/docs-panel';
import { getConfigWithDefaults } from '../../constants';

export default function MemoizedContextPanel() {
  const pluginContext = usePluginContext();
  const config = getConfigWithDefaults(pluginContext?.meta?.jsonData || {});
  const panel = useMemo(() => new CombinedLearningJourneyPanel(config), [config]);

  return <panel.Component model={panel} />;
}
