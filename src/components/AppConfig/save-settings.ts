import { PathfinderTenantSettings, TENANT_SETTING_KEYS } from '../../constants';
import { clampToKindBounds, savePathfinderSettings } from '../../utils/pathfinder-settings-api';
import { resolveTenantSettings } from '../../utils/resolve-tenant-settings';
import { updatePluginSettings } from '../../utils/utils.plugin';

export interface SaveTenantSettingsArgs {
  pluginId: string;
  changes: Partial<PathfinderTenantSettings>;
}

export async function saveTenantSettings({ pluginId, changes }: SaveTenantSettingsArgs): Promise<void> {
  const { config: current, pluginSettings, tenant } = await resolveTenantSettings(pluginId);
  const source = clampToKindBounds({ ...current, ...changes });
  const next = Object.fromEntries(
    TENANT_SETTING_KEYS.filter((key) => source[key] !== undefined).map((key) => [key, source[key]])
  );

  // Persist explicit overrides only; runtime defaults and feature flags have their own owners.
  if (await savePathfinderSettings(next, tenant)) {
    return;
  }

  const { devModeOptIn: _devModeOptIn, ...legacy } = pluginSettings.jsonData;
  await updatePluginSettings(pluginId, {
    enabled: pluginSettings.enabled,
    pinned: pluginSettings.pinned,
    jsonData: { ...legacy, ...next },
  });
}
