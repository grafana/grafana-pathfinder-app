/**
 * Client for the /assignments/my backend proxy — the caller's slice of Path
 * Assignments (pathfinder-rfcs/rfc/PATH_ASSIGNMENTS.md), computed live by
 * pkg/plugin/assignments.go against the App Platform Assignment CRD.
 *
 * Mirrors lib/custom-guide-repository-client.ts's capability-gated soft-200
 * shape, namespace-keyed cache, and in-flight de-duplication. One divergence:
 * it does not pre-check isBackendApiAvailable() — assignments_dev.go's fixture
 * answers `capability.available: true` precisely when that toggle is off, so
 * short-circuiting on it here would make local dev fixtures unreachable for no
 * gain — the server-side check already returns before any upstream call, so
 * the client-side pre-check saves nothing a real stack would notice.
 *
 * `satisfied` on each entry is a stub (assignments.go's unevaluatedSatisfaction
 * always returns false) until real evaluation ships — callers should OR in
 * local completion state; see learning-paths/useMyAssignments.ts.
 *
 * @coupling API: GET /assignments/my served by pkg/plugin/assignments.go
 */
import { getBackendSrv } from '@grafana/runtime';

import { PLUGIN_BACKEND_URL } from '../constants';
import { logger } from './logging';
import { recordAssignmentsUnavailable } from './telemetry/facade';

/**
 * Wire shape of a single assignment, mirroring pkg/plugin/assignments.go's
 * assignmentEntry. Time fields are RFC3339 strings, omitted (not empty
 * strings) when unset — see assignmentEntry's doc comment on the Go side.
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

// Same rationale as custom-guide-repository-client.ts: several surfaces can
// fetch on panel/page open concurrently (My Learning page, the shared
// recommendations panel), and the proxy keeps no cross-request cache of its
// own. A full reload always refetches.
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { entries: AssignmentEntry[]; at: number }>();
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

interface AssignmentsResult {
  entries: AssignmentEntry[];
  cacheable: boolean;
}

const MALFORMED_REASON = 'malformed-response';

// `null` is absent, not malformed: json.Marshal of a nil []assignmentEntry
// emits `null`, so an empty list legitimately sends exactly that.
function isMalformedAssignments(assignments: unknown): boolean {
  return assignments !== undefined && assignments !== null && !Array.isArray(assignments);
}

async function requestAssignments(): Promise<AssignmentsResult> {
  const response = await getBackendSrv().get<MyAssignmentsResponse>(ASSIGNMENTS_URL, undefined, undefined, {
    showErrorAlert: false,
    showSuccessAlert: false,
  });
  if (!response?.capability?.available) {
    const reason = response?.capability?.reason ?? 'unknown';
    logger.warn('[assignments] unavailable', { reason });
    recordAssignmentsUnavailable(reason);
    return { entries: [], cacheable: true };
  }
  if (isMalformedAssignments(response.assignments)) {
    logger.warn('[assignments] malformed response', { reason: MALFORMED_REASON });
    recordAssignmentsUnavailable(MALFORMED_REASON);
    return { entries: [], cacheable: false };
  }
  const assignments = Array.isArray(response.assignments) ? response.assignments : [];
  return { entries: assignments, cacheable: true };
}

/**
 * Fetch the caller's assignments. The proxy derives identity/namespace
 * server-side, so none is sent here; `namespace` is only a client-side gate
 * for "am I on a provisioned stack" and the cache key. Returns an empty array
 * when there's no namespace, the proxy reports itself unavailable, or the
 * request fails — best-effort, not a hard dependency (mirrors
 * fetchCustomGuideRepository, minus its isBackendApiAvailable() pre-check;
 * see the module doc for why). Successful results are cached per namespace
 * for CACHE_TTL_MS with in-flight de-duplication; failures and malformed
 * responses are not cached.
 */
export async function fetchMyAssignments(namespace: string): Promise<AssignmentEntry[]> {
  if (!namespace) {
    return [];
  }

  const cached = cache.get(namespace);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.entries;
  }

  const existing = inflight.get(namespace);
  if (existing) {
    return existing;
  }

  const request = requestAssignments()
    .then(({ entries, cacheable }) => {
      if (cacheable) {
        cache.set(namespace, { entries, at: Date.now() });
      }
      return entries;
    })
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

/** Drop cached assignments so the next fetch re-lists (e.g. in tests). */
export function invalidateMyAssignmentsCache(): void {
  cache.clear();
}
