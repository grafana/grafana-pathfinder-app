/**
 * Shared definitions for the InteractiveGuide App Platform API (Grafana App
 * Platform group `pathfinderbackend.ext.grafana.app`).
 */
import { PLUGIN_BACKEND_URL } from '../constants';
import { readBootFeatureToggle } from './boot-feature-toggles';

export const APP_PLATFORM_GROUP = 'pathfinderbackend.ext.grafana.app';
export const APP_PLATFORM_API_VERSION = `${APP_PLATFORM_GROUP}/v1alpha1`;
const RESOURCE = 'interactiveguides';

// Grafana derives the aggregation toggle from the group name, dots→dashes.
const AGGREGATION_TOGGLE = `aggregation.${APP_PLATFORM_GROUP.replace(/\./g, '-')}.enabled`;

// Confirmed on: gates direct App Platform reads and writes, which fail loudly when the group is not served.
export function isBackendApiAvailable(): boolean {
  return readBootFeatureToggle(AGGREGATION_TOGGLE) === true;
}

// Confirmed off. When the boot toggles are unknown, proxied reads probe and the capability answer decides.
export function isBackendApiRuledOut(): boolean {
  return readBootFeatureToggle(AGGREGATION_TOGGLE) === false;
}

export function collectionUrl(namespace: string): string {
  return `/apis/${APP_PLATFORM_API_VERSION}/namespaces/${encodeURIComponent(namespace)}/${RESOURCE}`;
}

export function itemUrl(namespace: string, name: string): string {
  return `${collectionUrl(namespace)}/${encodeURIComponent(name)}`;
}

export function guideReadUrl(name: string): string {
  const params = new URLSearchParams({ name });
  return `${PLUGIN_BACKEND_URL}/custom-guide?${params.toString()}`;
}
