/**
 * Front-end client for the durable completion-write proxy (Track 2).
 *
 * Two calls against the plugin backend added in this epic:
 *   - GET  /completion-records/capability — does this stack support durable
 *     completion recording? (App Platform aggregation present + identity).
 *   - POST /completion-records — persist one completion fact.
 *
 * Both fail SOFT and never throw: a completion must never be disturbed by the
 * write path. Every failure is classified into the outcome the retry queue acts
 * on. Per the captain's deployment-skew tolerance, a MISSING route (404 / route
 * not registered on an older plugin backend, or the whole family absent) is a
 * terminal "feature unavailable" signal — never a transient to retry.
 */

import { getBackendSrv, config } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';

import { PLUGIN_BACKEND_URL } from '../constants';

import type { CompletionCategory, CompletionKind, CompletionSource } from './types';

const CAPABILITY_URL = `${PLUGIN_BACKEND_URL}/completion-records/capability`;
const WRITE_URL = `${PLUGIN_BACKEND_URL}/completion-records`;

export type CompletionPlatform = 'oss' | 'cloud';

/**
 * The wire payload POSTed to the write proxy. Client fact fields only; the
 * backend stamps identity/org/stack/recordedAt/schemaVersion server-side and
 * never trusts identity from this body. `platform` is a required client-supplied
 * CRD field derived from the Grafana build info at send time.
 */
export interface CompletionWriteBody {
  guideSource: string;
  guideId: string;
  kind: CompletionKind;
  guideTitle: string;
  guideCategory: CompletionCategory;
  pathId?: string;
  completionPercent: number;
  source: CompletionSource;
  completedAt: string;
  durationMs?: number;
  platform: CompletionPlatform;
}

/**
 * The outcome of a write attempt, mirroring the Layer A response contract:
 *   - created:       2xx, durable — remove from queue.
 *   - terminal:      4xx (not 404/429) — the write can never succeed; drop it.
 *   - transient:     429 / 5xx / network — retry with backoff (honoring
 *                    retryAfterMs when the upstream provided Retry-After).
 *   - route-missing: 404 / route not registered — the feature is unavailable on
 *                    this deployment; disarm silently (no retries).
 */
export type WriteOutcome =
  { kind: 'created' } | { kind: 'terminal' } | { kind: 'transient'; retryAfterMs?: number } | { kind: 'route-missing' };

/**
 * Probe whether durable completion recording is available on this stack. Returns
 * true ONLY on an explicit `{ available: true }`. Anything else — a missing
 * route (404), a transient blip, or `available: false` — returns false, so the
 * queue never arms. Never throws. Re-probed on a later session (no in-session
 * polling), so a stack that later gains the backend starts recording then.
 */
export async function fetchCompletionCapability(): Promise<boolean> {
  try {
    const resp = await lastValueFrom(
      getBackendSrv().fetch<{ available?: boolean }>({
        url: CAPABILITY_URL,
        method: 'GET',
        showErrorAlert: false,
        showSuccessAlert: false,
      })
    );
    return resp?.data?.available === true;
  } catch {
    return false;
  }
}

/**
 * POST one completion fact. Never throws — returns a classified WriteOutcome.
 */
export async function postCompletionRecord(body: CompletionWriteBody): Promise<WriteOutcome> {
  try {
    await lastValueFrom(
      getBackendSrv().fetch({
        url: WRITE_URL,
        method: 'POST',
        data: body,
        showErrorAlert: false,
        showSuccessAlert: false,
      })
    );
    return { kind: 'created' };
  } catch (err) {
    return classifyWriteError(err);
  }
}

/**
 * The current platform, mirroring ContextService.getCurrentPlatform: Grafana
 * Cloud builds report a "Grafana Cloud" version string. Fails soft to 'oss'.
 */
export function currentCompletionPlatform(): CompletionPlatform {
  try {
    return config.bootData?.settings?.buildInfo?.versionString?.startsWith('Grafana Cloud') ? 'cloud' : 'oss';
  } catch {
    return 'oss';
  }
}

function classifyWriteError(err: unknown): WriteOutcome {
  const status = extractStatus(err);
  if (status === 404) {
    return { kind: 'route-missing' };
  }
  if (status !== undefined && status >= 400 && status < 500 && status !== 429) {
    return { kind: 'terminal' };
  }
  // 429, any 5xx, or no status at all (network / abort) — retryable.
  return { kind: 'transient', retryAfterMs: extractRetryAfterMs(err) };
}

function extractStatus(err: unknown): number | undefined {
  const e = err as { status?: number; statusCode?: number; data?: { statusCode?: number } } | undefined;
  return e?.status ?? e?.statusCode ?? e?.data?.statusCode;
}

function extractRetryAfterMs(err: unknown): number | undefined {
  const headers = (err as { headers?: { get?: (name: string) => string | null } } | undefined)?.headers;
  const raw = headers?.get?.('Retry-After');
  if (!raw) {
    return undefined;
  }
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return undefined;
  }
  return Math.round(seconds * 1000);
}
