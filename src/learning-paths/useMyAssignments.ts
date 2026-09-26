/**
 * Fetches the caller's assignments once on mount. Namespace-gated and
 * best-effort empty on failure, the same shape as usePublishedGuides.
 *
 * Resolution lives in assignments-core.ts. Returns `notDone` and `completed`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { config } from '@grafana/runtime';

import { onCompletionPublished } from '../completion-records/completion-write-hook';
import { fetchMyAssignments, reportUnresolvedAssignmentTargets, type AssignmentEntry } from '../lib/assignments-client';
import { logger } from '../lib/logging';
import type { LearningPath } from '../types/learning-paths.types';
import { resolveAssignments, type ResolvedAssignment } from './assignments-core';

export { daysUntilDue, compareDueAt, type ResolvedAssignment } from './assignments-core';

interface UseMyAssignmentsOptions {
  /** The caller's learning-paths catalogue — resolution drops targets not found here. */
  paths: readonly LearningPath[];
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
  const { paths, getPathProgress } = options;
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

  useEffect(() => {
    return onCompletionPublished(() => {
      void refresh();
    });
  }, [refresh]);

  const resolved = useMemo(
    () => resolveAssignments(rawAssignments, paths, getPathProgress),
    [rawAssignments, paths, getPathProgress]
  );
  // §12.13 left hide-vs-error open. Hiding stays; the ids are the signal.
  // targetIds stay off the warn — that context bridges to Faro.
  const unresolvedKey = resolved.unresolvedTargetIds.join('\n');
  useEffect(() => {
    if (!unresolvedKey) {
      return;
    }
    const count = unresolvedKey.split('\n').length;
    logger.warn('[assignments] unresolvable target', { reason: 'unresolvable-target', count });
    logger.debug('[assignments] unresolvable target', { targetIds: unresolvedKey });
    reportUnresolvedAssignmentTargets(count);
  }, [unresolvedKey]);

  // resolveAssignments already sorts; filtering preserves that order.
  const notDone = useMemo(() => resolved.items.filter((a) => !a.satisfied), [resolved.items]);
  const completed = useMemo(() => resolved.items.filter((a) => a.satisfied), [resolved.items]);

  return { notDone, completed, isLoading, hasLoaded, refresh };
}
