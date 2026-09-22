/**
 * Pure resolution for Path Assignments: window merge, due-date math, and
 * catalogue lookup. useMyAssignments.ts owns the fetch; this module owns
 * the rules those records are displayed by.
 */
import type { AssignmentEntry } from '../lib/assignments-client';
import type { LearningPath } from '../types/learning-paths.types';

export interface ResolvedAssignment {
  pathId: string;
  title: string;
  trackLabel?: string;
  assignedBy?: string;
  dueAt?: string;
  /** True when `dueAt` is in the past and the obligation isn't satisfied. */
  overdue: boolean;
  /**
   * Wire `satisfied` OR the path's local completion state
   * (useLearningPaths().isPathCompleted)
   */
  satisfied: boolean;
  progress: number;
}

export interface ResolvedAssignments {
  items: ResolvedAssignment[];
  /** pathIds with no match in the catalogue passed to resolveAssignments. */
  unresolvedPathIds: string[];
}

/** Kebab/snake-case id -> Title Case, mirroring learning-paths.hook.ts's formatLegacyBadgeTitle. */
function formatTrackLabel(trackId: string): string {
  return trackId
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** [acceptCompletionsFrom ?? assignedAt, dueAt]; absent bounds are unbounded. */
function assignmentWindow(assignment: AssignmentEntry): { start: number; end: number } {
  const startRaw = assignment.acceptCompletionsFrom ?? assignment.assignedAt;
  const start = startRaw ? Date.parse(startRaw) : -Infinity;
  const end = assignment.dueAt ? Date.parse(assignment.dueAt) : Infinity;
  return {
    start: Number.isFinite(start) ? start : -Infinity,
    end: Number.isFinite(end) ? end : Infinity,
  };
}

/** Merges one cluster's records into a single entry; a lone record passes through unchanged. */
function collapseCluster(cluster: AssignmentEntry[]): AssignmentEntry {
  return cluster.reduce((acc, assignment) => {
    const soonestDueAt = [acc.dueAt, assignment.dueAt].filter((d): d is string => Boolean(d)).sort()[0];
    return {
      ...acc,
      trackId: acc.trackId === assignment.trackId ? acc.trackId : undefined,
      dueAt: soonestDueAt,
      satisfied: acc.satisfied || assignment.satisfied,
    };
  });
}

/**
 * Same pathId, overlapping accept/due windows -> one card: completing the
 * material once satisfies every obligation whose window that completion
 * falls in, so a whole-path record and a track-scoped record for the same
 * path merge exactly when their windows overlap, same as two records from
 * different rules (PATH_ASSIGNMENTS.md §6.10's "no uniqueness constraint").
 * Non-overlapping windows (e.g. two disjoint annual cycles) stay separate
 * cards, which is what keeps recurrence working. Classic sweep: sort each
 * path's records by window start and extend a running cluster while the
 * next record's start falls inside it, so overlap chains transitively.
 */
export function collapseOverlappingWindows(assignments: AssignmentEntry[]): AssignmentEntry[] {
  const byPath = new Map<string, AssignmentEntry[]>();
  for (const assignment of assignments) {
    const records = byPath.get(assignment.pathId) ?? [];
    records.push(assignment);
    byPath.set(assignment.pathId, records);
  }

  const merged: AssignmentEntry[] = [];
  for (const records of byPath.values()) {
    const sorted = [...records].sort((a, b) => assignmentWindow(a).start - assignmentWindow(b).start);
    let cluster: AssignmentEntry[] = [];
    let clusterEnd = -Infinity;
    for (const record of sorted) {
      const window = assignmentWindow(record);
      if (cluster.length > 0 && window.start > clusterEnd) {
        merged.push(collapseCluster(cluster));
        cluster = [];
      }
      cluster.push(record);
      clusterEnd = Math.max(clusterEnd, window.end);
    }
    if (cluster.length > 0) {
      merged.push(collapseCluster(cluster));
    }
  }
  return merged;
}

const DAY_MS = 86_400_000;

function startOfLocalDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Calendar days from today to `dueAt`. Negative = already past. */
export function daysUntilDue(dueAt: string, now: number = Date.now()): number | undefined {
  // Midnight UTC is how date-only dues are written. Parse that as a local
  // calendar day so `2026-09-18T00:00:00Z` stays Sept 18 west of UTC.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})T00:00:00(?:\.\d+)?Z$/.exec(dueAt);
  if (dateOnly) {
    const dueLocal = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])).getTime();
    return Math.round((dueLocal - startOfLocalDay(now)) / DAY_MS);
  }
  const dueMs = Date.parse(dueAt);
  if (!Number.isFinite(dueMs)) {
    return undefined;
  }
  return Math.round((startOfLocalDay(dueMs) - startOfLocalDay(now)) / DAY_MS);
}

function isOverdue(dueAt: string | undefined, satisfied: boolean, now: number): boolean {
  if (!dueAt || satisfied) {
    return false;
  }
  const days = daysUntilDue(dueAt, now);
  return days !== undefined && days < 0;
}

/**
 * Stand-in for unevaluatedSatisfaction in pkg/plugin/assignments.go, which
 * is the tracking point for the real completion join. Wire `satisfied` stays
 * false until that lands, so this ORs the path's local completion. It checks
 * the whole path even when the record names a trackId — §7.1 wants that
 * track's own derived check, which this cannot do yet.
 */
export function standInSatisfaction(
  assignment: AssignmentEntry,
  isPathCompleted: (pathId: string) => boolean
): boolean {
  return assignment.satisfied || isPathCompleted(assignment.pathId);
}

/**
 * Resolves wire assignments to display-ready items. Targets that don't match
 * any path in the current catalogue are omitted from `items` and listed in
 * `unresolvedPathIds`. PATH_ASSIGNMENTS.md §12.13 leaves hide-vs-error open;
 * hiding stays the reader-facing default, and the caller logs the ids.
 */
export function resolveAssignments(
  assignments: AssignmentEntry[],
  paths: readonly LearningPath[],
  isPathCompleted: (pathId: string) => boolean,
  getPathProgress: (pathId: string) => number,
  now: number = Date.now()
): ResolvedAssignments {
  const byId = new Map(paths.map((path) => [path.id, path]));
  const unresolvedPathIds: string[] = [];

  const resolved = collapseOverlappingWindows(assignments)
    .map((assignment): ResolvedAssignment | null => {
      const path = byId.get(assignment.pathId);
      if (!path) {
        unresolvedPathIds.push(assignment.pathId);
        return null;
      }
      const satisfied = standInSatisfaction(assignment, isPathCompleted);
      return {
        pathId: path.id,
        title: path.title,
        trackLabel: assignment.trackId ? formatTrackLabel(assignment.trackId) : undefined,
        assignedBy: assignment.assignedBy ? formatTrackLabel(assignment.assignedBy) : undefined,
        dueAt: assignment.dueAt,
        overdue: isOverdue(assignment.dueAt, satisfied, now),
        satisfied,
        progress: getPathProgress(path.id),
      };
    })
    .filter((entry): entry is ResolvedAssignment => entry !== null);

  // Overdue first, then soonest due date, then no-due-date, satisfied last
  // within each group — the point is to surface what needs attention.
  const items = resolved.sort((a, b) => {
    if (a.satisfied !== b.satisfied) {
      return a.satisfied ? 1 : -1;
    }
    if (a.overdue !== b.overdue) {
      return a.overdue ? -1 : 1;
    }
    if (a.dueAt && b.dueAt) {
      return a.dueAt.localeCompare(b.dueAt);
    }
    if (a.dueAt) {
      return -1;
    }
    if (b.dueAt) {
      return 1;
    }
    return 0;
  });

  return { items, unresolvedPathIds };
}
