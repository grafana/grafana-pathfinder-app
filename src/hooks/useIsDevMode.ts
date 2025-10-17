import { usePluginContext } from "@grafana/data";
import { getConfigWithDefaults } from "../constants";

export function useIsDevMode() {
  const pluginContext = usePluginContext();
  const configWithDefaults = getConfigWithDefaults(pluginContext?.meta?.jsonData || {});

  return configWithDefaults.devMode;
}
