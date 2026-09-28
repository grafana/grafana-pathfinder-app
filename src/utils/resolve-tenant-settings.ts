import { PathfinderPluginConfig } from '../constants';
import { fetchPathfinderSettingsSnapshot, PathfinderSettingsSnapshot } from './pathfinder-settings-api';
import { fetchPluginSettings, PluginSettingsSnapshot } from './utils.plugin';

export interface ResolvedTenantSettings {
  config: PathfinderPluginConfig;
  pluginSettings: PluginSettingsSnapshot;
  tenant: PathfinderSettingsSnapshot | null;
}

export async function resolveTenantSettings(pluginId: string): Promise<ResolvedTenantSettings> {
  const [pluginSettings, tenant] = await Promise.all([
    fetchPluginSettings(pluginId),
    fetchPathfinderSettingsSnapshot(),
  ]);

  return {
    config: tenant ? { ...pluginSettings.jsonData, ...tenant.config } : pluginSettings.jsonData,
    pluginSettings,
    tenant,
  };
}
