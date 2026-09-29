/**
 * Online Catalogue Assignment Paths Adapter (source 3)
 *
 * Resolves assignment targets that don't match the bundled/App Platform
 * catalogue (assignments-core.ts's unresolvedTargetIds) against the public
 * online package index — Discover More's own source. Mirrors
 * resolveOnlinePackageGuides in pkg/plugin/package_recommendations.go, the
 * backend's parallel source-3 resolver for assignment satisfaction.
 *
 * Targeted by assignment target id, not a bulk fetch like
 * fetchAppPlatformLearningPaths: only assignment targets are ever resolved
 * this way, so there's no risk of flooding My Courses with paths nobody
 * asked for.
 *
 * `resolveNavLinks` is injected rather than imported from package-engine
 * directly — learning-paths and package-engine are both Tier 2 engines, and
 * architecture.test.ts's lateral-import boundary keeps Tier 2 engines from
 * importing each other. MyLearningTab.tsx (Tier 3/4) already has
 * resolvePackageNavLinks on hand for openPathCover, so it's the natural
 * caller to thread through.
 *
 * @coupling Backend: resolveOnlinePackageGuides in pkg/plugin/package_recommendations.go
 */
import { buildPackageFileUrl, fetchOnlinePackageRecommendations } from '../lib/package-recommendations-client';
import { getManifestMemberIds } from '../types/package.types';
import type { LearningPath, PathGuide } from '../types/learning-paths.types';
import type { ResolvedNavLink } from '../types/context.types';
import type { AssignmentEntry } from '../lib/assignments-client';
import { assignmentProgress, buildResolvedAssignment, type ResolvedAssignment } from './assignments-core';

export interface OnlineAssignmentCard {
  resolved: ResolvedAssignment;
  path: LearningPath;
  guides: PathGuide[];
}

/** Resolves bare package ids into nav-link metadata (title/contentUrl/manifest) via the composite package resolver — see the module doc for why this is injected rather than imported. */
export type PackageNavLinkResolver = (packageIds: string[]) => Promise<ResolvedNavLink[]>;

/**
 * Resolves one assignment target against the online catalogue. Returns
 * undefined when it isn't a path-typed package there, or its manifest can't
 * be resolved — resolveAssignments' unresolvedTargetIds stays the signal for
 * "genuinely nowhere to be found" in that case.
 */
export async function resolveOnlineAssignmentCard(
  assignment: AssignmentEntry,
  resolveNavLinks: PackageNavLinkResolver,
  now: number = Date.now(),
  timeZone?: string
): Promise<OnlineAssignmentCard | undefined> {
  const { baseUrl, packages } = await fetchOnlinePackageRecommendations();
  const entry = packages.find((candidate) => candidate.id === assignment.targetId);
  if (!entry || entry.type !== 'path') {
    return undefined;
  }

  const [navLink] = await resolveNavLinks([assignment.targetId]);
  if (!navLink?.manifest) {
    return undefined;
  }

  const entryById = new Map(packages.map((candidate) => [candidate.id, candidate]));
  // Only members that are themselves indexed packages — mirrors
  // app-platform-paths.ts's published-only gate so an unindexed id doesn't
  // render titled by its raw id and inflate the denominator.
  const guideIds = getManifestMemberIds(navLink.manifest).filter((id) => entryById.has(id));

  const completedByGuideId = new Map((assignment.guides ?? []).map((g) => [g.guideId, g.completed]));
  let foundCurrent = false;
  const guides: PathGuide[] = guideIds.map((guideId) => {
    const completed = completedByGuideId.get(guideId) ?? false;
    const isCurrent = !completed && !foundCurrent;
    if (isCurrent) {
      foundCurrent = true;
    }
    const guideEntry = entryById.get(guideId)!;
    return {
      id: guideId,
      guideId,
      title: guideEntry.title || guideId,
      completed,
      isCurrent,
      url: buildPackageFileUrl(baseUrl, guideEntry.path, 'content.json') || undefined,
    };
  });

  const manifestDescription = navLink.manifest.description;
  const path: LearningPath = {
    id: entry.id,
    title: navLink.title || entry.title || entry.id,
    description: entry.description || (typeof manifestDescription === 'string' ? manifestDescription : ''),
    guides: guideIds,
    badgeId: '',
    isPrivate: false,
    // No `url`: this is a manifest-backed package like an App Platform path,
    // so MyLearningTab's existing openPathCover branch resolves its cover
    // via the composite resolver the same way it already does for App
    // Platform and (when the online recommender is disabled) CDN packages.
    manifest: navLink.manifest,
  };

  const progress = assignmentProgress(assignment.guides, 0);
  const resolved = buildResolvedAssignment(assignment, path.title, progress, now, timeZone);

  return { resolved, path, guides };
}
