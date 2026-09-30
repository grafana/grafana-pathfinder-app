/**
 * Fetches the caller's assignments on mount and after each published
 * completion, and owns the path state derived from them. Best-effort empty
 * on failure.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { config } from '@grafana/runtime';

import { onCompletionPublished } from '../completion-records/completion-write-hook';
import { fetchMyAssignments, type AssignmentEntry } from '../lib/assignments-client';
import { recordAssignmentTargetsUnresolved } from '../lib/telemetry/facade';
import { logger } from '../lib/logging';
import type { LearningPath, PathGuide, ResolvedAssignment } from '../types/learning-paths.types';
import { compareResolvedAssignments, PATH_ASSIGNMENT_TARGET, resolveAssignments } from './assignments-core';
import { markCurrentGuide } from './mark-current-guide';
import {
  resolveOnlineAssignmentCard,
  type OnlineAssignmentCard,
  type PackageNavLinkResolver,
} from './online-assignment-paths';

interface UseMyAssignmentsOptions {
  /** The caller's learning-paths catalogue — resolution drops targets not found here. */
  paths: readonly LearningPath[];
  getPathProgress: (pathId: string) => number;
  getPathGuides: (pathId: string) => PathGuide[];
  completedGuides: readonly string[];
  resolveNavLinks: PackageNavLinkResolver;
}

interface UseMyAssignmentsResult {
  /** Every resolved assignment, satisfied or not — sorted most-urgent-first. */
  items: ResolvedAssignment[];
  notDone: ResolvedAssignment[];
  /** First-wins over `items`, so the most urgent duplicate governs. */
  assignmentByTargetId: Map<string, ResolvedAssignment>;
  /** Paths for online-catalogue targets, absent from `paths`. */
  onlinePaths: LearningPath[];
  /** Online targets get local completion overlaid; everything else defers to the passed-in getter. */
  getPathGuides: (pathId: string) => PathGuide[];
}

export function useMyAssignments(options: UseMyAssignmentsOptions): UseMyAssignmentsResult {
  const { paths, getPathProgress, getPathGuides, completedGuides, resolveNavLinks } = options;
  const [rawAssignments, setRawAssignments] = useState<AssignmentEntry[]>([]);
  const namespace = config.namespace;
  const isMountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!namespace) {
      if (isMountedRef.current) {
        setRawAssignments([]);
      }
      return;
    }

    const fetched = await fetchMyAssignments(namespace);
    if (isMountedRef.current) {
      setRawAssignments(fetched);
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

  // Targets missing from `paths` are retried against the online catalogue; only
  // those still unresolved warn, and targetIds stay off the warn (they bridge to Faro).
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
        recordAssignmentTargetsUnresolved(stillUnresolved.length);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unresolvedKey, rawAssignments, resolveNavLinks]);

  const onlinePaths = useMemo(() => {
    const byId = new Map<string, OnlineAssignmentCard['path']>();
    for (const card of onlineCards) {
      if (!byId.has(card.path.id)) {
        byId.set(card.path.id, card.path);
      }
    }
    return [...byId.values()];
  }, [onlineCards]);

  const onlineGuidesById = useMemo(() => {
    const byId = new Map<string, PathGuide[]>();
    for (const card of onlineCards) {
      if (!byId.has(card.path.id)) {
        byId.set(card.path.id, card.guides);
      }
    }
    return byId;
  }, [onlineCards]);

  const items = useMemo(
    () => [...resolved.items, ...onlineCards.map((card) => card.resolved)].sort(compareResolvedAssignments),
    [resolved.items, onlineCards]
  );

  const notDone = useMemo(() => items.filter((a) => !a.satisfied), [items]);

  const assignmentByTargetId = useMemo(() => {
    const map = new Map<string, ResolvedAssignment>();
    for (const assignment of items) {
      if (!map.has(assignment.targetId)) {
        map.set(assignment.targetId, assignment);
      }
    }
    return map;
  }, [items]);

  // Wire completion can drift from local storage; overlaying local completion keeps the
  // card's mismatch detection meaningful.
  const getPathGuidesWithOnline = useCallback(
    (pathId: string): PathGuide[] => {
      const online = onlineGuidesById.get(pathId);
      if (!online) {
        return getPathGuides(pathId);
      }
      return markCurrentGuide(online.map((guide) => ({ ...guide, completed: completedGuides.includes(guide.id) })));
    },
    [onlineGuidesById, getPathGuides, completedGuides]
  );

  return { items, notDone, assignmentByTargetId, onlinePaths, getPathGuides: getPathGuidesWithOnline };
}
