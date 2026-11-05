import { PathfinderTenantSettings, TENANT_SETTING_KEYS } from '../../constants';
import {
  clampToKindBounds,
  savePathfinderSettings,
  fetchPathfinderSettingsSnapshot,
} from '../../utils/pathfinder-settings-api';
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
    if (changes.pathfinderEnabled !== undefined || changes.organizationGuideId !== undefined) {
      const saved = await fetchPathfinderSettingsSnapshot();
      if (changes.pathfinderEnabled !== undefined && saved?.config.pathfinderEnabled !== changes.pathfinderEnabled) {
        throw new Error(
          'Interactive learning preference was not retained. Verify the backend schema is deployed and try again.'
        );
      }
      if (
        changes.organizationGuideId !== undefined &&
        saved?.config.organizationGuideId !== changes.organizationGuideId
      ) {
        throw new Error(
          'Organization guide preference was not retained. Verify the backend schema is deployed and try again.'
        );
      }
    }
    return;
  }

  if (changes.organizationGuideId !== undefined) {
    throw new Error('Organization guide settings require the App Platform settings API.');
  }

  const { devModeOptIn: _devModeOptIn, ...legacy } = pluginSettings.jsonData;
  await updatePluginSettings(pluginId, {
    enabled: pluginSettings.enabled,
    pinned: pluginSettings.pinned,
    jsonData: { ...legacy, ...next },
  });
}
