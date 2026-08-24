/**
 * Client for the `PathfinderSettings` App Platform resource — the authoritative
 * store for tenant-owned plugin configuration.
 *
 * WHY THIS EXISTS
 *
 * Configuration used to live in the Grafana plugin-settings record
 * (`jsonData`, via `POST /api/plugins/grafana-pathfinder-app/settings`). That
 * record is also the target of Grafana Cloud plugin provisioning, and Grafana's
 * write is replace-not-merge, so the two writers overwrote each other: a config
 * save erased the provisioned `stackId` (#1514), and an instance restart erased
 * every admin setting by re-asserting the provisioned blob. Settings now have
 * their own resource with their own RBAC, and `jsonData` belongs to provisioning.
 *
 * SINGLETON: exactly one resource per namespace, named `SETTINGS_RESOURCE_NAME`.
 * App Platform namespaces are per-stack, so that is one settings record per
 * stack.
 *
 * AVAILABILITY: gated on the same GAP aggregation toggle as InteractiveGuide, so
 * it degrades cleanly to the `jsonData` fallback on OSS, self-managed, and local
 * dev. Callers get `null` rather than a throw when the API is not there.
 */

import { config, getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';

import { PathfinderPluginConfig, TENANT_SETTING_KEYS, PathfinderTenantSettings } from '../constants';
import { logger } from '../lib/logging';
import { APP_PLATFORM_API_VERSION, isBackendApiAvailable } from './interactive-guides-api';

const RESOURCE = 'pathfindersettings';

/** The singleton resource name. One settings record per stack namespace. */
export const SETTINGS_RESOURCE_NAME = 'default';

/**
 * The kind's `spec`. Mirrors kinds/pathfindersettings.cue in
 * grafana-pathfinder-backend; `devModeEnabled` is the stored name for the
 * client-side `devMode` gate, and `schemaVersion` lets the spec be corrected
 * without an apiVersion bump.
 */
export interface PathfinderSettingsSpec extends Omit<PathfinderTenantSettings, 'devMode'> {
  devModeEnabled: boolean;
  schemaVersion: number;
}

interface PathfinderSettingsResource {
  metadata?: { name?: string; resourceVersion?: string };
  spec?: Partial<PathfinderSettingsSpec>;
}

/**
 * HTTP status codes that mean "this API is not available here", as opposed to a
 * real failure. Mirrors the set in fetchBackendGuides.ts; 404 also covers "the
 * settings resource has not been created yet", which is the first-run state.
 */
const UNAVAILABLE_STATUSES = new Set([400, 403, 404, 405, 501, 503]);

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

/**
 * True when the settings API can be used on this instance. Both the aggregation
 * toggle and a namespace are required — `config.namespace` is empty on some
 * self-managed builds.
 */
export function isSettingsApiAvailable(): boolean {
  return isBackendApiAvailable() && Boolean(config.namespace);
}

/** Maps a stored spec onto the client-side config shape. */
export function specToConfig(spec: Partial<PathfinderSettingsSpec>): PathfinderPluginConfig {
  const { devModeEnabled, schemaVersion, ...rest } = spec;
  void schemaVersion;
  return { ...rest, ...(devModeEnabled === undefined ? {} : { devMode: devModeEnabled }) };
}

/**
 * Projects a config onto the stored spec, dropping anything the kind does not
 * own. Driven by TENANT_SETTING_KEYS so a new tenant field cannot be silently
 * left out, and so per-user (`devModeOptIn`) and provisioned (`stackId`) fields
 * can never leak into the resource.
 */
export function configToSpec(cfg: PathfinderPluginConfig): Partial<PathfinderSettingsSpec> {
  const spec: Record<string, unknown> = {};
  for (const key of TENANT_SETTING_KEYS) {
    const value = cfg[key];
    if (value === undefined) {
      continue;
    }
    // `devMode` is the client name for the stored `devModeEnabled`.
    spec[key === 'devMode' ? 'devModeEnabled' : key] = value;
  }
  return spec as Partial<PathfinderSettingsSpec>;
}

/**
 * Reads the stack's settings. Returns `null` when the API is unavailable or the
 * resource does not exist yet, so the caller can fall back to `jsonData`.
 * Never throws for either case.
 */
export async function fetchPathfinderSettings(): Promise<PathfinderPluginConfig | null> {
  if (!isSettingsApiAvailable()) {
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
    return response.data?.spec ? specToConfig(response.data.spec) : null;
  } catch (err) {
    const status = statusOf(err);
    if (status && UNAVAILABLE_STATUSES.has(status)) {
      return null;
    }
    logger.warn('Failed to read Pathfinder settings resource', { error: err });
    return null;
  }
}

/**
 * Writes the tenant-owned settings, creating the singleton on first save.
 *
 * `next` is the complete resolved tenant config, not a patch: the caller already
 * holds every field (it read them to render the form), and sending the whole
 * spec keeps the "one writer per field" property that the old read-modify-write
 * dance on a shared blob could not offer.
 *
 * Returns false when the API is unavailable, so the caller can fall back to the
 * legacy `jsonData` write. Throws on a real failure, so a save error still
 * surfaces to the admin.
 */
export async function savePathfinderSettings(next: PathfinderPluginConfig): Promise<boolean> {
  if (!isSettingsApiAvailable()) {
    return false;
  }

  const namespace = config.namespace;
  const spec = configToSpec(next);

  try {
    await lastValueFrom(
      getBackendSrv().fetch({
        url: itemUrl(namespace),
        method: 'PUT',
        data: {
          apiVersion: APP_PLATFORM_API_VERSION,
          kind: 'PathfinderSettings',
          metadata: { name: SETTINGS_RESOURCE_NAME },
          spec,
        },
        showErrorAlert: false,
      })
    );
    return true;
  } catch (err) {
    if (statusOf(err) !== 404) {
      throw err;
    }
  }

  // 404 on PUT: the singleton has never been written. Create it.
  await lastValueFrom(
    getBackendSrv().fetch({
      url: collectionUrl(namespace),
      method: 'POST',
      data: {
        apiVersion: APP_PLATFORM_API_VERSION,
        kind: 'PathfinderSettings',
        metadata: { name: SETTINGS_RESOURCE_NAME },
        spec,
      },
      showErrorAlert: false,
    })
  );
  return true;
}
