/**
 * The content-key join for a path member.
 *
 * A path's percentage is the mean of its milestones' percentages, which means
 * joining each member to the record it persisted under. That key is stored
 * nowhere: a member is keyed by the sanitized URL it was launched from
 * (`getContentKey`), and a path definition carries ids, not keys.
 *
 * The rules the code cannot state for itself, argued in full as decision 9 of
 * `docs/design/COMPLETION-MODEL.md`, which owns the rationale and the
 * follow-on work:
 *
 *  - `bundled:` has two live launch shapes for the SAME guide — My Learning
 *    opens it bare, the package resolver opens `bundled:<id>/content.json` —
 *    and each keeps its own step progress, so within a scheme the FURTHEST
 *    record wins.
 *  - Across schemes the same id may be two DIFFERENT guides, so schemes are
 *    consulted in `createCompositeResolver` precedence (bundled first) and the
 *    first holding a record answers. A maximum here could report a private App
 *    Platform guide's progress as a bundled member's.
 *  - A supplied `url` is trusted verbatim and forms one group: this module is
 *    pure and cannot consult the bundled repository to second-guess it.
 *  - A candidate key must survive `sanitizeContentKey` unchanged. That map is
 *    lossy, and `resetPath` clears the keys built here, so a rewritten value
 *    would name another guide's key and delete its progress.
 *  - The record is read by key PRESENCE, not value: the storage `get` returns
 *    0 for a missing key, which would collapse never-opened into zero.
 *  - A member the record cannot answer for is EXCLUDED and counted, never
 *    scored zero — a zero is indistinguishable from a real result and drags
 *    the path's number down silently.
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
   * guides. The App Platform adapter stamps a url on every published member,
   * so the `backend-guide:` group of the id-scheme branch is defensive and has
   * no production caller today.
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
  /**
   * Members excluded because the record could not answer for them — both the
   * `'unresolved'` and the `'unreadable'` source, which is why this is not
   * named for either one.
   */
  readonly excludedCount: number;
  readonly excludedMemberIds: readonly string[];
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
 * Candidates that survive `sanitizeContentKey` unchanged. It strips `..` and
 * truncates at 200 characters, so a value it rewrites names a different
 * guide's key — and `resetPath` deletes the keys built here. Dropping the
 * candidate yields `'unresolved'` instead of someone else's record.
 */
function normalizedCandidates(values: readonly string[]): readonly string[] {
  return dedupe(values.filter((value) => sanitizeContentKey(value) === value));
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
 * resolved. A group whose candidates do not survive normalization is dropped,
 * so an id that cannot be keyed safely resolves as `'unresolved'`.
 */
function pathMemberContentKeyGroups(member: PathMember, pathBaseUrl?: string): ReadonlyArray<readonly string[]> {
  const groups = member.url
    ? [normalizedCandidates(bundledLaunchShapes(member.url))]
    : pathBaseUrl
      ? []
      : idSchemeKeyGroups(member.id).map(normalizedCandidates);
  return groups.filter((group) => group.length > 0);
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
    excludedCount: excluded.length,
    excludedMemberIds: excluded.map((entry) => entry.memberId),
  };
}
