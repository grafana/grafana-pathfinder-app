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
 *  - A member with no resolved launch URL is keyed under the `bundled:` or the
 *    `backend-guide:` scheme, and which one is not knowable from the path
 *    definition — the same ambiguity `resetPath` works around by clearing
 *    every one of them. `bundled:` itself has two live launch shapes: My
 *    Learning opens a bundled guide bare, while the package resolver hands the
 *    context panel `bundled:<id>/content.json`. Those two are independently
 *    reachable for the SAME guide and each keeps its own step progress, so a
 *    reader may hold a record under both, and the FURTHEST of them wins — how
 *    far the reader actually got on that guide.
 *
 *    Across schemes it is the opposite: the same id under two schemes may be
 *    two DIFFERENT guides. `createCompositeResolver` documents id collisions
 *    as possible and settles them bundled-first, so the schemes are consulted
 *    in that precedence and the first one holding a record answers, rather
 *    than a maximum that could report a private App Platform guide's progress
 *    as a bundled member's.
 *
 *    That precedence applies to the id-scheme branch ONLY. A member that
 *    arrives with a `url` is TRUSTED VERBATIM: this module is pure, cannot
 *    consult the bundled repository, and has no way to second-guess which
 *    guide the caller resolved. So the residual case stays open — a colliding
 *    CR id can hand this module `backend-guide:<id>` for a member of a static
 *    bundled path, because `resolveGuideMetadata` consults App Platform
 *    metadata before the static fallback and that metadata covers every
 *    published guide, not just members of App Platform paths. Closing it
 *    belongs to the caller, which would have to resolve member URLs
 *    bundled-first; recorded as follow-on for the rollup in decision 9 of
 *    `docs/design/COMPLETION-MODEL.md`.
 *  - A member the record cannot answer for is EXCLUDED from the mean rather
 *    than scored zero, and counted: either no key could be formed at all
 *    (`'unresolved'`), or a key was present but held something other than a
 *    percentage in `[0, 100]` (`'unreadable'`). A zero is indistinguishable
 *    from a real result and drags the path's number down silently, which is
 *    the one failure that would look like evidence about reader behaviour
 *    instead of a bug. {@link PathMemberJoinResult} carries the count so the
 *    exclusion is visible.
 *
 * An absent key is treated as a third thing — the member was never opened, so
 * zero is the honest answer — but that holds only as far as the record itself
 * does. `interactiveCompletionStorage` caps at `MAX_INTERACTIVE_COMPLETIONS`
 * (100) and `writeWithCap` evicts by insertion order, not by recency, so a
 * reader past that many distinct guides loses their earliest keys while the
 * progress behind them was real. At this boundary that is indistinguishable
 * from never-opened, and reading two candidate shapes per bundled member means
 * a guide opened from both surfaces now occupies two of the 100 slots. The
 * remedies are storage-side and are recorded as follow-on work in decision 9
 * of `docs/design/COMPLETION-MODEL.md`.
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
   * The record is parsed persisted JSON, so a present key whose value is not
   * a percentage in `[0, 100]` is unreadable rather than entering the mean —
   * the writer clamps to that range, so anything outside it is corruption.
   */
  readonly persistedPercentages: Readonly<Record<string, number>>;
}

/** How a member's percentage was arrived at. */
export type PathMemberPercentageSource =
  /** In the completed set. */
  | 'completed'
  /** The furthest record found across the member's candidate keys. */
  | 'persisted'
  /** Keys were formed and none held a record — the member was never opened. */
  | 'unopened'
  /** No candidate key could be formed. Excluded from the mean. */
  | 'unresolved'
  /**
   * A candidate key was present but held no percentage in `[0, 100]`, so the
   * member was opened and its progress is unreadable. Excluded from the mean.
   */
  | 'unreadable';

export interface PathMemberPercentage {
  readonly memberId: string;
  /** `undefined` exactly when the member is excluded from the mean. */
  readonly percent: number | undefined;
  readonly source: PathMemberPercentageSource;
  /** The key the winning `percent` was read under. */
  readonly contentKey?: string;
}

export interface PathMemberJoinResult {
  readonly members: readonly PathMemberPercentage[];
  /** The percentages that may enter the mean, in member order. */
  readonly resolvedPercentages: readonly number[];
  /** Members excluded because the record could not answer for them. */
  readonly unresolvedCount: number;
  readonly unresolvedMemberIds: readonly string[];
}

const BUNDLED_PREFIX = 'bundled:';
const BACKEND_GUIDE_PREFIX = 'backend-guide:';
const PACKAGE_CONTENT_SUFFIX = '/content.json';
const MIN_PERCENT = 0;
const MAX_PERCENT = 100;

function readablePercentage(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_PERCENT && value <= MAX_PERCENT
    ? value
    : undefined;
}

function dedupe(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

/**
 * The sole owner of the id-scheme construction: the launch URLs a bare member
 * id may have been opened under, unsanitized, grouped by the guide they
 * identify and ordered by `createCompositeResolver` precedence. `bundled:`
 * carries both of its shapes in one group because both may hold a record for
 * the same guide: My Learning launches a bundled guide bare, the package
 * resolver launches it as `bundled:<id>/content.json`. `backend-guide:` is its
 * own group and has only the bare shape.
 *
 * The package form mirrors `BundledPackageResolver.resolve`, which builds it
 * from the repository entry's `path` — every entry's `path` is `<id>/`, and
 * `path-member-join.test.ts` walks the whole repository so a divergent entry
 * fails there rather than in production.
 */
function idSchemeKeyGroups(memberId: string): ReadonlyArray<readonly string[]> {
  return [
    [`${BUNDLED_PREFIX}${memberId}`, `${BUNDLED_PREFIX}${memberId}${PACKAGE_CONTENT_SUFFIX}`],
    [`${BACKEND_GUIDE_PREFIX}${memberId}`],
  ];
}

/**
 * {@link idSchemeKeyGroups} flattened — the raw keys `resetPath` clears in the
 * namespaces keyed by the unsanitized launch URL.
 */
export function pathMemberIdSchemeKeys(memberId: string): readonly string[] {
  return idSchemeKeyGroups(memberId).flat();
}

/** A resolved `bundled:` URL and its sibling shape; anything else, unchanged. */
function bundledLaunchShapes(url: string): readonly string[] {
  if (!url.startsWith(BUNDLED_PREFIX)) {
    return [url];
  }
  return url.endsWith(PACKAGE_CONTENT_SUFFIX)
    ? [url, url.slice(0, -PACKAGE_CONTENT_SUFFIX.length)]
    : [url, `${url}${PACKAGE_CONTENT_SUFFIX}`];
}

/**
 * The member's candidate keys grouped by the guide they identify, schemes in
 * `createCompositeResolver` precedence order. Keys within a group are launch
 * shapes of one guide and rank by percentage; groups rank by precedence. A
 * supplied `url` is one group — it is trusted as the guide the caller
 * resolved.
 */
function pathMemberContentKeyGroups(member: PathMember, pathBaseUrl?: string): ReadonlyArray<readonly string[]> {
  if (member.url) {
    return [dedupe(bundledLaunchShapes(member.url).map(sanitizeContentKey))];
  }
  if (pathBaseUrl) {
    return [];
  }
  return idSchemeKeyGroups(member.id).map((group) => dedupe(group.map(sanitizeContentKey)));
}

/**
 * The keys a member may have persisted under, flattened. Order is the scheme
 * precedence the join reads them in, but a caller clearing keys should treat
 * the list as a set. Empty when none can be formed.
 */
export function pathMemberContentKeys(member: PathMember, pathBaseUrl?: string): readonly string[] {
  return dedupe(pathMemberContentKeyGroups(member, pathBaseUrl).flat());
}

export function resolvePathMemberPercentage(member: PathMember, context: PathMemberJoinContext): PathMemberPercentage {
  if (context.completedMemberIds.includes(member.id)) {
    return { memberId: member.id, percent: 100, source: 'completed' };
  }

  const groups = pathMemberContentKeyGroups(member, context.pathBaseUrl);
  if (groups.length === 0) {
    return { memberId: member.id, percent: undefined, source: 'unresolved' };
  }

  for (const group of groups) {
    let furthest: { percent: number; contentKey: string } | undefined;
    let unreadable = false;

    for (const contentKey of group) {
      if (!Object.hasOwn(context.persistedPercentages, contentKey)) {
        continue;
      }
      const persisted = readablePercentage(context.persistedPercentages[contentKey]);
      if (persisted === undefined) {
        unreadable = true;
        continue;
      }
      if (!furthest || persisted > furthest.percent) {
        furthest = { percent: persisted, contentKey };
      }
    }

    if (furthest) {
      return { memberId: member.id, percent: furthest.percent, source: 'persisted', contentKey: furthest.contentKey };
    }
    if (unreadable) {
      return { memberId: member.id, percent: undefined, source: 'unreadable' };
    }
  }

  return { memberId: member.id, percent: 0, source: 'unopened' };
}

export function resolvePathMemberPercentages(
  members: readonly PathMember[],
  context: PathMemberJoinContext
): PathMemberJoinResult {
  const resolved = members.map((member) => resolvePathMemberPercentage(member, context));
  const excluded = resolved.filter((entry) => entry.percent === undefined);

  return {
    members: resolved,
    resolvedPercentages: resolved.flatMap((entry) => (entry.percent === undefined ? [] : [entry.percent])),
    unresolvedCount: excluded.length,
    unresolvedMemberIds: excluded.map((entry) => entry.memberId),
  };
}
