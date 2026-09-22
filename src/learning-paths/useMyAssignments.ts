/**
 * Hook wrapping fetchMyAssignments (lib/assignments-client.ts) — the caller's
 * slice of Path Assignments. Mirrors utils/usePublishedGuides.ts's fetch shape
 * (fetch-once-on-mount, namespace-gated, best-effort empty on failure) rather
 * than sharing it. Consider an abstraction if a third matching resource shows up.
 *
 * Resolution lives in assignments-core.ts. This hook fetches, then returns
 * `notDone`/`completed`, already split by `satisfied`. My paths cards take
 * `notDone` for decoration; the docs-panel section takes `notDone` only,
 * never `completed`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { config } from '@grafana/runtime';

import { fetchMyAssignments, type AssignmentEntry } from '../lib/assignments-client';
import { logger } from '../lib/logging';
import type { LearningPath } from '../types/learning-paths.types';
import { resolveAssignments, type ResolvedAssignment } from './assignments-core';

export { daysUntilDue, type ResolvedAssignment } from './assignments-core';

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

  const resolved = useMemo(
    () => resolveAssignments(rawAssignments, paths, isPathCompleted, getPathProgress),
    [rawAssignments, paths, isPathCompleted, getPathProgress]
  );
  // §12.13 left hide-vs-error open. Hiding stays; the ids are the signal.
  // pathIds stay off the warn — that context bridges to Faro.
  const unresolvedKey = resolved.unresolvedPathIds.join('\n');
  useEffect(() => {
    if (!unresolvedKey) {
      return;
    }
    logger.warn('[assignments] unresolvable target', {
      reason: 'unresolvable-target',
      count: unresolvedKey.split('\n').length,
    });
    logger.debug('[assignments] unresolvable target', { pathIds: unresolvedKey });
  }, [unresolvedKey]);

  // Order within each group is already right — resolveAssignments sorts
  // overdue-first/soonest-due-first with satisfied last, and filtering
  // preserves relative order.
  const notDone = useMemo(() => resolved.items.filter((a) => !a.satisfied), [resolved.items]);
  const completed = useMemo(() => resolved.items.filter((a) => a.satisfied), [resolved.items]);

  return { notDone, completed, isLoading, hasLoaded, refresh };
}
