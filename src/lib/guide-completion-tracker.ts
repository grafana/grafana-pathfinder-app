/**
 * Writes GuideCompletion CRD resources to the backend API.
 *
 * Each user+guide pair maps to a single CRD resource with a deterministic name.
 * Progress updates (partial or full) update the same resource in place.
 *
 * Fire-and-forget: failures are logged but never block the UI.
 * Falls back silently when the backend API is unavailable.
 */

import { config, getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';
import { isBackendApiAvailable } from '../utils/fetchBackendGuides';
import type { GuideCompletionSpec, GuideCompletionResource } from '../types/guide-completion.types';

// ============================================================================
// SESSION TRACKING
// ============================================================================

interface SessionInfo {
  startedAt: number;
  guideTitle: string;
  guideCategory: GuideCompletionSpec['guideCategory'];
}

/** Maps guideId → session info when the guide was first opened */
const sessions = new Map<string, SessionInfo>();

/** Maps guideId → last written completion percent (to prevent regression) */
const lastWrittenPercent = new Map<string, number>();

/** Maps guideId → in-flight upsert promise (to serialize writes) */
const inflightWrites = new Map<string, Promise<void>>();

/** Cache of resourceVersion per resource name, used for PUT updates */
const resourceVersions = new Map<string, string>();

/**
 * Records when a guide session begins. Call this when the user opens a guide.
 * Stores title and category so they're available at completion time.
 * If a session is already active for this guide, it is not overwritten.
 */
export function startGuideSession(
  guideId: string,
  guideTitle: string,
  guideCategory: GuideCompletionSpec['guideCategory']
): void {
  if (!sessions.has(guideId)) {
    sessions.set(guideId, { startedAt: Date.now(), guideTitle, guideCategory });
  }
}

/**
 * Returns the stored session metadata for a guide, if any.
 */
export function getSessionInfo(guideId: string): SessionInfo | undefined {
  return sessions.get(guideId);
}

function getSessionDuration(guideId: string): number {
  const session = sessions.get(guideId);
  if (!session) {
    return 0;
  }
  return Math.round((Date.now() - session.startedAt) / 1000);
}

function clearSession(guideId: string): void {
  sessions.delete(guideId);
  lastWrittenPercent.delete(guideId);
}

// ============================================================================
// HELPERS
// ============================================================================

function getPlatform(): 'oss' | 'cloud' {
  try {
    return config.bootData.settings.buildInfo.versionString.startsWith('Grafana Cloud') ? 'cloud' : 'oss';
  } catch {
    return 'oss';
  }
}

/** Sanitize a string for use in a K8s resource name (RFC 1123 subdomain) */
function sanitizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Deterministic resource name for a user+guide pair */
function resourceName(userLogin: string, guideId: string): string {
  return `${sanitizeName(userLogin)}.${sanitizeName(guideId)}`;
}

function baseUrl(): string {
  const namespace = config.namespace;
  return `/apis/pathfinderbackend.ext.grafana.com/v1alpha1/namespaces/${namespace}/guidecompletions`;
}

function buildResource(name: string, namespace: string, spec: GuideCompletionSpec, rv?: string) {
  return {
    apiVersion: 'pathfinderbackend.ext.grafana.com/v1alpha1' as const,
    kind: 'GuideCompletion' as const,
    metadata: {
      name,
      namespace,
      ...(rv ? { resourceVersion: rv } : {}),
    },
    spec,
  };
}

function getHttpStatus(err: unknown): number | undefined {
  return (
    (err as { status?: number })?.status ??
    (err as { statusCode?: number })?.statusCode ??
    (err as { data?: { statusCode?: number } })?.data?.statusCode ??
    (err as { data?: { code?: number } })?.data?.code
  );
}

/**
 * Creates or updates a GuideCompletion resource.
 * - Tries PUT if we have a cached resourceVersion
 * - Falls back to POST on 404 (resource doesn't exist yet)
 * - Falls back to GET+PUT on 409 (conflict / resource already exists)
 */
async function upsertCompletion(spec: GuideCompletionSpec): Promise<void> {
  const namespace = config.namespace;
  if (!namespace) {
    return;
  }

  const name = resourceName(spec.userLogin, spec.guideId);
  const cachedRv = resourceVersions.get(name);
  const url = baseUrl();

  // If we have a resourceVersion, try PUT (update) first
  if (cachedRv) {
    try {
      const resp = await lastValueFrom(
        getBackendSrv().fetch<GuideCompletionResource>({
          url: `${url}/${name}`,
          method: 'PUT',
          data: buildResource(name, namespace, spec, cachedRv),
          showErrorAlert: false,
        })
      );
      resourceVersions.set(name, resp.data.metadata.resourceVersion ?? cachedRv);
      return;
    } catch (err) {
      const status = getHttpStatus(err);
      if (status === 409) {
        // Conflict — resourceVersion is stale, fetch latest and retry
        await fetchAndUpdate(name, namespace, spec);
        return;
      }
      if (status === 404) {
        // Resource was deleted — fall through to create
      } else {
        console.warn('Failed to update guide completion:', err);
        return;
      }
    }
  }

  // No cached resourceVersion or 404 — try POST (create)
  try {
    const resp = await lastValueFrom(
      getBackendSrv().fetch<GuideCompletionResource>({
        url,
        method: 'POST',
        data: buildResource(name, namespace, spec),
        showErrorAlert: false,
      })
    );
    resourceVersions.set(name, resp.data.metadata.resourceVersion ?? '');
  } catch (err) {
    const status = getHttpStatus(err);
    if (status === 409) {
      // Already exists — fetch and update
      await fetchAndUpdate(name, namespace, spec);
    } else {
      console.warn('Failed to create guide completion:', err);
    }
  }
}

/** Fetch the current resource, then PUT with updated spec */
async function fetchAndUpdate(name: string, namespace: string, spec: GuideCompletionSpec): Promise<void> {
  try {
    const getResp = await lastValueFrom(
      getBackendSrv().fetch<GuideCompletionResource>({
        url: `${baseUrl()}/${name}`,
        method: 'GET',
        showErrorAlert: false,
      })
    );
    const rv = getResp.data.metadata.resourceVersion ?? '';
    const putResp = await lastValueFrom(
      getBackendSrv().fetch<GuideCompletionResource>({
        url: `${baseUrl()}/${name}`,
        method: 'PUT',
        data: buildResource(name, namespace, spec, rv),
        showErrorAlert: false,
      })
    );
    resourceVersions.set(name, putResp.data.metadata.resourceVersion ?? rv);
  } catch (err) {
    console.warn('Failed to fetch+update guide completion:', err);
  }
}

function buildSpec(
  opts: {
    guideId: string;
    guideTitle: string;
    guideCategory: GuideCompletionSpec['guideCategory'];
    pathId: string;
    durationSeconds: number;
    completionPercent: number;
  },
  user: { login: string; name: string }
): GuideCompletionSpec {
  return {
    userLogin: user.login,
    userDisplayName: user.name || user.login,
    guideId: opts.guideId,
    guideTitle: opts.guideTitle,
    pathId: opts.pathId,
    completedAt: opts.completionPercent >= 100 ? new Date().toISOString() : '',
    durationSeconds: opts.durationSeconds,
    completionPercent: opts.completionPercent,
    guideCategory: opts.guideCategory,
    platform: getPlatform(),
  };
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Records a full guide completion (100%) to the backend CRD API.
 * Creates or updates the single resource for this user+guide pair.
 * Automatically computes duration from the tracked session start time.
 */
export function recordGuideCompletion(opts: {
  guideId: string;
  guideTitle: string;
  guideCategory: GuideCompletionSpec['guideCategory'];
  pathId: string;
  completionPercent?: number;
}): void {
  if (!isBackendApiAvailable()) {
    return;
  }

  const user = config.bootData?.user;
  if (!user?.login) {
    return;
  }

  const session = getSessionInfo(opts.guideId);
  const durationSeconds = getSessionDuration(opts.guideId);
  clearSession(opts.guideId);

  const spec = buildSpec(
    {
      guideId: opts.guideId,
      guideTitle: opts.guideTitle === opts.guideId && session ? session.guideTitle : opts.guideTitle,
      guideCategory: session?.guideCategory ?? opts.guideCategory,
      pathId: opts.pathId,
      durationSeconds,
      completionPercent: opts.completionPercent ?? 100,
    },
    user
  );

  console.debug('[GuideCompletion] Recording completion for', opts.guideId, `${spec.completionPercent}%`);
  upsertCompletion(spec).catch((err) => {
    console.warn('Failed to record guide completion:', err);
  });
}

/**
 * Records partial progress to the backend CRD API.
 * Updates the same resource that will later hold the full completion.
 * Throttled to at most one write per guide per 30s.
 */
export function recordPartialProgress(opts: {
  guideId: string;
  guideTitle: string;
  guideCategory: GuideCompletionSpec['guideCategory'];
  pathId: string;
  completionPercent: number;
}): void {
  if (!isBackendApiAvailable() || opts.completionPercent >= 100) {
    return;
  }

  const user = config.bootData?.user;
  if (!user?.login) {
    return;
  }

  // Never regress — skip if new percentage is not higher than last written
  const prevPercent = lastWrittenPercent.get(opts.guideId) ?? 0;
  if (opts.completionPercent <= prevPercent) {
    console.debug(
      '[GuideCompletion] Skipping regression for',
      opts.guideId,
      `${opts.completionPercent}% <= ${prevPercent}%`
    );
    return;
  }

  lastWrittenPercent.set(opts.guideId, opts.completionPercent);

  console.debug('[GuideCompletion] Recording partial progress for', opts.guideId, `${opts.completionPercent}%`);
  const durationSeconds = getSessionDuration(opts.guideId);
  const spec = buildSpec({ ...opts, durationSeconds }, user);

  // Chain writes so they don't race each other on resourceVersion
  const prev = inflightWrites.get(opts.guideId) ?? Promise.resolve();
  const next = prev
    .then(() => upsertCompletion(spec))
    .catch((err) => {
      console.warn('Failed to record partial progress:', err);
    });
  inflightWrites.set(opts.guideId, next);
}
