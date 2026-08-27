/**
 * The one place tenant settings are resolved across the stores that own them.
 *
 * Reads and writes have to agree on precedence exactly: the config layer renders
 * from this, and the config tabs save through it. When they were separate
 * implementations, drifting apart meant a form seeded from one store writing
 * over the other — which is the bug class the whole migration exists to close.
 *
 * Precedence, least authoritative first:
 *
 *   1. plugin `jsonData` — the legacy store, and the only one on OSS,
 *      self-managed and local dev. Also carries provisioned fields such as
 *      `stackId`, which nothing else supplies.
 *   2. the `PathfinderSettings` App Platform resource — authoritative wherever
 *      it is served. Its CRD defaults every field, so a written resource wins
 *      outright rather than partially.
 *
 * Per-user state is not resolved here: it is folded in at publish time by the
 * config layer, so it can never reach a tenant-scoped write.
 */

import { PathfinderPluginConfig } from '../constants';
import { fetchPathfinderSettingsSnapshot, PathfinderSettingsSnapshot } from './pathfinder-settings-api';
import { fetchPluginSettings, PluginSettingsSnapshot } from './utils.plugin';

export interface ResolvedTenantSettings {
  /** jsonData merged under the settings resource. Defaults are not applied. */
  config: PathfinderPluginConfig;
  /** The plugin-settings record, for the `enabled`/`pinned` echo on the fallback write. */
  pluginSettings: PluginSettingsSnapshot;
  /** Null when the resource is absent or unwritten; carries the CAS token when present. */
  tenant: PathfinderSettingsSnapshot | null;
}

export async function resolveTenantSettings(pluginId: string): Promise<ResolvedTenantSettings> {
  const [pluginSettings, tenant] = await Promise.all([
    fetchPluginSettings(pluginId),
    // Never rejects: null when the App Platform resource is absent or unwritten.
    fetchPathfinderSettingsSnapshot(),
  ]);

  return {
    config: tenant ? { ...pluginSettings.jsonData, ...tenant.config } : pluginSettings.jsonData,
    pluginSettings,
    tenant,
  };
}
