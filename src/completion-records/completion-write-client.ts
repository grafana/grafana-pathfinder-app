import { getBackendSrv } from '@grafana/runtime';
import { lastValueFrom, timeout, TimeoutError } from 'rxjs';

import { PLUGIN_BACKEND_URL } from '../constants';
import { extractFetchErrorStatus } from '../lib/fetch-error';
import { currentPlatform, type GrafanaPlatform } from '../lib/platform';

import type { CompletionCategory, CompletionSource } from './types';
import { WRITE_REQUEST_TIMEOUT_MS } from './completion-write-timing';

export { WRITE_REQUEST_TIMEOUT_MS } from './completion-write-timing';

const WRITE_URL = `${PLUGIN_BACKEND_URL}/completion-records`;

/**
 * Body field carrying the queued event's stable client id. The backend derives
 * the `CompletionRecord` name deterministically from it
 * (`"completion-" + hex(sha256(key)[:16])`), so a retried POST of the same event
 * is idempotent — no duplicate durable record. Absent key → server-random name.
 * Shared contract with the write proxy (#1433).
 */
export const IDEMPOTENCY_KEY_FIELD = 'idempotencyKey';

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
 *   - route-missing: structural 404 / route not registered — the feature is not
 *                    served on this stack. Disarm network drains for the session
 *                    but KEEP persisting later facts: they survive reload and
 *                    drain on the next arm once the route exists. Never a
 *                    per-item terminal drop.
 */
export type WriteOutcome =
  { kind: 'created' } | { kind: 'terminal' } | { kind: 'transient' } | { kind: 'route-missing' };

/**
 * POST one completion fact. Never throws — returns a classified WriteOutcome.
 * `idempotencyKey` is the queued event's stable id; it is sent so the backend
 * can dedupe a retried POST into one durable record.
 */
export async function postCompletionRecord(body: CompletionWriteBody, idempotencyKey?: string): Promise<WriteOutcome> {
  try {
    await lastValueFrom(
      getBackendSrv()
        .fetch({
          url: WRITE_URL,
          method: 'POST',
          data: idempotencyKey ? { ...body, [IDEMPOTENCY_KEY_FIELD]: idempotencyKey } : body,
          showErrorAlert: false,
          showSuccessAlert: false,
        })
        .pipe(timeout({ each: WRITE_REQUEST_TIMEOUT_MS }))
    );
    return { kind: 'created' };
  } catch (err) {
    // A timeout is a network-class transient: the request may still land, and
    // the idempotency key makes a later retry safe.
    if (err instanceof TimeoutError) {
      return { kind: 'transient' };
    }
    return classifyWriteError(err);
  }
}

export const currentCompletionPlatform = currentPlatform;

function classifyWriteError(err: unknown): WriteOutcome {
  const status = extractFetchErrorStatus(err);
  // 404 is the reserved structural "route not served here" signal (route
  // absent, toggle off, no App Platform aggregation on this stack). The write
  // POSTs to the record COLLECTION, so a 404 is always structural — there is no
  // per-record 404 to confuse it with — and the proxy echoes it verbatim. The
  // resulting disarm is session-only: network drains stop but later facts keep
  // persisting and drain on the next load.
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
