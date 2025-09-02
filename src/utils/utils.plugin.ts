import React from 'react';
import { AppRootProps, PluginMeta } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';

// This is used to be able to retrieve the root plugin props anywhere inside the app.
export const PluginPropsContext = React.createContext<AppRootProps | null>(null);

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
