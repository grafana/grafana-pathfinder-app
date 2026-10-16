/**
 * Client for the /assignments/my backend proxy (pkg/plugin/assignments.go).
 * Satisfaction is evaluated live server-side, so only in-flight requests are shared, never a result.
 *
 * @coupling API: GET /assignments/my served by pkg/plugin/assignments.go
 */
import { getBackendSrv } from '@grafana/runtime';

import { PLUGIN_BACKEND_URL } from '../constants';
import type { AssignmentEntryWire, MyAssignmentsResponseWire } from '../types/backend-api.schema';
import { isBackendApiRuledOut } from '../utils/interactive-guides-api';
import { classifyRequestFailure } from './fetch-error';
import { logger } from './logging';
import { recordAssignmentsUnavailable } from './telemetry/facade';

/** Wire shape of one assignment. The target is (targetType, targetId); this client does not filter on targetType. */
export type AssignmentEntry = AssignmentEntryWire;

const ASSIGNMENTS_URL = `${PLUGIN_BACKEND_URL}/assignments/my`;

// Several surfaces fetch on open concurrently; a stored TTL would stale the live evaluation.
const inflight = new Map<string, Promise<MyAssignmentsResult>>();

/** `ok: false` means the listing could not be read, so callers must keep any last good state rather than treat it as empty. */
export type MyAssignmentsResult = { ok: true; assignments: AssignmentEntry[] } | { ok: false };

const FETCH_FAILED: MyAssignmentsResult = { ok: false };
const NOTHING_ASSIGNED: MyAssignmentsResult = { ok: true, assignments: [] };

function reportFetchFailure(err: unknown): void {
  try {
    const reason = classifyRequestFailure(err);
    logger.warn('[assignments] fetch failed', { reason });
    recordAssignmentsUnavailable(reason);
  } catch {
    // Observability must not turn a swallowed listing failure into a rejection.
  }
}

const MALFORMED_REASON = 'malformed-response';

async function requestAssignments(): Promise<MyAssignmentsResult> {
  const response = await getBackendSrv().get<MyAssignmentsResponseWire>(ASSIGNMENTS_URL, undefined, undefined, {
    showErrorAlert: false,
    showSuccessAlert: false,
  });
  if (!response?.capability?.available) {
    const reason = response?.capability?.reason ?? 'unknown';
    logger.warn('[assignments] unavailable', { reason });
    recordAssignmentsUnavailable(reason);
    return FETCH_FAILED;
  }
  if (!Array.isArray(response.assignments)) {
    logger.warn('[assignments] malformed response', { reason: MALFORMED_REASON });
    recordAssignmentsUnavailable(MALFORMED_REASON);
    return FETCH_FAILED;
  }
  return { ok: true, assignments: response.assignments };
}

/**
 * Fetch the caller's assignments; best-effort. A capability-unavailable, failed or malformed
 * answer is `ok: false`. Concurrent calls for a namespace share one in-flight request.
 */
export async function fetchMyAssignments(namespace: string): Promise<MyAssignmentsResult> {
  if (isBackendApiRuledOut() || !namespace) {
    return NOTHING_ASSIGNED;
  }

  const existing = inflight.get(namespace);
  if (existing) {
    return existing;
  }

  const request: Promise<MyAssignmentsResult> = requestAssignments()
    .catch((err: unknown) => {
      reportFetchFailure(err);
      return FETCH_FAILED;
    })
    .finally(() => {
      inflight.delete(namespace);
    });

  inflight.set(namespace, request);
  return request;
}
