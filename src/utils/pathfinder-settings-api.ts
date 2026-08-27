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
 * AVAILABILITY: the GAP aggregation toggle is shared with InteractiveGuide, so
 * it says the aggregation layer is on, not that this kind is served — a stack
 * running the plugin ahead of the backend has the toggle and no
 * `pathfindersettings`. Both reads and writes therefore treat an
 * "unavailable" status as "not served here" and hand the caller back to the
 * `jsonData` fallback; only 403 is escalated, so a permission failure surfaces
 * instead of silently writing to the wrong store.
 */

import { config, getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';

import {
  PathfinderPluginConfig,
  TENANT_SETTING_BOUNDS,
  TENANT_SETTING_KEYS,
  PathfinderTenantSettings,
} from '../constants';
import { logger } from '../lib/logging';
import { recordSettingsStoreResolved } from '../lib/telemetry/facade';
import { APP_PLATFORM_API_VERSION, isBackendApiAvailable } from './interactive-guides-api';

const RESOURCE = 'pathfindersettings';

/** The singleton resource name. One settings record per stack namespace. */
export const SETTINGS_RESOURCE_NAME = 'default';

/**
 * The spec schema version this client writes. Only used when creating the
 * resource — an existing spec's version is carried forward untouched, so a
 * stack already migrated to a newer schema is never downgraded by an older app.
 */
export const SETTINGS_SCHEMA_VERSION = 1;

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
 * What a read returns beyond the config itself: the raw spec, so a write can
 * layer over fields this app version does not know about, and the
 * `resourceVersion` that makes the write a compare-and-swap rather than a
 * last-writer-wins replace.
 */
export interface PathfinderSettingsSnapshot {
  config: PathfinderPluginConfig;
  spec: Partial<PathfinderSettingsSpec>;
  resourceVersion?: string;
}

/**
 * HTTP status codes that mean "this API is not served here", as opposed to a
 * real failure. 404 also covers "the settings resource has not been created
 * yet", which is the first-run state.
 *
 * 400 is deliberately absent, unlike the set in fetchBackendGuides: these calls
 * address one object by name and send a spec this client builds, so a 400 is a
 * malformed request of ours rather than an absent API, and hiding it behind a
 * silent fallback would bury the bug.
 */
const UNAVAILABLE_STATUSES = new Set([404, 405, 501, 503]);

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
  const { devModeEnabled, schemaVersion: _schemaVersion, ...rest } = spec;
  return { ...rest, ...(devModeEnabled === undefined ? {} : { devMode: devModeEnabled }) };
}

/**
 * Holds every bounded numeric field inside the range the kind enforces.
 *
 * The apiserver rejects an out-of-range value with a 422, and a write carries
 * the whole resolved config rather than just the edited field — so a single
 * legacy `jsonData` value outside the bounds would fail the first migrating
 * save from *every* tab, not only the tab that owns it.
 */
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

/**
 * Projects a config onto the stored spec, dropping anything the kind does not
 * own. Driven by TENANT_SETTING_KEYS so a new tenant field cannot be silently
 * left out, and so per-user (`devModeOptIn`) and provisioned (`stackId`) fields
 * can never leak into the resource.
 */
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

/**
 * Reads the stack's settings resource. Returns `null` when the API is
 * unavailable or the resource does not exist yet, so the caller can fall back
 * to `jsonData`. Never throws for either case.
 */
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
      return null;
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
    return null;
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

/**
 * Writes the tenant-owned settings, creating the singleton on first save.
 *
 * `next` is the complete resolved tenant config, not a patch: the caller already
 * holds every field (it read them to render the form), and sending the whole
 * spec keeps the "one writer per field" property that the old read-modify-write
 * dance on a shared blob could not offer.
 *
 * `base` is the snapshot that same caller just read. It does two jobs the whole
 * spec cannot do on its own: its `resourceVersion` turns the replace into a
 * compare-and-swap, so two admins saving at once get a 409 rather than one
 * silently losing; and its `spec` is the write's floor, so a field a newer
 * backend added — `schemaVersion` included — survives a save from an app version
 * that has never heard of it.
 *
 * Returns false when the kind is not served here, so the caller can fall back to
 * the legacy `jsonData` write. Throws on a real failure — including 403 — so a
 * save error still surfaces to the admin rather than silently landing in the
 * wrong store.
 */
export async function savePathfinderSettings(
  next: PathfinderPluginConfig,
  base?: PathfinderSettingsSnapshot | null
): Promise<boolean> {
  if (!isSettingsApiAvailable()) {
    return false;
  }

  const namespace = config.namespace;
  const spec = { schemaVersion: SETTINGS_SCHEMA_VERSION, ...base?.spec, ...configToSpec(next) };

  try {
    await lastValueFrom(
      getBackendSrv().fetch({
        url: itemUrl(namespace),
        method: 'PUT',
        data: requestBody(spec, base?.resourceVersion),
        showErrorAlert: false,
      })
    );
    return true;
  } catch (err) {
    if (statusOf(err) !== 404) {
      throw err;
    }
  }

  // 404 on PUT: either the singleton has never been written, or the kind is not
  // served on this stack at all. Try the create; the same status set tells the
  // two apart, and an unavailable kind falls back rather than failing the save.
  try {
    await lastValueFrom(
      getBackendSrv().fetch({
        url: collectionUrl(namespace),
        method: 'POST',
        data: requestBody(spec),
        showErrorAlert: false,
      })
    );
    return true;
  } catch (err) {
    const status = statusOf(err);
    if (status && UNAVAILABLE_STATUSES.has(status)) {
      logger.warn('PathfinderSettings kind is not served here; falling back to plugin jsonData', { status });
      return false;
    }
    throw err;
  }
}
