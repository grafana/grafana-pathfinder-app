import React from 'react';
import { AppRootProps, PluginMeta } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';
import { DocsPluginConfig } from '../constants';

// This is used to be able to retrieve the root plugin props anywhere inside the app.
export const PluginPropsContext = React.createContext<AppRootProps | null>(null);

type PluginSettingsResponse = {
  jsonData?: DocsPluginConfig;
  enabled?: boolean;
  pinned?: boolean;
};

export type PluginSettingsSnapshot = {
  jsonData: DocsPluginConfig;
  enabled: boolean;
  pinned: boolean;
};

export async function fetchPluginSettings(pluginId: string): Promise<PluginSettingsSnapshot> {
  const response = getBackendSrv().fetch<PluginSettingsResponse>({
    url: `/api/plugins/${encodeURIComponent(pluginId)}/settings`,
    method: 'GET',
  });
  const result = await lastValueFrom(response);
  const jsonData = result.data?.jsonData || {};
  return {
    jsonData,
    enabled: result.data?.enabled !== false,
    pinned: result.data?.pinned === true,
  };
}

export async function fetchPluginJsonData(pluginId: string): Promise<DocsPluginConfig> {
  return (await fetchPluginSettings(pluginId)).jsonData;
}

export const updatePluginSettings = async (pluginId: string, data: Partial<PluginMeta>) => {
  const response = getBackendSrv().fetch({
    url: `/api/plugins/${pluginId}/settings`,
    method: 'POST',
    data,
  });

  const dataResponse = await lastValueFrom(response);
  return dataResponse.data;
};
