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
import type { LearningPath, PathGuide } from '../types/learning-paths.types';
import {
  compareResolvedAssignments,
  PATH_ASSIGNMENT_TARGET,
  resolveAssignments,
  type ResolvedAssignment,
} from './assignments-core';
import {
  resolveOnlineAssignmentCard,
  type OnlineAssignmentCard,
  type PackageNavLinkResolver,
} from './online-assignment-paths';

export { daysUntilDue, compareDueAt, type ResolvedAssignment } from './assignments-core';

interface UseMyAssignmentsOptions {
  /** The caller's learning-paths catalogue — resolution drops targets not found here. */
  paths: readonly LearningPath[];
  getPathProgress: (pathId: string) => number;
  /** Resolves a target not in `paths` against the online catalogue (source 3) — see online-assignment-paths.ts for why this is injected. */
  resolveNavLinks: PackageNavLinkResolver;
}

/** A path/guides bundle for an assignment resolved via the online catalogue (source 3), not `paths`. */
export interface OnlineAssignmentPath {
  path: LearningPath;
  guides: PathGuide[];
}

interface UseMyAssignmentsResult {
  /** Every resolved assignment, satisfied or not — sorted most-urgent-first. */
  items: ResolvedAssignment[];
  notDone: ResolvedAssignment[];
  completed: ResolvedAssignment[];
  /**
   * Path/guides for assignments resolved via the online catalogue rather
   * than `paths` — keyed by targetId, since `getPathGuides`/`getPathProgress`
   * have no idea these exist. Empty until the async resolve settles.
   */
  onlinePaths: Map<string, OnlineAssignmentPath>;
  isLoading: boolean;
  hasLoaded: boolean;
  refresh: () => Promise<void>;
}

export function useMyAssignments(options: UseMyAssignmentsOptions): UseMyAssignmentsResult {
  const { paths, getPathProgress, resolveNavLinks } = options;
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
  const unresolvedKey = resolved.unresolvedTargetIds.join('\n');

  // Source 3: paths' unresolvedTargetIds tried the bundled/App Platform
  // catalogue and came up empty — resolved separately, on demand, against
  // the online catalogue (assignment_satisfaction.go's assignmentGuides does
  // the same three-tier fallback server-side). §12.13 left hide-vs-error
  // open. Hiding stays; only what's still unresolved after this tier warns —
  // targetIds stay off the warn itself, that context bridges to Faro.
  const [onlineCards, setOnlineCards] = useState<OnlineAssignmentCard[]>([]);
  useEffect(() => {
    const unresolvedIds = unresolvedKey ? unresolvedKey.split('\n') : [];
    const unresolvedIdSet = new Set(unresolvedIds);
    const candidates = rawAssignments.filter(
      (a) => a.targetType === PATH_ASSIGNMENT_TARGET && unresolvedIdSet.has(a.targetId)
    );
    let cancelled = false;
    void (async () => {
      const settled = await Promise.all(candidates.map((a) => resolveOnlineAssignmentCard(a, resolveNavLinks)));
      if (cancelled) {
        return;
      }
      const cards = settled.filter((card): card is OnlineAssignmentCard => card !== undefined);
      setOnlineCards(cards);

      const resolvedOnlineIds = new Set(cards.map((card) => card.resolved.targetId));
      const stillUnresolved = unresolvedIds.filter((id) => !resolvedOnlineIds.has(id));
      if (stillUnresolved.length > 0) {
        logger.warn('[assignments] unresolvable target', {
          reason: 'unresolvable-target',
          count: stillUnresolved.length,
        });
        logger.debug('[assignments] unresolvable target', { targetIds: stillUnresolved.join('\n') });
        reportUnresolvedAssignmentTargets(stillUnresolved.length);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unresolvedKey, rawAssignments, resolveNavLinks]);

  const onlinePaths = useMemo(() => {
    const map = new Map<string, OnlineAssignmentPath>();
    for (const card of onlineCards) {
      if (!map.has(card.path.id)) {
        map.set(card.path.id, { path: card.path, guides: card.guides });
      }
    }
    return map;
  }, [onlineCards]);

  const items = useMemo(
    () => [...resolved.items, ...onlineCards.map((card) => card.resolved)].sort(compareResolvedAssignments),
    [resolved.items, onlineCards]
  );

  // items is already sorted; filtering preserves that order.
  const notDone = useMemo(() => items.filter((a) => !a.satisfied), [items]);
  const completed = useMemo(() => items.filter((a) => a.satisfied), [items]);

  return { items, notDone, completed, onlinePaths, isLoading, hasLoaded, refresh };
}
