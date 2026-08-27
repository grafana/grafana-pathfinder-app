/**
 * The single writer for tenant-owned settings, shared by every configuration tab.
 *
 * WHY ONE WRITER
 *
 * Each tab used to build and POST the whole `jsonData` document itself. Three
 * writers on one blob, with Grafana replacing it wholesale on every write, gave
 * us: a save that erased the provisioned `stackId` (#1514), a save that unpinned
 * the plugin because it omitted `pinned` (`aa1c2efd`), and two tabs that still
 * write back a `plugin.meta` snapshot Grafana can serve from before the previous
 * save landed.
 *
 * Routing every tab through here fixes the class rather than the instances:
 *
 *   - The current settings are read authoritatively immediately before the write,
 *     through the same `resolveTenantSettings` the config layer renders from, so
 *     a stale form snapshot can only carry the fields that form actually owns.
 *   - `enabled` and `pinned` come from that same read, so they can never be
 *     omitted and silently reset to false.
 *   - Writes prefer the `PathfinderSettings` App Platform resource, which shares
 *     no document with provisioning at all, and carry that read's
 *     `resourceVersion` so a concurrent admin save conflicts rather than losing.
 *   - The legacy `jsonData` path remains for OSS, self-managed, and local dev,
 *     and still spreads the existing document first so provisioned fields survive.
 */

import { PathfinderTenantSettings, getConfigWithDefaults } from '../../constants';
import { savePathfinderSettings } from '../../utils/pathfinder-settings-api';
import { resolveTenantSettings } from '../../utils/resolve-tenant-settings';
import { updatePluginSettings } from '../../utils/utils.plugin';

export interface SaveTenantSettingsArgs {
  pluginId: string;
  /** Only the fields this form owns. Everything else is read, not assumed. */
  changes: Partial<PathfinderTenantSettings>;
}

/**
 * Persists a tab's changes to whichever store is authoritative on this instance.
 *
 * Throws on failure so the calling form can surface it; callers are expected to
 * reload afterwards so every surface picks the new values up.
 */
export async function saveTenantSettings({ pluginId, changes }: SaveTenantSettingsArgs): Promise<void> {
  // Read both stores immediately before writing. This is what stops one tab's
  // stale snapshot overwriting another tab's recent save.
  const { config: current, pluginSettings, tenant } = await resolveTenantSettings(pluginId);

  // The complete resolved tenant config, with this form's edits applied on top.
  const next = { ...getConfigWithDefaults(current), ...changes };

  if (await savePathfinderSettings(next, tenant)) {
    return;
  }

  // No App Platform resource here — fall back to plugin settings. `devModeOptIn`
  // is per-user and must not enter the org-wide document; the leading spread
  // preserves provisioned fields such as `stackId`, and `enabled`/`pinned` are
  // echoed from the authoritative read rather than omitted.
  const { devModeOptIn: _devModeOptIn, ...tenantOnly } = next;

  await updatePluginSettings(pluginId, {
    enabled: pluginSettings.enabled,
    pinned: pluginSettings.pinned,
    jsonData: { ...pluginSettings.jsonData, ...tenantOnly },
  });
}
