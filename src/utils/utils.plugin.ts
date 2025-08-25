import React, { useContext } from 'react';
import { AppRootProps, PluginMeta, usePluginContext } from '@grafana/data';

// This is used to be able to retrieve the root plugin props anywhere inside the app.
export const PluginPropsContext = React.createContext<AppRootProps | null>(null);

// Configuration change notification system
type ConfigChangeListener = () => void;
const configChangeListeners = new Set<ConfigChangeListener>();

export const subscribeToConfigChanges = (listener: ConfigChangeListener): (() => void) => {
  configChangeListeners.add(listener);
  return () => configChangeListeners.delete(listener);
};

export const notifyConfigChange = () => {
  configChangeListeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.error('Error in config change listener:', error);
    }
  });
};

export const usePluginProps = () => {
  const pluginProps = useContext(PluginPropsContext);

  return pluginProps;
};

export const usePluginMeta = () => {
  const pluginProps = usePluginProps();

  return pluginProps?.meta;
};

// Official way to get plugin context - use this for configuration
export const usePluginConfig = () => {
  const context = usePluginContext();
  return context?.meta?.jsonData || {};
};

// Official way to update plugin settings
export const updatePluginSettings = async (pluginId: string, data: Partial<PluginMeta>) => {
  const { getBackendSrv } = await import('@grafana/runtime');
  const { lastValueFrom } = await import('rxjs');

  const response = await getBackendSrv().fetch({
    url: `/api/plugins/${pluginId}/settings`,
    method: 'POST',
    data, // data: { jsonData: { ... }, secureJsonData: { ... } }
  });

  return lastValueFrom(response);
};

export const updatePluginSettingsAndReload = async (pluginId: string, data: Partial<PluginMeta>) => {
  try {
    // Update plugin settings
    await updatePluginSettings(pluginId, data);

    // Notify any listeners that configuration has changed
    notifyConfigChange();

    // Small delay to ensure backend saves the data and listeners can react
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Force browser reload to ensure all changes take effect immediately
    window.location.reload();
  } catch (e) {
    console.error('Error while updating the plugin', e);
    throw e; // Re-throw so calling components can handle the error
  }
};

// Fetch the latest plugin settings from backend
export const getPluginSettings = async (pluginId: string): Promise<PluginMeta> => {
  const { getBackendSrv } = await import('@grafana/runtime');
  const { lastValueFrom } = await import('rxjs');

  const response = getBackendSrv().fetch({
    url: `/api/plugins/${pluginId}/settings`,
    method: 'GET',
  });

  const result = await lastValueFrom(response);
  return (result as any).data as PluginMeta;
};
