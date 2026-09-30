/**
 * Resolves assignment targets missing from the bundled/App Platform catalogue
 * against the public online package index. `resolveNavLinks` is injected because
 * Tier 2 engines may not import each other.
 *
 * @coupling Backend: resolveOnlinePackageGuides in pkg/plugin/package_recommendations.go
 */
import { buildPackageFileUrl, fetchOnlinePackageRecommendations } from '../lib/package-recommendations-client';
import { getMilestoneSlug } from '../lib/learning-journey-url';
import { getManifestMemberIds } from '../types/package.types';
import type { LearningPath, PathGuide, ResolvedAssignment } from '../types/learning-paths.types';
import type { ResolvedNavLink } from '../types/context.types';
import type { AssignmentEntry } from '../lib/assignments-client';
import { assignmentProgress, buildResolvedAssignment } from './assignments-core';

export interface OnlineAssignmentCard {
  resolved: ResolvedAssignment;
  path: LearningPath;
  guides: PathGuide[];
}

/** Resolves bare package ids into nav-link metadata via the composite package resolver. */
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
  // Only indexed members: an unindexed id would render titled by its raw id and inflate the denominator.
  const manifestMembers = getManifestMemberIds(navLink.manifest)
    .filter((id) => entryById.has(id))
    .map((id) => entryById.get(id)!);

  // Milestone completion is keyed by the page's URL slug, not the canonical manifest id.
  // Mirrors resolveMilestoneGuideID in the backend.
  const guideIds = manifestMembers.map((member) => getMilestoneSlug(member.path) || member.id);

  const guides: PathGuide[] = manifestMembers.map((member, index) => {
    const guideId = guideIds[index]!;
    return {
      id: guideId,
      guideId,
      title: member.title || guideId,
      completed: false,
      isCurrent: false,
      url: buildPackageFileUrl(baseUrl, member.path, 'content.json') || undefined,
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
    // No `url`: manifest-backed like an App Platform path.
    manifest: navLink.manifest,
  };

  const progress = assignmentProgress(assignment.guides, 0);
  const resolved = buildResolvedAssignment(assignment, path.title, progress, now, timeZone);

  return { resolved, path, guides };
}
