import { getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';

import { PLUGIN_BACKEND_URL } from '../constants';
import { extractFetchErrorStatus } from '../lib/fetch-error';
import { currentPlatform, type GrafanaPlatform } from '../lib/platform';

import type { CompletionCategory, CompletionSource } from './types';

const WRITE_URL = `${PLUGIN_BACKEND_URL}/completion-records`;

export type CompletionPlatform = GrafanaPlatform;

/**
 * The wire payload POSTed to the write proxy. Client fact fields only; the
 * backend stamps identity/org/stack/recordedAt/schemaVersion server-side and
 * never trusts identity from this body. `platform` is a required client-supplied
 * CRD field derived from the Grafana build info at send time.
 */
export interface CompletionWriteBody {
  guideSource: string;
  guideId: string;
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
 *   - created:       successful backend response, durable — remove from queue.
 *   - terminal:      4xx (not 401/404/429) — the write can never succeed; drop it.
 *   - transient:     401 / 429 / 5xx / network — retry with exponential backoff
 *                    (401 = expired session or forwarded token, which recovers
 *                    after re-auth). The
 *                    backend sets Retry-After as a standard hint, but Grafana's
 *                    backendSrv strips response headers from its FetchError, so
 *                    the client cannot honor it.
 *   - route-missing: 404 / route not registered — the feature is unavailable on
 *                    this deployment; disarm silently (no retries).
 */
export type WriteOutcome =
  { kind: 'created' } | { kind: 'terminal' } | { kind: 'transient' } | { kind: 'route-missing' };

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

export const currentCompletionPlatform = currentPlatform;

function classifyWriteError(err: unknown): WriteOutcome {
  const status = extractFetchErrorStatus(err);
  // 404 is the reserved structural "route not deployed here" signal (route
  // absent, toggle off, no App Platform aggregation on this stack); the backend
  // remaps upstream per-record 404s to 422 so they can never land here. The
  // resulting disarm is session-only — persisted items survive for the next load.
  if (status === 404) {
    return { kind: 'route-missing' };
  }
  if (status !== undefined && status >= 400 && status < 500 && status !== 401 && status !== 429) {
    return { kind: 'terminal' };
  }
  // 401 (expired session/token — recovers after re-auth), 429, any 5xx, or no
  // status at all (network / abort) — retryable.
  return { kind: 'transient' };
}
