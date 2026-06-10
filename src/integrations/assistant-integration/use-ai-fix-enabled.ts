import { useMemo } from 'react';

import { usePluginContext } from '@grafana/data';

// Deep import (not the barrel): the index re-exports @grafana/assistant, whose runtime
// init crashes under jsdom — the same chain the docs-panel lazy mount avoids.
import { useIsAssistantAvailable } from './assistant-dev-mode';
import { getConfigWithDefaults } from '../../constants';

export function useAiFixEnabled(): boolean {
  const isAssistantAvailable = useIsAssistantAvailable();
  const pluginContext = usePluginContext();
  const enableAiAutoHeal = useMemo(
    () => getConfigWithDefaults(pluginContext?.meta?.jsonData || {}).enableAiAutoHeal,
    [pluginContext?.meta?.jsonData]
  );
  return isAssistantAvailable && enableAiAutoHeal;
}
