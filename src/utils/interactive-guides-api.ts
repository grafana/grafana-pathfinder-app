/**
 * Shared client for the InteractiveGuide App Platform API.
 *
 * Owns the API group/version, toggle-derived availability, URL building, and
 * the migration shims (read-with-fallback + dual-write) for the transition from
 * the old Cloud App Platform group (`pathfinderbackend.ext.grafana.com`) to the
 * new Grafana App Platform group (`pathfinderbackend.ext.grafana.app`).
 *
 * During the transition both groups may be live: reads union both, writes go to
 * both (new is authoritative, old is best-effort). Once the old group is retired
 * (its toggle off) the dual paths collapse to the single available group with no
 * code change; the dual-write can then be dropped.
 */
import { config, getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';

import { logger } from '../lib/logging';

export const GROUP_NEW = 'pathfinderbackend.ext.grafana.app';
export const GROUP_OLD = 'pathfinderbackend.ext.grafana.com';
const API_VERSION = 'v1alpha1';
const RESOURCE = 'interactiveguides';

export type GroupKey = 'new' | 'old';

const GROUP_STRING: Record<GroupKey, string> = { new: GROUP_NEW, old: GROUP_OLD };

/** `<group>/<version>` — for a resource body's `apiVersion` and the URL path. */
export function apiVersionFor(group: GroupKey): string {
  return `${GROUP_STRING[group]}/${API_VERSION}`;
}

/**
 * Aggregation feature-toggle name for a group. Grafana derives it from the group
 * by replacing dots with dashes, e.g.
 * `pathfinderbackend.ext.grafana.app` → `aggregation.pathfinderbackend-ext-grafana-app.enabled`.
 * NOTE: the new-group toggle name is assumed to follow this derivation; confirm
 * with the GAP team. Availability is resilient regardless (see resolveAvailability).
 */
function toggleNameForGroup(group: GroupKey): string {
  return `aggregation.${GROUP_STRING[group].replace(/\./g, '-')}.enabled`;
}

function isGroupToggleOn(group: GroupKey): boolean {
  const featureToggles = config.featureToggles as Record<string, boolean> | undefined;
  return featureToggles?.[toggleNameForGroup(group)] === true;
}

export interface GroupAvailability {
  newAvailable: boolean;
  oldAvailable: boolean;
}

export function resolveAvailability(): GroupAvailability {
  return { newAvailable: isGroupToggleOn('new'), oldAvailable: isGroupToggleOn('old') };
}

/** Groups to target, new first, for the current stack. */
function activeGroups(): GroupKey[] {
  const { newAvailable, oldAvailable } = resolveAvailability();
  const groups: GroupKey[] = [];
  if (newAvailable) {
    groups.push('new');
  }
  if (oldAvailable) {
    groups.push('old');
  }
  return groups;
}

/**
 * True when the InteractiveGuide backend API is reachable on this instance via
 * either the new or the legacy aggregation toggle — resilient to the exact new
 * toggle name.
 */
export function isBackendApiAvailable(): boolean {
  const { newAvailable, oldAvailable } = resolveAvailability();
  return newAvailable || oldAvailable;
}

/** HTTP statuses meaning a group's API isn't rolled out — fall through to the next. */
export const UNAVAILABLE_STATUSES = new Set([400, 403, 404, 405, 501, 503]);

export function extractStatus(err: unknown): number | undefined {
  const e = err as { status?: number; statusCode?: number; data?: { statusCode?: number } };
  return e?.status ?? e?.statusCode ?? e?.data?.statusCode;
}

function isUnavailableError(err: unknown): boolean {
  const status = extractStatus(err);
  return status !== undefined && UNAVAILABLE_STATUSES.has(status);
}

export function collectionUrl(apiVersion: string, namespace: string): string {
  return `/apis/${apiVersion}/namespaces/${namespace}/${RESOURCE}`;
}

export function itemUrl(apiVersion: string, namespace: string, name: string): string {
  return `${collectionUrl(apiVersion, namespace)}/${encodeURIComponent(name)}`;
}

type UrlBuilder = (apiVersion: string) => string;

export type ReadItemResult<T> = { ok: true; data: T; group: GroupKey } | { ok: false; reason: 'unavailable' };

/**
 * GET a single resource, new group first, falling back to old on an
 * "unavailable" status (or 404). Genuine errors (5xx/network) are re-thrown so
 * callers can distinguish "not rolled out" from "broken".
 */
export async function readItemWithFallback<T>(buildUrl: UrlBuilder): Promise<ReadItemResult<T>> {
  const groups = activeGroups();
  if (groups.length === 0) {
    return { ok: false, reason: 'unavailable' };
  }
  for (const group of groups) {
    try {
      const response = await lastValueFrom(
        getBackendSrv().fetch<T>({ url: buildUrl(apiVersionFor(group)), method: 'GET', showErrorAlert: false })
      );
      return { ok: true, data: response.data, group };
    } catch (err) {
      if (isUnavailableError(err)) {
        continue;
      }
      throw err;
    }
  }
  return { ok: false, reason: 'unavailable' };
}

interface K8sList<I> {
  items?: I[];
}

interface NamedItem {
  metadata?: { name?: string };
}

/**
 * LIST from every available group and union the items, deduped by
 * `metadata.name` (new wins). Union — not new-first-fallback — is required
 * during the migration: a successful *empty* 200 from the new group (before the
 * old→new backfill runs) wouldn't trigger a fallback, and best-effort writes to
 * the old group can silently fail, so neither group is a guaranteed superset.
 */
export async function readListMerged<I extends NamedItem>(buildUrl: UrlBuilder): Promise<I[]> {
  const groups = activeGroups(); // new first
  if (groups.length === 0) {
    return [];
  }
  const byName = new Map<string, I>();
  const unnamed: I[] = [];
  for (const group of groups) {
    let items: I[] = [];
    try {
      const response = await lastValueFrom(
        getBackendSrv().fetch<K8sList<I>>({ url: buildUrl(apiVersionFor(group)), method: 'GET', showErrorAlert: false })
      );
      items = response.data?.items ?? [];
    } catch (err) {
      if (isUnavailableError(err)) {
        continue;
      }
      throw err;
    }
    for (const item of items) {
      const name = item.metadata?.name;
      if (!name) {
        unnamed.push(item);
      } else if (!byName.has(name)) {
        // First writer wins; groups are new-first, so the new group's copy wins.
        byName.set(name, item);
      }
    }
  }
  return [...byName.values(), ...unnamed];
}

export interface DualWriteArgs {
  method: 'POST' | 'PUT' | 'DELETE';
  buildUrl: UrlBuilder;
  /** Receives the target group's apiVersion so the body's `apiVersion` matches its destination. */
  buildBody?: (apiVersion: string) => unknown;
}

export interface DualWriteResult {
  primaryGroup: GroupKey;
  secondaryFailures: GroupKey[];
}

/**
 * Write to every available group. The primary (new if available, else old) is
 * authoritative — its failure throws and is the user-visible error. Secondary
 * writes are best-effort: failures are logged and collected, never thrown, so a
 * group-scoped `resourceVersion` 409 or a not-yet-backfilled 404 on the old
 * group can't block a successful primary write.
 */
export async function dualWrite(args: DualWriteArgs): Promise<DualWriteResult> {
  const groups = activeGroups(); // new first
  if (groups.length === 0) {
    throw new Error('Pathfinder backend API is not available');
  }
  const primary = groups[0]!;
  const secondaries = groups.slice(1);

  await writeOne(primary, args);

  const secondaryFailures: GroupKey[] = [];
  for (const group of secondaries) {
    try {
      await writeOne(group, args);
    } catch (err) {
      secondaryFailures.push(group);
      logger.warn('[interactive-guides-api] secondary dual-write failed', {
        group,
        method: args.method,
        status: extractStatus(err),
      });
    }
  }
  return { primaryGroup: primary, secondaryFailures };
}

async function writeOne(group: GroupKey, args: DualWriteArgs): Promise<void> {
  const apiVersion = apiVersionFor(group);
  await lastValueFrom(
    getBackendSrv().fetch({
      url: args.buildUrl(apiVersion),
      method: args.method,
      data: args.buildBody ? args.buildBody(apiVersion) : undefined,
      showErrorAlert: false,
    })
  );
}
