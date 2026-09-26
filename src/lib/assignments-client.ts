/**
 * Client for the /assignments/my backend proxy — the caller's assignments,
 * computed live by pkg/plugin/assignments.go.
 *
 * Mirrors lib/custom-guide-repository-client.ts's toggle pre-check,
 * capability-gated soft-200 shape, and in-flight de-duplication. It skips
 * that sibling's response cache because §7.4 requires satisfaction to be
 * evaluated live.
 *
 * @coupling API: GET /assignments/my served by pkg/plugin/assignments.go
 */
import { getBackendSrv } from '@grafana/runtime';

import { PLUGIN_BACKEND_URL } from '../constants';
import type { AssignmentEntryWire } from '../types/backend-api.schema';
import { isBackendApiAvailable } from '../utils/interactive-guides-api';
import { logger } from './logging';
import { recordAssignmentsUnavailable, recordAssignmentTargetsUnresolved } from './telemetry/facade';

/** Wire shape of one assignment. The target is (targetType, targetId); this client does not filter on targetType. */
export type AssignmentEntry = AssignmentEntryWire;

/**
 * Availability signal the assignments surfaces gate on, mirroring
 * CustomGuideCapability in custom-guide-repository-client.ts. Same reason
 * vocabulary: `identity-unavailable`, `identity-unverifiable`,
 * `signing-keys-unreachable`, `feature-toggle-disabled`, `obo-unavailable`,
 * or `upstream-<status>`.
 */
interface AssignmentsCapability {
  available: boolean;
  reason?: string;
}

interface MyAssignmentsResponse {
  capability: AssignmentsCapability;
  assignments: AssignmentEntry[];
  asOf?: string;
}

const ASSIGNMENTS_URL = `${PLUGIN_BACKEND_URL}/assignments/my`;

// Several surfaces can fetch on panel/page open concurrently (My Learning
// page, the shared recommendations panel). De-duplicate the in-flight request
// only — a stored TTL would stale the live evaluation §7.4 requires.
const inflight = new Map<string, Promise<AssignmentEntry[]>>();

// Bounded token, never the error text — lands on a Faro event attribute,
// which must stay low-cardinality (docs/developer/TELEMETRY.md).
function classifyRequestFailure(err: unknown): string {
  const status =
    (err as { status?: number })?.status ??
    (err as { statusCode?: number })?.statusCode ??
    (err as { data?: { statusCode?: number } })?.data?.statusCode;
  const bounded = typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599;
  return bounded ? `http-${status}` : 'transport-error';
}

function reportFetchFailure(err: unknown): void {
  try {
    const reason = classifyRequestFailure(err);
    logger.warn('[assignments] fetch failed', { reason });
    recordAssignmentsUnavailable(reason);
  } catch {
    // Observability must not turn a swallowed listing failure into a rejection.
  }
}

/** Count of assigned targets that didn't match anything in the caller's catalogue. */
export function reportUnresolvedAssignmentTargets(count: number): void {
  try {
    recordAssignmentTargetsUnresolved(count);
  } catch {
    // Observability must not turn a swallowed listing failure into a rejection.
  }
}

const MALFORMED_REASON = 'malformed-response';

// `null` is absent, not malformed: json.Marshal of a nil []assignmentEntry
// emits `null`, so an empty list legitimately sends exactly that.
function isMalformedAssignments(assignments: unknown): boolean {
  return assignments !== undefined && assignments !== null && !Array.isArray(assignments);
}

async function requestAssignments(): Promise<AssignmentEntry[]> {
  const response = await getBackendSrv().get<MyAssignmentsResponse>(ASSIGNMENTS_URL, undefined, undefined, {
    showErrorAlert: false,
    showSuccessAlert: false,
  });
  if (!response?.capability?.available) {
    const reason = response?.capability?.reason ?? 'unknown';
    logger.warn('[assignments] unavailable', { reason });
    recordAssignmentsUnavailable(reason);
    return [];
  }
  if (isMalformedAssignments(response.assignments)) {
    logger.warn('[assignments] malformed response', { reason: MALFORMED_REASON });
    recordAssignmentsUnavailable(MALFORMED_REASON);
    return [];
  }
  return Array.isArray(response.assignments) ? response.assignments : [];
}

/**
 * Fetch the caller's assignments. The proxy derives identity/namespace
 * server-side, so none is sent here; `namespace` is only a client-side gate
 * for "am I on a provisioned stack" and the cache key. Returns an empty array
 * when the aggregation toggle is off, there's no namespace, the proxy
 * reports itself unavailable, or the request fails — best-effort, not a hard
 * dependency (mirrors fetchCustomGuideRepository, minus its response cache;
 * see the module doc for why). Concurrent calls for the same namespace share
 * one in-flight request; nothing is stored after it settles.
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
