import type { CatalogPackage } from '../types/package-catalog.types';
import type { LearningPath, PathGuide, ResolvedAssignment } from '../types/learning-paths.types';
import type { CatalogProgress } from './catalog-progress.hook';
import { catalogIdentity } from './catalog-learning-core';
import { catalogTopic } from '../lib/catalog-discovery';

export interface LearningPathEntry {
  key: string;
  path: LearningPath;
  guides: PathGuide[];
  percent: number;
  topic?: string;
  assignment?: ResolvedAssignment;
}

export function selectLearningPathEntries({
  paths,
  onlinePaths,
  assignmentByTargetId,
  catalogItems,
  catalogProgress,
  getPathProgress,
  getPathGuides,
  includeCompleted = false,
}: {
  paths: LearningPath[];
  onlinePaths: LearningPath[];
  assignmentByTargetId: Map<string, ResolvedAssignment>;
  catalogItems: CatalogPackage[];
  catalogProgress: Map<string, CatalogProgress>;
  getPathProgress: (id: string) => number;
  getPathGuides: (id: string) => PathGuide[];
  includeCompleted?: boolean;
}): LearningPathEntry[] {
  const entries = new Map<string, LearningPathEntry>();
  const catalogPaths = new Map<string, CatalogPackage>();
  const catalogGuides = new Map<string, CatalogPackage>();
  const pathProgress = new Map<string, number>();
  for (const item of catalogItems) {
    const key = catalogIdentity(item);
    if (item.format === 'guide') {
      catalogGuides.set(key, item);
    } else {
      if (!catalogPaths.has(key)) {
        catalogPaths.set(key, item);
      }
      pathProgress.set(key, Math.max(pathProgress.get(key) ?? 0, catalogProgress.get(item.key)?.percent ?? 0));
    }
  }

  const knownPaths = [...paths, ...onlinePaths];
  for (const path of knownPaths) {
    const key = `${path.isPrivate ? 'organization' : 'grafana'}:${path.id}`;
    const assignment = assignmentByTargetId.get(path.id);
    const item = catalogPaths.get(key);
    const percent = assignment?.progress ?? Math.max(getPathProgress(path.id), pathProgress.get(key) ?? 0);
    if (!includeCompleted && percent >= 100 && !(assignment && !assignment.satisfied)) {
      continue;
    }
    entries.set(key, {
      key,
      path: { ...path, estimatedMinutes: path.estimatedMinutes ?? item?.estimatedMinutes },
      guides: getPathGuides(path.id),
      percent,
      assignment,
      topic: item ? catalogTopic(item) : undefined,
    });
  }
  for (const [key, item] of catalogPaths) {
    const percent = pathProgress.get(key) ?? 0;
    if (entries.has(key) || percent <= 0 || (!includeCompleted && percent >= 100)) {
      continue;
    }
    const members = item.memberIds ?? [];
    entries.set(key, {
      key,
      percent,
      topic: catalogTopic(item),
      path: item.curatedPath ?? {
        id: item.id,
        title: item.title,
        description: item.description ?? '',
        estimatedMinutes: item.estimatedMinutes,
        guides: members,
        badgeId: '',
        url: item.url,
        isPrivate: item.source === 'organization',
        manifest: item.packageInfo?.packageManifest,
      },
      guides: members.map((id) => {
        const member = catalogGuides.get(`${item.source}:${id}`);
        return {
          id,
          title: member?.title ?? id,
          completed: (catalogProgress.get(member?.key ?? '')?.percent ?? 0) >= 100,
          isCurrent: false,
        };
      }),
    });
  }
  return [...entries.values()];
}
