import { config } from '@grafana/runtime';
import { backendRoute, usesSdkBackend } from '../lib/backend-routes';

export const APP_PLATFORM_GROUP = 'pathfinderbackend.ext.grafana.app';
export const APP_PLATFORM_API_VERSION = `${APP_PLATFORM_GROUP}/v1alpha1`;

export function isBackendApiAvailable(): boolean {
  return usesSdkBackend();
}

export function collectionUrl(namespace: string): string {
  if (namespace !== config.namespace) {
    throw new Error('SDK backend namespace mismatch');
  }
  return backendRoute('custom-guide');
}

export function itemUrl(namespace: string, name: string): string {
  return `${collectionUrl(namespace)}?${new URLSearchParams({ name })}`;
}

export function guideReadUrl(name: string): string {
  return `${backendRoute('custom-guide')}?${new URLSearchParams({ name })}`;
}
