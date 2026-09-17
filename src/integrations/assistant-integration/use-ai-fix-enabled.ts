import { usePathfinderPluginConfig } from '../../hooks';

// Deep import (not the barrel): the index re-exports @grafana/assistant, whose runtime
// init crashes under jsdom — the same chain the docs-panel lazy mount avoids.
import { useIsAssistantAvailable } from './assistant-dev-mode';

export function useAiFixEnabled(): boolean {
  const isAssistantAvailable = useIsAssistantAvailable();
  const { config: pluginConfig } = usePathfinderPluginConfig();
  const enableAiAutoHeal = pluginConfig.enableAiAutoHeal;
  return isAssistantAvailable && enableAiAutoHeal;
}
