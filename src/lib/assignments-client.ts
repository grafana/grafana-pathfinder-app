/**
 * Client for the /assignments/my backend proxy (pkg/plugin/assignments.go).
 * Satisfaction is evaluated live server-side, so only in-flight requests are shared, never a result.
 *
 * @coupling API: GET /assignments/my served by pkg/plugin/assignments.go
 */
import { getBackendSrv } from '@grafana/runtime';

import { PLUGIN_BACKEND_URL } from '../constants';
import type { AssignmentEntryWire, MyAssignmentsResponseWire } from '../types/backend-api.schema';
import { isBackendApiAvailable } from '../utils/interactive-guides-api';
import { classifyRequestFailure } from './fetch-error';
import { logger } from './logging';
import { recordAssignmentsUnavailable } from './telemetry/facade';

/** Wire shape of one assignment. The target is (targetType, targetId); this client does not filter on targetType. */
export type AssignmentEntry = AssignmentEntryWire;

const ASSIGNMENTS_URL = `${PLUGIN_BACKEND_URL}/assignments/my`;

// Several surfaces fetch on open concurrently; a stored TTL would stale the live evaluation.
const inflight = new Map<string, Promise<AssignmentEntry[]>>();

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

async function requestAssignments(): Promise<AssignmentEntry[]> {
  const response = await getBackendSrv().get<MyAssignmentsResponseWire>(ASSIGNMENTS_URL, undefined, undefined, {
    showErrorAlert: false,
    showSuccessAlert: false,
  });
  if (!response?.capability?.available) {
    const reason = response?.capability?.reason ?? 'unknown';
    logger.warn('[assignments] unavailable', { reason });
    recordAssignmentsUnavailable(reason);
    return [];
  }
  if (!Array.isArray(response.assignments)) {
    logger.warn('[assignments] malformed response', { reason: MALFORMED_REASON });
    recordAssignmentsUnavailable(MALFORMED_REASON);
    return [];
  }
  return response.assignments;
}

/**
 * Fetch the caller's assignments; best-effort, resolves to an empty array when unavailable or failed.
 * Concurrent calls for a namespace share one in-flight request.
 */
export async function fetchMyAssignments(namespace: string): Promise<AssignmentEntry[]> {
  if (!isBackendApiAvailable() || !namespace) {
    return [];
  }

  const existing = inflight.get(namespace);
  if (existing) {
    return existing;
  }

  const request = requestAssignments()
    .catch((err: unknown) => {
      reportFetchFailure(err);
      return [] as AssignmentEntry[];
    })
    .finally(() => {
      inflight.delete(namespace);
    });

  inflight.set(namespace, request);
  return request;
}
