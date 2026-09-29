/**
 * Due-date math and catalogue lookup for assignments.
 * useMyAssignments.ts owns the fetch. Satisfaction is the wire boolean.
 */
import type { AssignmentEntry } from '../lib/assignments-client';
import type { LearningPath } from '../types/learning-paths.types';

/** The only target type this destination resolves into a path card. */
export const PATH_ASSIGNMENT_TARGET = 'path';

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
  /**
   * Per-guide completion behind `satisfied`, wire `guides` from GET
   * /assignments/my. Absent when the target couldn't be resolved server-side
   * (guide target, unresolved path) — `progress` falls back to local in
   * that case, same as before this field existed.
   */
  guides?: AssignmentEntry['guides'];
  /** Guide-completion-derived when `guides` is present; local path progress otherwise. */
  progress: number;
}

export interface ResolvedAssignments {
  items: ResolvedAssignment[];
  /** Path targetIds with no match in the catalogue passed to resolveAssignments. */
  unresolvedTargetIds: string[];
}

/** Kebab/snake-case id -> Title Case, mirroring learning-paths.hook.ts's formatLegacyBadgeTitle. */
export function formatTrackLabel(trackId: string): string {
  return trackId
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const DAY_MS = 86_400_000;

// One formatter per zone (an empty-string key means the viewer's own zone),
// reused across calls instead of built per lookup.
const dayFormatters = new Map<string, Intl.DateTimeFormat>();

// The calendar day `ms` falls on in `timeZone`, as an integer day number
// (UTC-midnight epoch day) so two zones' days can be subtracted directly.
function localDayNumber(ms: number, timeZone?: string): number {
  const key = timeZone ?? '';
  let formatter = dayFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    dayFormatters.set(key, formatter);
  }
  const parts = formatter.formatToParts(ms);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

/**
 * Calendar days from today to `dueAt`. Negative = already past. A midnight-UTC
 * `dueAt` means that calendar date in the viewer's local zone; any other
 * instant is due on the local calendar day containing it; overdue starts the
 * following local day, so due-today is never overdue. `timeZone` defaults to
 * the viewer's own zone; it exists so this math can be tested and reasoned
 * about per zone.
 */
export function daysUntilDue(dueAt: string, now: number = Date.now(), timeZone?: string): number | undefined {
  // Midnight UTC is how date-only dues are written. Read that as the
  // calendar date as written, independent of zone, so `2026-09-18T00:00:00Z`
  // stays Sept 18 everywhere.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})T00:00:00(?:\.\d+)?Z$/.exec(dueAt);
  if (dateOnly) {
    const dueDay = Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])) / DAY_MS;
    return dueDay - localDayNumber(now, timeZone);
  }
  const dueMs = Date.parse(dueAt);
  if (!Number.isFinite(dueMs)) {
    return undefined;
  }
  return localDayNumber(dueMs, timeZone) - localDayNumber(now, timeZone);
}

// `dueAt` timestamps aren't guaranteed to share an offset or fractional-second
// precision, so lexical comparison can misorder them (e.g. `+02:00` vs `Z`).
// Compare the parsed instants instead; an unparseable value sorts after every
// parseable one, and two unparseable values fall back to `localeCompare` as a
// tiebreak rather than reporting them equal. Exported so every place that
// orders by dueAt shares this one comparison instead of each writing its own
// (MyCoursesSection.tsx's course-card ordering is the other consumer).
export function compareDueAt(a: string, b: string): number {
  const aMs = Date.parse(a);
  const bMs = Date.parse(b);
  const aValid = Number.isFinite(aMs);
  const bValid = Number.isFinite(bMs);
  if (aValid && bValid) {
    return aMs - bMs;
  }
  if (aValid) {
    return -1;
  }
  if (bValid) {
    return 1;
  }
  return a.localeCompare(b);
}

export function isOverdue(dueAt: string | undefined, satisfied: boolean, now: number, timeZone?: string): boolean {
  if (!dueAt || satisfied) {
    return false;
  }
  const days = daysUntilDue(dueAt, now, timeZone);
  return days !== undefined && days < 0;
}

/**
 * Progress against the assignment's own target guides (completion records),
 * not the whole path's local progress — local progress can include guides
 * outside the assignment's track, or drift from what's actually on record.
 * Falls back to local progress when the wire didn't resolve a guide list
 * (guide target, unresolved path) — same behavior as before `guides` existed.
 */
export function assignmentProgress(guides: AssignmentEntry['guides'], localProgress: number): number {
  if (!guides || guides.length === 0) {
    return localProgress;
  }
  const completed = guides.filter((guide) => guide.completed).length;
  return Math.round((100 * completed) / guides.length);
}

/**
 * Builds one row from a raw assignment plus its already-resolved title and
 * progress — the part of resolution that's identical regardless of which
 * catalogue source resolved the target. `resolveAssignments` below uses this
 * for sources 1/2 (paths, matched synchronously); the online-catalogue
 * adapter (source 3, resolved on demand) uses it too, so a target found late
 * still gets the exact same due/overdue/label treatment as one found here.
 */
export function buildResolvedAssignment(
  assignment: AssignmentEntry,
  title: string,
  progress: number,
  now: number = Date.now(),
  timeZone?: string
): ResolvedAssignment {
  const satisfied = assignment.satisfied;
  return {
    targetType: assignment.targetType,
    targetId: assignment.targetId,
    title,
    trackLabel: assignment.trackId ? formatTrackLabel(assignment.trackId) : undefined,
    assignedBy: assignment.assignedBy ? formatTrackLabel(assignment.assignedBy) : undefined,
    dueAt: assignment.dueAt,
    overdue: isOverdue(assignment.dueAt, satisfied, now, timeZone),
    satisfied,
    guides: assignment.guides,
    progress,
  };
}

// Overdue first, then soonest due date, then no-due-date, satisfied last
// within each group — the point is to surface what needs attention. Shared
// by resolveAssignments and the online-catalogue tier's merge, so combining
// both sources' rows into one list sorts them identically to either alone.
export function compareResolvedAssignments(a: ResolvedAssignment, b: ResolvedAssignment): number {
  if (a.satisfied !== b.satisfied) {
    return a.satisfied ? 1 : -1;
  }
  if (a.overdue !== b.overdue) {
    return a.overdue ? -1 : 1;
  }
  if (a.dueAt && b.dueAt) {
    return compareDueAt(a.dueAt, b.dueAt);
  }
  if (a.dueAt) {
    return -1;
  }
  if (b.dueAt) {
    return 1;
  }
  return 0;
}

/**
 * Path targets only. Unmatched path targetIds land in `unresolvedTargetIds`;
 * other target types are omitted. One record stays one row.
 */
export function resolveAssignments(
  assignments: AssignmentEntry[],
  paths: readonly LearningPath[],
  getPathProgress: (pathId: string) => number,
  now: number = Date.now(),
  timeZone?: string
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
      return buildResolvedAssignment(
        assignment,
        path.title,
        assignmentProgress(assignment.guides, getPathProgress(path.id)),
        now,
        timeZone
      );
    })
    .filter((entry): entry is ResolvedAssignment => entry !== null);

  const items = resolved.sort(compareResolvedAssignments);

  return { items, unresolvedTargetIds };
}
