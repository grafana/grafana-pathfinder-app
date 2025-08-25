import React, { useContext } from 'react';
import { AppRootProps } from '@grafana/data';

// This is used to be able to retrieve the root plugin props anywhere inside the app.
export const PluginPropsContext = React.createContext<AppRootProps | null>(null);

export const usePluginProps = () => {
  const pluginProps = useContext(PluginPropsContext);

  return pluginProps;
};

export const usePluginMeta = () => {
  const pluginProps = usePluginProps();

  return pluginProps?.meta;
};

// Shared helper to update plugin settings and reload the page
export const updatePluginSettingsAndReload = async (
  pluginId: string,
  data: any
) => {
  const { getBackendSrv, locationService } = await import('@grafana/runtime');
  const { lastValueFrom } = await import('rxjs');

  try {
    const response = getBackendSrv().fetch({
      url: `/api/plugins/${pluginId}/settings`,
      method: 'POST',
      data,
    });

    await lastValueFrom(response as any);

    // Reloading the page as the changes made here wouldn't be propagated to the actual plugin otherwise.
    // This is not ideal, however unfortunately currently there is no supported way for updating the plugin state.
    locationService.reload();
  } catch (e) {
    console.error('Error while updating the plugin', e);
  }
};
