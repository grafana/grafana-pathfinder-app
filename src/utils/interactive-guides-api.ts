/**
 * Shared definitions for the InteractiveGuide App Platform API (Grafana App
 * Platform group `pathfinderbackend.ext.grafana.app`). `isBackendApiAvailable`
 * gates the feature on the aggregation toggle, so it cleanly hides where GAP
 * isn't enabled.
 */
import { config } from '@grafana/runtime';

export const APP_PLATFORM_GROUP = 'pathfinderbackend.ext.grafana.app';
export const APP_PLATFORM_API_VERSION = `${APP_PLATFORM_GROUP}/v1alpha1`;
const RESOURCE = 'interactiveguides';

// Grafana derives the aggregation toggle from the group name, dots→dashes.
const AGGREGATION_TOGGLE = `aggregation.${APP_PLATFORM_GROUP.replace(/\./g, '-')}.enabled`;

/**
 * True when the InteractiveGuide backend API is available on this instance
 * (the GAP aggregation toggle is on). Reads the boot-time feature toggles.
 */
export function isBackendApiAvailable(): boolean {
  const featureToggles = config.featureToggles as Record<string, boolean> | undefined;
  return featureToggles?.[AGGREGATION_TOGGLE] === true;
}

export function collectionUrl(namespace: string): string {
  return `/apis/${APP_PLATFORM_API_VERSION}/namespaces/${encodeURIComponent(namespace)}/${RESOURCE}`;
}

export function itemUrl(namespace: string, name: string): string {
  return `${collectionUrl(namespace)}/${encodeURIComponent(name)}`;
}
