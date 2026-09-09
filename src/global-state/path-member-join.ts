/**
 * The content-key join for a path member.
 *
 * A path's percentage is the mean of its milestones' percentages
 * (`docs/design/COMPLETION-MODEL.md`, decision 4), which means joining each
 * member to the record it persisted under. That key is stored nowhere: a
 * member is keyed by the sanitized URL it was launched from
 * (`getContentKey`), and a path definition carries ids, not keys.
 *
 * Two things follow, and they are the whole of this module:
 *
 *  - A member with no resolved launch URL is keyed either `bundled:<id>` or
 *    `backend-guide:<id>`, and which one is not knowable from the path
 *    definition — the same ambiguity `resetPath` works around by clearing
 *    both. So both are read, and whichever holds a record wins. A reader can
 *    only have progressed under one of them.
 *  - A member for which no key can be formed at all is UNRESOLVED, and is
 *    excluded from the mean rather than scored zero. A zero is
 *    indistinguishable from a real result and drags the path's number down
 *    silently, which is the one failure that would look like evidence about
 *    reader behaviour instead of a bug. {@link PathMemberJoinResult} carries
 *    the count so the exclusion is visible.
 *
 * Pure: the persisted record is supplied by the caller, so this module reads
 * no storage and holds no state.
 */

import { sanitizeContentKey } from './content-key';

/** A path member, with as much identity as its parent path can supply. */
export interface PathMember {
  /** The member's id, as it appears in `LearningPath.guides`. */
  readonly id: string;
  /**
   * The member's resolved launch URL, when its source provides one —
   * `resolveGuideMetadata(id, pathId).url`. A milestone URL for URL-based
   * paths, `backend-guide:<id>` for App Platform paths, absent for bundled
   * guides and for App Platform members whose catalogue has not loaded yet.
   */
  readonly url?: string;
}

/** What a parent path tells the join about how its members are keyed. */
export interface PathMemberJoinContext {
  /**
   * The parent path's base URL, when it declares one. Its members are keyed
   * by their own milestone URL, never by an id scheme.
   */
  readonly pathBaseUrl?: string;
  /**
   * `learningProgressStorage.completedGuides`. A completed member is 100
   * whatever the persisted record holds, because completion is recorded as
   * membership and never as a percentage.
   */
  readonly completedMemberIds: readonly string[];
  /**
   * `interactiveCompletionStorage.getAll()` — and that namespace only.
   * `journeyCompletionStorage` holds no record under `backend-guide:` for a
   * partially progressed member, so joining against it would exclude every
   * one of them.
   *
   * Read by key presence, not by value: the storage `get` returns 0 for a
   * missing key, which is the distinction this whole module exists to keep.
   */
  readonly persistedPercentages: Readonly<Record<string, number>>;
}

/** How a member's percentage was arrived at. */
export type PathMemberPercentageSource =
  /** In the completed set. */
  | 'completed'
  /** A record was found under one of the member's candidate keys. */
  | 'persisted'
  /** Keys were formed and none held a record — the member was never opened. */
  | 'unopened'
  /** No candidate key could be formed. Excluded from the mean. */
  | 'unresolved';

export interface PathMemberPercentage {
  readonly memberId: string;
  /** `undefined` only when `source` is `'unresolved'`. */
  readonly percent: number | undefined;
  readonly source: PathMemberPercentageSource;
  /** The key `percent` was read under, when a record was found. */
  readonly contentKey?: string;
}

export interface PathMemberJoinResult {
  readonly members: readonly PathMemberPercentage[];
  /** The percentages that may enter the mean, in member order. */
  readonly resolvedPercentages: readonly number[];
  /** Members excluded because no content key could be formed. */
  readonly unresolvedCount: number;
  readonly unresolvedMemberIds: readonly string[];
}

const BUNDLED_PREFIX = 'bundled:';
const BACKEND_GUIDE_PREFIX = 'backend-guide:';

/**
 * The keys a member may have persisted under, most authoritative first.
 * Empty when none can be formed.
 */
export function pathMemberContentKeys(member: PathMember, pathBaseUrl?: string): readonly string[] {
  if (member.url) {
    return [sanitizeContentKey(member.url)];
  }
  if (pathBaseUrl) {
    return [];
  }
  return [
    sanitizeContentKey(`${BUNDLED_PREFIX}${member.id}`),
    sanitizeContentKey(`${BACKEND_GUIDE_PREFIX}${member.id}`),
  ];
}

export function resolvePathMemberPercentage(member: PathMember, context: PathMemberJoinContext): PathMemberPercentage {
  if (context.completedMemberIds.includes(member.id)) {
    return { memberId: member.id, percent: 100, source: 'completed' };
  }

  const candidates = pathMemberContentKeys(member, context.pathBaseUrl);
  if (candidates.length === 0) {
    return { memberId: member.id, percent: undefined, source: 'unresolved' };
  }

  for (const contentKey of candidates) {
    if (Object.hasOwn(context.persistedPercentages, contentKey)) {
      return {
        memberId: member.id,
        percent: context.persistedPercentages[contentKey],
        source: 'persisted',
        contentKey,
      };
    }
  }

  return { memberId: member.id, percent: 0, source: 'unopened' };
}

export function resolvePathMemberPercentages(
  members: readonly PathMember[],
  context: PathMemberJoinContext
): PathMemberJoinResult {
  const resolved = members.map((member) => resolvePathMemberPercentage(member, context));
  const unresolvedMemberIds = resolved.filter((entry) => entry.percent === undefined).map((entry) => entry.memberId);

  return {
    members: resolved,
    resolvedPercentages: resolved
      .map((entry) => entry.percent)
      .filter((percent): percent is number => percent !== undefined),
    unresolvedCount: unresolvedMemberIds.length,
    unresolvedMemberIds,
  };
}
