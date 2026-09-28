import { PathfinderPluginConfig } from '../constants';
import { fetchPathfinderSettingsSnapshot, PathfinderSettingsSnapshot } from './pathfinder-settings-api';
import { fetchPluginSettings, PluginSettingsSnapshot } from './utils.plugin';

export interface ResolvedTenantSettings {
  config: PathfinderPluginConfig;
  pluginSettings: PluginSettingsSnapshot;
  tenant: PathfinderSettingsSnapshot | null;
}

export class TenantSettingsReadError extends Error {
  readonly status?: number;
  constructor(
    public readonly pathfinderEnabled: boolean | undefined,
    cause: unknown
  ) {
    super(cause instanceof Error ? cause.message : 'Could not resolve tenant settings', { cause });
    if (cause && typeof cause === 'object' && 'status' in cause && typeof cause.status === 'number') {
      this.status = cause.status;
    }
  }
}

export async function resolveTenantSettings(pluginId: string): Promise<ResolvedTenantSettings> {
  const [pluginRead, tenantRead] = await Promise.allSettled([
    fetchPluginSettings(pluginId),
    fetchPathfinderSettingsSnapshot(),
  ]);
  if (pluginRead.status === 'rejected' || tenantRead.status === 'rejected') {
    const readable =
      tenantRead.status === 'fulfilled' && tenantRead.value
        ? tenantRead.value.config.pathfinderEnabled
        : pluginRead.status === 'fulfilled'
          ? pluginRead.value.jsonData.pathfinderEnabled
          : undefined;
    const cause =
      pluginRead.status === 'rejected'
        ? pluginRead.reason
        : tenantRead.status === 'rejected'
          ? tenantRead.reason
          : undefined;
    throw new TenantSettingsReadError(readable, cause);
  }
  const pluginSettings = pluginRead.value;
  const tenant = tenantRead.value;

  return {
    config: tenant ? { ...pluginSettings.jsonData, ...tenant.config } : pluginSettings.jsonData,
    pluginSettings,
    tenant,
  };
}
