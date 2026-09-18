/**
 * Hook wrapping fetchMyAssignments (lib/assignments-client.ts) — the caller's
 * slice of Path Assignments, resolved into display-ready items. Mirrors
 * utils/usePublishedGuides.ts's fetch shape (fetch-once-on-mount,
 * namespace-gated, best-effort empty on failure) rather than sharing it.
 * Consider an abstraction if a third matching resource shows up.
 *
 * Resolution — matching wire entries against the learning-paths catalogue
 * (title, the satisfied-OR-locally-complete fallback, overdue, window-based
 * merge, sort)
 * — is a required hook option rather than a separate call the consumer
 * makes, per useDiscoverMore's pattern of doing all shaping inside the hook
 * and returning display-ready items.
 *
 * Returns `notDone`/`completed`, already split by `satisfied`. My paths
 * cards take `notDone` for decoration; the docs-panel section takes
 * `notDone` only, never `completed`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { config } from '@grafana/runtime';

import { fetchMyAssignments, type AssignmentEntry } from '../lib/assignments-client';
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

interface UseMyAssignmentsOptions {
  /** The caller's learning-paths catalogue — resolution drops targets not found here. */
  paths: readonly LearningPath[];
  isPathCompleted: (pathId: string) => boolean;
  getPathProgress: (pathId: string) => number;
}

interface UseMyAssignmentsResult {
  notDone: ResolvedAssignment[];
  completed: ResolvedAssignment[];
  isLoading: boolean;
  hasLoaded: boolean;
  refresh: () => Promise<void>;
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
function mergeDuplicates(assignments: AssignmentEntry[]): AssignmentEntry[] {
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
 * Resolves wire assignments to display-ready items. Targets that don't match
 * any path in the current catalogue (deleted/unpublished/not-yet-loaded) are
 * silently dropped rather than shown as a broken link or an error card —
 * PATH_ASSIGNMENTS.md §"unresolvable target" leaves the choice open, and
 * hiding is the safer default for a reader-facing surface.
 */
function resolveAssignments(
  assignments: AssignmentEntry[],
  paths: readonly LearningPath[],
  isPathCompleted: (pathId: string) => boolean,
  getPathProgress: (pathId: string) => number,
  now: number = Date.now()
): ResolvedAssignment[] {
  const byId = new Map(paths.map((path) => [path.id, path]));

  const resolved = mergeDuplicates(assignments)
    .map((assignment): ResolvedAssignment | null => {
      const path = byId.get(assignment.pathId);
      if (!path) {
        return null;
      }
      const satisfied = assignment.satisfied || isPathCompleted(path.id);
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
  return resolved.sort((a, b) => {
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
}

export function useMyAssignments(options: UseMyAssignmentsOptions): UseMyAssignmentsResult {
  const { paths, isPathCompleted, getPathProgress } = options;
  const [rawAssignments, setRawAssignments] = useState<AssignmentEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const namespace = config.namespace;
  const isMountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!namespace) {
      if (isMountedRef.current) {
        setRawAssignments([]);
        setHasLoaded(true);
      }
      return;
    }

    if (isMountedRef.current) {
      setIsLoading(true);
    }

    try {
      const fetched = await fetchMyAssignments(namespace);
      if (isMountedRef.current) {
        setRawAssignments(fetched);
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
        setHasLoaded(true);
      }
    }
  }, [namespace]);

  const hasInitiallyLoaded = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    if (!hasInitiallyLoaded.current) {
      hasInitiallyLoaded.current = true;
      void refresh();
    }
    return () => {
      isMountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch once on mount; namespace is session-stable and putting refresh in the array would refetch whenever the callback identity changes
  }, []);

  const assignments = useMemo(
    () => resolveAssignments(rawAssignments, paths, isPathCompleted, getPathProgress),
    [rawAssignments, paths, isPathCompleted, getPathProgress]
  );
  // Order within each group is already right — resolveAssignments sorts
  // overdue-first/soonest-due-first with satisfied last, and filtering
  // preserves relative order.
  const notDone = useMemo(() => assignments.filter((a) => !a.satisfied), [assignments]);
  const completed = useMemo(() => assignments.filter((a) => a.satisfied), [assignments]);

  return { notDone, completed, isLoading, hasLoaded, refresh };
}
