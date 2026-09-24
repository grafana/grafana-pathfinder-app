/**
 * Due-date math and catalogue lookup for assignments.
 * useMyAssignments.ts owns the fetch. Satisfaction is the wire boolean.
 */
import type { AssignmentEntry } from '../lib/assignments-client';
import type { LearningPath } from '../types/learning-paths.types';

/** The only target type this destination resolves into a path card. */
const PATH_ASSIGNMENT_TARGET = 'path';

export interface ResolvedAssignment {
  targetType: string;
  targetId: string;
  title: string;
  trackLabel?: string;
  assignedBy?: string;
  dueAt?: string;
  /** True when `dueAt` is in the past and the obligation isn't satisfied. */
  overdue: boolean;
  /** Wire `satisfied` from GET /assignments/my. */
  satisfied: boolean;
  progress: number;
}

export interface ResolvedAssignments {
  items: ResolvedAssignment[];
  /** Path targetIds with no match in the catalogue passed to resolveAssignments. */
  unresolvedTargetIds: string[];
}

/** Kebab/snake-case id -> Title Case, mirroring learning-paths.hook.ts's formatLegacyBadgeTitle. */
function formatTrackLabel(trackId: string): string {
  return trackId
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
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
 * Path targets only. Unmatched path targetIds land in `unresolvedTargetIds`;
 * other target types are omitted. One record stays one row.
 */
export function resolveAssignments(
  assignments: AssignmentEntry[],
  paths: readonly LearningPath[],
  getPathProgress: (pathId: string) => number,
  now: number = Date.now()
): ResolvedAssignments {
  const byId = new Map(paths.map((path) => [path.id, path]));
  const unresolvedTargetIds: string[] = [];

  const pathAssignments = assignments.filter((assignment) => assignment.targetType === PATH_ASSIGNMENT_TARGET);
  const resolved = pathAssignments
    .map((assignment): ResolvedAssignment | null => {
      const path = byId.get(assignment.targetId);
      if (!path) {
        unresolvedTargetIds.push(assignment.targetId);
        return null;
      }
      const satisfied = assignment.satisfied;
      return {
        targetType: assignment.targetType,
        targetId: path.id,
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

  return { items, unresolvedTargetIds };
}
