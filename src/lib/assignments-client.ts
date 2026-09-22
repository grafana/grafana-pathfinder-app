/**
 * Client for the /assignments/my backend proxy — the caller's slice of Path
 * Assignments (pathfinder-rfcs/rfc/PATH_ASSIGNMENTS.md), computed live by
 * pkg/plugin/assignments.go against the App Platform Assignment CRD.
 *
 * Mirrors lib/custom-guide-repository-client.ts's capability-gated soft-200
 * shape and in-flight de-duplication. It does not pre-check
 * isBackendApiAvailable() — assignments_dev.go's fixture answers
 * `capability.available: true` precisely when that toggle is off, so
 * short-circuiting on it here would make local dev fixtures unreachable for no
 * gain. It also skips that sibling's 30s response cache: §7.4 requires this
 * route to evaluate live, and a TTL would hide a completion once
 * unevaluatedSatisfaction is real. In-flight de-duplication still covers
 * concurrent surfaces on one open.
 *
 * `satisfied` on each entry is a stub (assignments.go's unevaluatedSatisfaction
 * always returns false) until real evaluation ships — callers OR in local
 * completion via standInSatisfaction in learning-paths/assignments-core.ts.
 *
 * @coupling API: GET /assignments/my served by pkg/plugin/assignments.go
 */
import { getBackendSrv } from '@grafana/runtime';

import { PLUGIN_BACKEND_URL } from '../constants';
import { logger } from './logging';
import { recordAssignmentsUnavailable } from './telemetry/facade';

/**
 * Wire shape of a single assignment, mirroring pkg/plugin/assignments.go's
 * assignmentEntry. `pathId` plus an optional `trackId` is a draft reading of
 * the open §12.2 field-name question, not a settled Assignment schema. Time
 * fields are RFC3339 strings, omitted (not empty strings) when unset — see
 * assignmentEntry's doc comment on the Go side.
 */
export interface AssignmentEntry {
  pathId: string;
  trackId?: string;
  ruleId?: string;
  assignedBy?: string;
  assignedAt?: string;
  dueAt?: string;
  acceptCompletionsFrom?: string;
  /** Server-evaluated join against the caller's completions. See module doc. */
  satisfied: boolean;
  lifecycle: string;
}

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
 * when there's no namespace, the proxy reports itself unavailable, or the
 * request fails — best-effort, not a hard dependency (mirrors
 * fetchCustomGuideRepository, minus its isBackendApiAvailable() pre-check
 * and its response cache; see the module doc for why). Concurrent calls for
 * the same namespace share one in-flight request; nothing is stored after it
 * settles.
 */
export async function fetchMyAssignments(namespace: string): Promise<AssignmentEntry[]> {
  if (!namespace) {
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
