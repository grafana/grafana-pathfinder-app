import { config, getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';

import {
  PathfinderPluginConfig,
  TENANT_SETTING_BOUNDS,
  TENANT_SETTING_KEYS,
  PathfinderTenantSettings,
} from '../constants';
import { logger } from '../lib/logging';
import type { SettingsStoreOutcome } from '../lib/telemetry/facade';
import { APP_PLATFORM_API_VERSION, isBackendApiAvailable } from './interactive-guides-api';

const RESOURCE = 'pathfindersettings';

function recordSettingsStoreResolved(outcome: SettingsStoreOutcome): void {
  void import('../lib/telemetry/facade')
    .then((telemetry) => telemetry.recordSettingsStoreResolved(outcome))
    .catch(() => undefined);
}

export const SETTINGS_RESOURCE_NAME = 'default';

export const SETTINGS_SCHEMA_VERSION = 1;

export interface PathfinderSettingsSpec extends Omit<PathfinderTenantSettings, 'devMode'> {
  devModeEnabled: boolean;
  schemaVersion: number;
}

interface PathfinderSettingsResource {
  metadata?: { name?: string; resourceVersion?: string };
  spec?: Partial<PathfinderSettingsSpec>;
}

export interface PathfinderSettingsSnapshot {
  config: PathfinderPluginConfig;
  spec: Partial<PathfinderSettingsSpec>;
  resourceVersion?: string;
}

const UNAVAILABLE_STATUSES = new Set([404, 405, 501]);
const RETRYABLE_UPDATE_STATUSES = new Set([404, 405, 500, 501, 502, 503, 504]);
const UPDATE_RETRY_DELAYS_MS = [250, 750];

function statusOf(err: unknown): number | undefined {
  const e = err as { status?: number; statusCode?: number; data?: { statusCode?: number } };
  return e?.status ?? e?.statusCode ?? e?.data?.statusCode;
}

export function collectionUrl(namespace: string): string {
  return `/apis/${APP_PLATFORM_API_VERSION}/namespaces/${encodeURIComponent(namespace)}/${RESOURCE}`;
}

export function itemUrl(namespace: string, name: string = SETTINGS_RESOURCE_NAME): string {
  return `${collectionUrl(namespace)}/${encodeURIComponent(name)}`;
}

export function isSettingsApiAvailable(): boolean {
  return isBackendApiAvailable() && Boolean(config.namespace);
}

export function specToConfig(spec: Partial<PathfinderSettingsSpec>): PathfinderPluginConfig {
  const result: Record<string, unknown> = {};
  for (const key of TENANT_SETTING_KEYS) {
    const value = spec[key === 'devMode' ? 'devModeEnabled' : key];
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as PathfinderPluginConfig;
}

export function clampToKindBounds(cfg: PathfinderPluginConfig): PathfinderPluginConfig {
  const clamped: PathfinderPluginConfig = { ...cfg };

  for (const [key, { min, max }] of Object.entries(TENANT_SETTING_BOUNDS)) {
    const value = clamped[key as keyof typeof TENANT_SETTING_BOUNDS];
    if (typeof value !== 'number' || Number.isNaN(value)) {
      continue;
    }
    clamped[key as keyof typeof TENANT_SETTING_BOUNDS] = Math.min(max, Math.max(min, Math.trunc(value)));
  }

  return clamped;
}

export function configToSpec(cfg: PathfinderPluginConfig): Partial<PathfinderSettingsSpec> {
  const bounded = clampToKindBounds(cfg);
  const spec: Record<string, unknown> = {};

  for (const key of TENANT_SETTING_KEYS) {
    const value = bounded[key];
    if (value === undefined) {
      continue;
    }
    // `devMode` is the client name for the stored `devModeEnabled`.
    spec[key === 'devMode' ? 'devModeEnabled' : key] = value;
  }

  return spec as Partial<PathfinderSettingsSpec>;
}

export async function fetchPathfinderSettingsSnapshot(): Promise<PathfinderSettingsSnapshot | null> {
  if (!isSettingsApiAvailable()) {
    recordSettingsStoreResolved('api-unavailable');
    return null;
  }

  try {
    const response = await lastValueFrom(
      getBackendSrv().fetch<PathfinderSettingsResource>({
        url: itemUrl(config.namespace),
        method: 'GET',
        showErrorAlert: false,
      })
    );

    const spec = response.data?.spec;
    if (!spec) {
      recordSettingsStoreResolved('empty-spec');
      throw new Error('Pathfinder settings response has no spec');
    }
    if (!response.data?.metadata?.resourceVersion) {
      throw new Error('Pathfinder settings response has no resource version');
    }

    recordSettingsStoreResolved('resource');
    return { config: specToConfig(spec), spec, resourceVersion: response.data?.metadata?.resourceVersion };
  } catch (err) {
    const status = statusOf(err);
    if (status && UNAVAILABLE_STATUSES.has(status)) {
      recordSettingsStoreResolved(status === 404 ? 'not-created' : 'kind-not-served');
      return null;
    }
    if (status === 403) {
      recordSettingsStoreResolved('forbidden');
    } else {
      recordSettingsStoreResolved('read-error');
      logger.warn('Failed to read Pathfinder settings resource', { error: err });
    }
    throw err;
  }
}

function requestBody(spec: Partial<PathfinderSettingsSpec>, resourceVersion?: string) {
  return {
    apiVersion: APP_PLATFORM_API_VERSION,
    kind: 'PathfinderSettings',
    metadata: { name: SETTINGS_RESOURCE_NAME, ...(resourceVersion ? { resourceVersion } : {}) },
    spec,
  };
}

export async function savePathfinderSettings(
  next: PathfinderPluginConfig,
  base: PathfinderSettingsSnapshot | null = null
): Promise<boolean> {
  if (!isSettingsApiAvailable()) {
    if (base) {
      throw new Error('Pathfinder settings API became unavailable; retry the save');
    }
    return false;
  }
  if (base && !base.resourceVersion) {
    throw new Error('Cannot update Pathfinder settings without a resource version');
  }

  const spec = { schemaVersion: SETTINGS_SCHEMA_VERSION, ...base?.spec, ...configToSpec(next) };
  const request = {
    url: base ? itemUrl(config.namespace) : collectionUrl(config.namespace),
    method: base ? 'PUT' : 'POST',
    data: requestBody(spec, base?.resourceVersion),
    showErrorAlert: false,
  };
  for (let attempt = 0; ; attempt++) {
    try {
      await lastValueFrom(getBackendSrv().fetch(request));
      return true;
    } catch (err) {
      const status = statusOf(err);
      if (base && status && RETRYABLE_UPDATE_STATUSES.has(status) && attempt < UPDATE_RETRY_DELAYS_MS.length) {
        // Reuse the read version: even an ambiguous prior success cannot overwrite a concurrent edit.
        await new Promise((resolve) => setTimeout(resolve, UPDATE_RETRY_DELAYS_MS[attempt]));
        continue;
      }
      // Existing resources remain authoritative when service recovers; a legacy write would be hidden.
      if (!base && status && UNAVAILABLE_STATUSES.has(status)) {
        return false;
      }
      throw err;
    }
  }
}
