import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { config } from '@grafana/runtime';

import { onCompletionPublished } from '../completion-records/completion-write-hook';
import { fetchMyAssignments, type AssignmentEntry } from '../lib/assignments-client';
import { recordAssignmentTargetsUnresolved } from '../lib/telemetry/facade';
import { logger } from '../lib/logging';
import { getUserScope } from '../lib/user-scope';
import type { LearningPath, PathGuide, ResolvedAssignment } from '../types/learning-paths.types';
import {
  compareResolvedAssignments,
  findAssignedTrack,
  PATH_ASSIGNMENT_TARGET,
  resolveAssignments,
} from './assignments-core';
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
  guideAssignments: AssignmentEntry[];
  /** Every resolved assignment, satisfied or not — sorted most-urgent-first. */
  items: ResolvedAssignment[];
  notDone: ResolvedAssignment[];
  /** First-wins over `items`, so the most urgent duplicate governs. */
  assignmentByTargetId: Map<string, ResolvedAssignment>;
  /** Paths for online-catalogue targets, absent from `paths`. */
  onlinePaths: LearningPath[];
  /** Online targets get local completion overlaid; everything else defers to the passed-in getter. */
  getPathGuides: (pathId: string) => PathGuide[];
  /** True once the first fetch has settled, whether or not it succeeded. */
  hasLoaded: boolean;
  isLoading: boolean;
  hasError: boolean;
  retry: () => Promise<void>;
}

const EMPTY_ASSIGNMENTS: AssignmentEntry[] = [];
const EMPTY_ONLINE_CARDS: OnlineAssignmentCard[] = [];

export function useMyAssignments(options: UseMyAssignmentsOptions): UseMyAssignmentsResult {
  const { paths, getPathProgress, getPathGuides, completedGuides, resolveNavLinks } = options;
  const namespace = config.namespace;
  const scope = getUserScope();
  const [snapshot, setSnapshot] = useState<{ scope: string; assignments: AssignmentEntry[] }>();
  const rawAssignments = snapshot?.scope === scope ? snapshot.assignments : EMPTY_ASSIGNMENTS;
  const [loadedScope, setLoadedScope] = useState<string>();
  const [fetchingScope, setFetchingScope] = useState<string>();
  const [errorScope, setErrorScope] = useState<string>();
  const hasLoaded = !namespace || loadedScope === scope;
  const isFetching = fetchingScope === scope;
  const hasError = errorScope === scope;
  const isMountedRef = useRef(true);
  const inFlightRef = useRef<{ scope: string; pending: boolean } | undefined>(undefined);
  const emittedUnresolvedKeyRef = useRef('');

  const refresh = useCallback(async () => {
    if (!namespace || scope !== getUserScope()) {
      return;
    }
    if (inFlightRef.current?.scope === scope) {
      inFlightRef.current.pending = true;
      return;
    }
    const request = { scope, pending: false };
    inFlightRef.current = request;
    setFetchingScope(scope);
    do {
      request.pending = false;
      const fetched = await fetchMyAssignments(namespace);
      if (!isMountedRef.current || scope !== getUserScope() || inFlightRef.current !== request) {
        return;
      }
      if (fetched.ok) {
        setSnapshot({ scope, assignments: fetched.assignments });
      }
      setErrorScope(!fetched.ok && fetched.reason !== 'capability-unavailable' ? scope : undefined);
      setLoadedScope(scope);
    } while (request.pending);
    inFlightRef.current = undefined;
    setFetchingScope(undefined);
  }, [namespace, scope]);

  const initiallyLoadedScope = useRef<string | undefined>(undefined);
  useEffect(() => {
    isMountedRef.current = true;
    if (initiallyLoadedScope.current !== scope) {
      initiallyLoadedScope.current = scope;
      void refresh();
    }
    return () => {
      isMountedRef.current = false;
    };
  }, [refresh, scope]);

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
  const [onlineSnapshot, setOnlineSnapshot] = useState<{ scope: string; cards: OnlineAssignmentCard[] }>();
  const onlineCards = onlineSnapshot?.scope === scope ? onlineSnapshot.cards : EMPTY_ONLINE_CARDS;
  const [onlineResolution, setOnlineResolution] = useState<{
    assignments: AssignmentEntry[];
    unresolvedKey: string;
    failed: boolean;
  } | null>(null);
  useEffect(() => {
    const unresolvedIds = unresolvedKey ? unresolvedKey.split('\n') : [];
    const unresolvedIdSet = new Set(unresolvedIds);
    const candidates = rawAssignments.filter(
      (a) => a.targetType === PATH_ASSIGNMENT_TARGET && unresolvedIdSet.has(a.targetId)
    );
    let cancelled = false;
    void (async () => {
      const settled = await Promise.allSettled(candidates.map((a) => resolveOnlineAssignmentCard(a, resolveNavLinks)));
      if (cancelled || scope !== getUserScope()) {
        return;
      }
      const cards = settled.flatMap((result) => (result.status === 'fulfilled' && result.value ? [result.value] : []));
      setOnlineSnapshot({ scope, cards });

      const resolvedOnlineIds = new Set(cards.map((card) => card.resolved.targetId));
      const stillUnresolved = unresolvedIds.filter((id) => !resolvedOnlineIds.has(id));
      setOnlineResolution({
        assignments: rawAssignments,
        unresolvedKey,
        failed: settled.some((result) => result.status === 'rejected'),
      });
      const emitKey = [...stillUnresolved].sort().join('\n');
      if (stillUnresolved.length === 0) {
        emittedUnresolvedKeyRef.current = '';
      } else if (emitKey !== emittedUnresolvedKeyRef.current) {
        emittedUnresolvedKeyRef.current = emitKey;
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
  }, [unresolvedKey, rawAssignments, resolveNavLinks, scope]);

  const onlinePaths = useMemo(() => {
    const byId = new Map<string, OnlineAssignmentCard['path']>();
    for (const card of onlineCards) {
      if (!byId.has(card.path.id)) {
        byId.set(card.path.id, card.path);
      }
    }
    return [...byId.values()];
  }, [onlineCards]);

  const onlineCardsById = useMemo(() => {
    const byId = new Map<string, OnlineAssignmentCard>();
    for (const card of onlineCards) {
      if (!byId.has(card.path.id)) {
        byId.set(card.path.id, card);
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

  const pathsById = useMemo(() => new Map(paths.map((path) => [path.id, path])), [paths]);

  // Wire completion can drift from local storage; overlaying local completion keeps the
  // card's mismatch detection meaningful.
  const getPathGuidesWithOnline = useCallback(
    (pathId: string): PathGuide[] => {
      const onlineCard = onlineCardsById.get(pathId);
      const baseGuides = onlineCard
        ? onlineCard.guides.map((guide) => ({ ...guide, completed: completedGuides.includes(guide.id) }))
        : getPathGuides(pathId);
      const trackId = assignmentByTargetId.get(pathId)?.trackId;
      const path = pathsById.get(pathId);
      const trackGuideIds = onlineCard?.trackGuideIds ?? (path && findAssignedTrack(path, trackId))?.guides;
      if (!trackGuideIds) {
        return onlineCard ? markCurrentGuide(baseGuides) : baseGuides;
      }
      const guideById = new Map(baseGuides.map((guide) => [guide.id, guide]));
      return markCurrentGuide(trackGuideIds.flatMap((guideId) => guideById.get(guideId) ?? []));
    },
    [onlineCardsById, getPathGuides, completedGuides, pathsById, assignmentByTargetId]
  );

  const hasResolvedOnlineTargets =
    onlineResolution?.assignments === rawAssignments && onlineResolution.unresolvedKey === unresolvedKey;

  return {
    guideAssignments: rawAssignments.filter((assignment) => assignment.targetType === 'guide'),
    items,
    notDone,
    assignmentByTargetId,
    onlinePaths,
    getPathGuides: getPathGuidesWithOnline,
    hasLoaded,
    isLoading: !hasLoaded || isFetching || (unresolvedKey.length > 0 && !hasResolvedOnlineTargets),
    hasError: hasError || (hasResolvedOnlineTargets && onlineResolution.failed),
    retry: refresh,
  };
}
