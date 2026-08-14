import React from 'react';
import { AppRootProps, PluginMeta } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';
import { DocsPluginConfig } from '../constants';

// This is used to be able to retrieve the root plugin props anywhere inside the app.
export const PluginPropsContext = React.createContext<AppRootProps | null>(null);

export async function fetchPluginJsonData(pluginId: string): Promise<DocsPluginConfig> {
  const response = getBackendSrv().fetch<{ jsonData?: DocsPluginConfig }>({
    url: `/api/plugins/${encodeURIComponent(pluginId)}/settings`,
    method: 'GET',
  });
  const result = await lastValueFrom(response);
  return result.data?.jsonData || {};
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
