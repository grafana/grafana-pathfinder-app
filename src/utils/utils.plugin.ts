import React from 'react';
import { AppRootProps, PluginMeta } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';
import { PathfinderPluginConfig } from '../constants';

// This is used to be able to retrieve the root plugin props anywhere inside the app.
export const PluginPropsContext = React.createContext<AppRootProps | null>(null);

/** The parts of the plugin-settings record a write has to echo back. */
export interface PluginSettingsSnapshot {
  jsonData: PathfinderPluginConfig;
  enabled: boolean;
  pinned: boolean;
}

/**
 * Reads the plugin-settings record, including the `enabled` and `pinned` siblings
 * of `jsonData`.
 *
 * Those two matter because Grafana treats an omitted `pinned` as `false`, so a
 * write that only carries `jsonData` silently unpins the plugin from the nav.
 * Anything writing plugin settings must echo them back, so reading them is part
 * of the same operation. Defaults match Grafana's: `enabled` unless explicitly
 * false, `pinned` only when explicitly true.
 */
export async function fetchPluginSettings(pluginId: string): Promise<PluginSettingsSnapshot> {
  const response = getBackendSrv().fetch<{ jsonData?: PathfinderPluginConfig; enabled?: boolean; pinned?: boolean }>({
    url: `/api/plugins/${encodeURIComponent(pluginId)}/settings`,
    method: 'GET',
  });
  const result = await lastValueFrom(response);
  return {
    jsonData: result.data?.jsonData || {},
    enabled: result.data?.enabled !== false,
    pinned: result.data?.pinned === true,
  };
}

export async function fetchPluginJsonData(pluginId: string): Promise<PathfinderPluginConfig> {
  return (await fetchPluginSettings(pluginId)).jsonData;
}

export const updatePluginSettings = async (pluginId: string, data: Partial<PluginMeta>) => {
  // Simple plugin update following working plugin patterns - no reload needed
  const response = getBackendSrv().fetch({
    url: `/api/plugins/${pluginId}/settings`,
    method: 'POST',
    data,
  });

  const dataResponse = await lastValueFrom(response);
  return dataResponse.data;
};
