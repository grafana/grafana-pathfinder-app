import { usesSdkBackend } from '../../lib/backend-routes';
import { updatePluginSettings } from '../../utils/utils.plugin';
import { PathfinderTenantSettings, TENANT_SETTING_KEYS } from '../../constants';
import {
  clampToKindBounds,
  savePathfinderSettings,
  fetchPathfinderSettingsSnapshot,
} from '../../utils/pathfinder-settings-api';
import { resolveTenantSettings } from '../../utils/resolve-tenant-settings';

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

  if (!usesSdkBackend() && !tenant) {
    const { devModeOptIn: _devModeOptIn, ...legacy } = pluginSettings.jsonData;
    await updatePluginSettings(pluginId, {
      enabled: pluginSettings.enabled,
      pinned: pluginSettings.pinned,
      jsonData: { ...legacy, ...next },
    });
    return;
  }

  // Registered SDK failures must not write a second, potentially stale settings store.
  if (await savePathfinderSettings(next, tenant)) {
    if (changes.pathfinderEnabled !== undefined) {
      const saved = await fetchPathfinderSettingsSnapshot();
      if (saved?.config.pathfinderEnabled !== changes.pathfinderEnabled) {
        throw new Error(
          'Interactive learning preference was not retained. Verify the backend schema is deployed and try again.'
        );
      }
    }
    return;
  }

  throw new Error('The SDK settings API is unavailable; retry the save after the application is registered.');
}
